/**
 * The one module in the web app that calls Dial, the text message provider.
 *
 * Documented at https://docs.getdial.ai (`POST /api/v1/messages`, bearer key). Three rules shape
 * every call here:
 *
 * - One attempt. The send call has no idempotency key, so a second attempt can be a second text
 *   on a person's phone. Nothing in this module repeats a call, and a caller must not either.
 * - A phone number never leaves this module except in the request body. A result carries a short
 *   reason code and never the provider's own words, because an error text can quote the number.
 * - The body is folded into the basic SMS alphabet before it goes out (`smsText`), so no caller
 *   can send a text in the wider encoding by accident.
 *
 * The response is untrusted input and is read defensively.
 */
import { isE164, SMS, smsText } from "@lantern/shared";
import type { SmsSender } from "./env";

export type SmsResult =
  /** The provider took the message. `id` is the provider's message id, when it gave one. */
  | { state: "sent"; id: string | null }
  /**
   * Nothing was sent: the provider said no, or the request could not leave. `forAll` is true when
   * the cause is not this recipient (the key, the credit, the provider's address): the next send
   * fails the same way, so a caller with a list stops there.
   */
  | { state: "refused"; reason: string; forAll: boolean }
  /**
   * No answer, a server error, or an answer that is not the provider's. The text may or may not
   * have gone, so nobody sends it again.
   */
  | { state: "unconfirmed"; reason: string };

/** How long one call may take. A text that is not confirmed in this time is `unconfirmed`. */
const TIMEOUT_MS = 10_000;

/** A message id is a short token. Anything else is the provider's free text, and is not kept. */
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The provider's error code when it gave one (`insufficient_credit`, `rate_limited`), else the
 * status. A code is lower-case letters and underscores; anything else could be free text, or a
 * phone number, and is not used.
 */
function reasonFor(status: number, body: unknown): string {
  const candidates = isRecord(body) ? [body.code, isRecord(body.error) ? body.error.code : null] : [];
  for (const code of candidates) {
    if (typeof code === "string" && /^[a-z][a-z_]{0,39}$/.test(code)) return code;
  }
  return `http_${status}`;
}

/** Failures of the connection that happen before a request can leave. Nothing was sent. */
const NEVER_LEFT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ERR_INVALID_URL"]);

/** Why a call got no answer: a short code, and whether the request can have reached the provider. */
function failureOf(error: unknown): { reason: string; left: boolean } {
  if (error instanceof Error && error.name === "TimeoutError") return { reason: "timeout", left: true };
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  const code = typeof cause?.code === "string" ? cause.code : "";
  if (code === "ERR_INVALID_URL") return { reason: "bad_api_url", left: false };
  if (NEVER_LEFT.has(code)) return { reason: "unreachable", left: false };
  return { reason: "network", left: true };
}

/** Sends one text. Never throws and never repeats the call. */
export async function sendSms(
  sender: SmsSender,
  message: { to: string; body: string },
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SmsResult> {
  if (!isE164(message.to)) return { state: "refused", reason: "invalid_number", forAll: false };
  const body = smsText(message.body);
  if (!body) return { state: "refused", reason: "empty_body", forAll: false };

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${sender.apiUrl}${SMS.sendPath}`, {
      method: "POST",
      headers: { authorization: `Bearer ${sender.apiKey}`, "content-type": "application/json" },
      // No `channel`: the number's own default applies, so a standard number sends an SMS.
      body: JSON.stringify({ to: message.to, fromNumber: sender.fromNumber, body }),
      // A redirect would repeat the request as a GET, and the page it lands on can answer 200.
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const failure = failureOf(error);
    // A connection that broke after it opened may have carried the request to the provider.
    if (failure.left) return { state: "unconfirmed", reason: failure.reason };
    return { state: "refused", reason: failure.reason, forAll: true };
  }

  const answer: unknown = await response.json().catch(() => null);
  if (response.ok) {
    // Only the provider's own answer counts as sent. A 200 from a different server (a wrong base
    // address, a proxy's page) must not erase a person's number as if the text had gone.
    const sent = isRecord(answer) && isRecord(answer.message) ? answer.message : null;
    if (!sent) return { state: "unconfirmed", reason: "unreadable_answer" };
    return { state: "sent", id: typeof sent.id === "string" && MESSAGE_ID.test(sent.id) ? sent.id : null };
  }
  const reason = reasonFor(response.status, answer);
  // A 5xx says nothing about whether the message was queued, and a 303 says "done, see there".
  if (response.status >= 500 || response.status === 303) return { state: "unconfirmed", reason };
  // Every 4xx and every other redirect are "nothing was sent". A redirect, the key and the credit
  // are not about this recipient.
  const forAll = response.status < 400 || response.status === 401 || response.status === 402;
  return { state: "refused", reason, forAll };
}

export type DialNumber = {
  id: string;
  number: string;
  country: string | null;
  capabilities: string[];
  setupStatus: string | null;
  /** The 10DLC registration status of a US number, or null when the provider gave none. */
  tenDlcStatus: string | null;
};

function toNumber(row: unknown): DialNumber | null {
  if (!isRecord(row) || typeof row.id !== "string" || typeof row.number !== "string") return null;
  const tenDlc = isRecord(row.tenDlc) && typeof row.tenDlc.status === "string" ? row.tenDlc.status : null;
  return {
    id: row.id,
    number: row.number,
    country: typeof row.country === "string" ? row.country : null,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((item): item is string => typeof item === "string") : [],
    setupStatus: typeof row.setupStatus === "string" ? row.setupStatus : null,
    tenDlcStatus: tenDlc,
  };
}

/** The numbers of the account. Read-only: the live check calls it to prove the key works. */
export async function listNumbers(
  sender: Pick<SmsSender, "apiKey" | "apiUrl">,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: true; numbers: DialNumber[] } | { ok: false; reason: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${sender.apiUrl}${SMS.numbersPath}`, {
      headers: { authorization: `Bearer ${sender.apiKey}` },
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    });
    const answer: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, reason: reasonFor(response.status, answer) };
    const rows = isRecord(answer) && Array.isArray(answer.numbers) ? answer.numbers : null;
    if (!rows) return { ok: false, reason: "unreadable_answer" };
    return { ok: true, numbers: rows.map(toNumber).filter((row): row is DialNumber => row !== null) };
  } catch (error) {
    return { ok: false, reason: failureOf(error).reason };
  }
}
