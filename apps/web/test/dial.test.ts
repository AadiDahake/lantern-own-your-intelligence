/**
 * The text message client, offline: the provider is mocked at the fetch boundary.
 *
 * What matters here is what cannot be seen in a demo: one attempt only, a body the provider sends
 * in the plain encoding, and a result that never carries a phone number or the provider's words.
 */
import { describe, expect, it, vi } from "vitest";
import { listNumbers, sendSms } from "@/lib/dial";
import type { SmsSender } from "@/lib/env";

const SENDER: SmsSender = { apiKey: "test-key-not-real", fromNumber: "+14155550100", apiUrl: "https://dial.test" };
const TO = "+14155550123";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { url: string; init: RequestInit };

function fetchReturning(response: () => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("sendSms", () => {
  it("posts one message with the key, the sender number and the body, and reads the message id", async () => {
    const { fetchImpl, calls } = fetchReturning(() => jsonResponse({ message: { id: "msg_1", status: "sent" } }, 201));
    const result = await sendSms(SENDER, { to: TO, body: "Your change is drafted." }, { fetchImpl });

    expect(result).toEqual({ state: "sent", id: "msg_1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://dial.test/api/v1/messages");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer test-key-not-real" });
    // A redirect is never followed: it would repeat the request as a GET.
    expect(calls[0]?.init.redirect).toBe("manual");
    // No channel: the number's own default applies.
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      to: TO,
      fromNumber: "+14155550100",
      body: "Your change is drafted.",
    });
  });

  it("folds the body into the basic alphabet, so the provider never switches to the wide encoding", async () => {
    const { fetchImpl, calls } = fetchReturning(() => jsonResponse({ message: { id: "msg_2" } }, 201));
    await sendSms(SENDER, { to: TO, body: "\u201cSeats\u201d \u2014 drafted \ud83d\ude80" }, { fetchImpl });
    expect(JSON.parse(String(calls[0]?.init.body)).body).toBe('"Seats" - drafted');
  });

  it("counts a message with no id as sent, because the provider took it", async () => {
    const { fetchImpl } = fetchReturning(() => jsonResponse({ message: { status: "sent" } }, 201));
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({ state: "sent", id: null });
  });

  it.each([
    ["a page", () => new Response("<html>Welcome</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["an empty body", () => new Response(null, { status: 204 })],
    ["JSON with no message", () => jsonResponse({ ok: true })],
    ["a message that is not an object", () => jsonResponse({ message: "queued" }, 201)],
  ])("does not count a 2xx with %s as sent: it is not the provider's answer", async (_name, answer) => {
    const { fetchImpl, calls } = fetchReturning(answer);
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({
      state: "unconfirmed",
      reason: "unreadable_answer",
    });
    expect(calls).toHaveLength(1);
  });

  it.each([`sent to ${TO}`, TO, "0".repeat(65), "", "a b"])(
    "does not keep a message id that is free text (%j), and the text is still sent",
    async (id) => {
      const { fetchImpl } = fetchReturning(() => jsonResponse({ message: { id } }, 201));
      expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({ state: "sent", id: null });
    },
  );

  it("reads a 303 as unconfirmed, because it says that the request was done, and does not follow it", async () => {
    const { fetchImpl, calls } = fetchReturning(
      () => new Response(null, { status: 303, headers: { location: "https://elsewhere.test/" } }),
    );
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({
      state: "unconfirmed",
      reason: "http_303",
    });
    expect(calls).toHaveLength(1);
  });

  it.each([301, 302, 307, 308])("reads a %i as refused for everyone: the address is wrong and nothing was sent", async (status) => {
    const { fetchImpl, calls } = fetchReturning(
      () => new Response(null, { status, headers: { location: "https://elsewhere.test/" } }),
    );
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({
      state: "refused",
      reason: `http_${status}`,
      forAll: true,
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["ECONNREFUSED", "unreachable"],
    ["ENOTFOUND", "unreachable"],
    ["EAI_AGAIN", "unreachable"],
    ["ERR_INVALID_URL", "bad_api_url"],
  ])("reads %s as refused for everyone: the request did not leave", async (code, reason) => {
    const { fetchImpl, calls } = fetchReturning(() => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect failed"), { code }) });
    });
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({ state: "refused", reason, forAll: true });
    expect(calls).toHaveLength(1);
  });

  it("reads a connection that broke after it opened as unconfirmed", async () => {
    for (const code of ["ECONNRESET", "UND_ERR_SOCKET", "EPIPE"]) {
      const { fetchImpl } = fetchReturning(() => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code }) });
      });
      expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({ state: "unconfirmed", reason: "network" });
    }
  });

  it("does not call the provider for a number that is not E.164 or for an empty body", async () => {
    const { fetchImpl, calls } = fetchReturning(() => jsonResponse({}, 201));
    expect(await sendSms(SENDER, { to: "415 555 0123", body: "hello" }, { fetchImpl })).toEqual({
      state: "refused",
      reason: "invalid_number",
      forAll: false,
    });
    expect(await sendSms(SENDER, { to: TO, body: "\ud83d\ude80" }, { fetchImpl })).toEqual({
      state: "refused",
      reason: "empty_body",
      forAll: false,
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [400, { error: { fieldErrors: { to: ["Invalid"] } } }, "http_400", false],
    [400, { error: "Content size exceeds carrier limit.", code: "bad_request" }, "bad_request", false],
    [401, { error: "Missing or invalid API key." }, "http_401", true],
    [402, { error: "Insufficient Dial credit.", code: "insufficient_credit" }, "insufficient_credit", true],
    [402, { error: { code: "insufficient_credit", message: "Add credit." } }, "insufficient_credit", true],
    [404, { error: "Not found" }, "http_404", false],
    [429, { error: "The recipient is rate-limited.", code: "rate_limited" }, "rate_limited", false],
  ])("reads a %i as refused: nothing was sent", async (status, body, reason, forAll) => {
    const { fetchImpl, calls } = fetchReturning(() => jsonResponse(body, status));
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({ state: "refused", reason, forAll });
    expect(calls).toHaveLength(1);
  });

  it.each([500, 502, 503])("reads a %i as unconfirmed and does not try again", async (status) => {
    const { fetchImpl, calls } = fetchReturning(() => jsonResponse({ error: "upstream" }, status));
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl })).toEqual({
      state: "unconfirmed",
      reason: `http_${status}`,
    });
    expect(calls).toHaveLength(1);
  });

  it("reads a dropped connection and a timeout as unconfirmed, with one attempt each", async () => {
    const dropped = fetchReturning(() => {
      throw new TypeError("fetch failed");
    });
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl: dropped.fetchImpl })).toEqual({
      state: "unconfirmed",
      reason: "network",
    });
    expect(dropped.calls).toHaveLength(1);

    const calls: Call[] = [];
    const never = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }) as unknown as typeof fetch;
    expect(await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl: never, timeoutMs: 20 })).toEqual({
      state: "unconfirmed",
      reason: "timeout",
    });
    expect(calls).toHaveLength(1);
  });

  it("never puts the number or the provider's words into the result", async () => {
    const answers = [
      jsonResponse({ error: `The number ${TO} cannot receive messages.`, code: `Refused ${TO}` }, 400),
      jsonResponse({ error: { code: TO, message: `Bad destination ${TO}` } }, 400),
      jsonResponse({ error: `Upstream failed for ${TO}` }, 503),
    ];
    for (const answer of answers) {
      const { fetchImpl } = fetchReturning(() => answer);
      const result = await sendSms(SENDER, { to: TO, body: "hello" }, { fetchImpl });
      expect(JSON.stringify(result)).not.toContain("4155550123");
      expect(JSON.stringify(result)).not.toContain("cannot receive");
      expect(result).toMatchObject({ reason: expect.stringMatching(/^http_\d{3}$/) });
    }
  });
});

describe("listNumbers", () => {
  it("reads the numbers of the account with the key and sends nothing", async () => {
    const { fetchImpl, calls } = fetchReturning(() =>
      jsonResponse({
        numbers: [
          {
            id: "num_1",
            number: "+14155550100",
            country: "US",
            capabilities: ["sms", "call"],
            setupStatus: "ready",
            tenDlc: { status: "approved", kind: "business" },
          },
          { id: "num_2", number: "+14155550101", capabilities: ["imessage", 7], tenDlc: null },
          { number: "no id" },
          "not a row",
        ],
      }),
    );
    const result = await listNumbers(SENDER, { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://dial.test/api/v1/numbers");
    expect(calls[0]?.init.method).toBeUndefined();
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer test-key-not-real" });
    expect(result).toEqual({
      ok: true,
      numbers: [
        { id: "num_1", number: "+14155550100", country: "US", capabilities: ["sms", "call"], setupStatus: "ready", tenDlcStatus: "approved" },
        { id: "num_2", number: "+14155550101", country: null, capabilities: ["imessage"], setupStatus: null, tenDlcStatus: null },
      ],
    });
  });

  it("answers with a reason code for a bad key, an unreadable answer and a dropped connection", async () => {
    const badKey = fetchReturning(() => jsonResponse({ error: "Missing or invalid API key." }, 401));
    expect(await listNumbers(SENDER, { fetchImpl: badKey.fetchImpl })).toEqual({ ok: false, reason: "http_401" });

    const odd = fetchReturning(() => jsonResponse({ numbers: "none" }));
    expect(await listNumbers(SENDER, { fetchImpl: odd.fetchImpl })).toEqual({ ok: false, reason: "unreadable_answer" });

    const dropped = fetchReturning(() => {
      throw new TypeError("fetch failed");
    });
    expect(await listNumbers(SENDER, { fetchImpl: dropped.fetchImpl })).toEqual({ ok: false, reason: "network" });

    const moved = fetchReturning(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } }));
    expect(await listNumbers(SENDER, { fetchImpl: moved.fetchImpl })).toEqual({ ok: false, reason: "http_302" });

    const refused = fetchReturning(() => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }) });
    });
    expect(await listNumbers(SENDER, { fetchImpl: refused.fetchImpl })).toEqual({ ok: false, reason: "unreachable" });
  });

  it("is not an answer when a failure status carries a list of numbers", async () => {
    // The sweep sends only after this call says ok, so only a 2xx can say it.
    const failing = fetchReturning(() => jsonResponse({ numbers: [] }, 500));
    expect(await listNumbers(SENDER, { fetchImpl: failing.fetchImpl })).toEqual({ ok: false, reason: "http_500" });
  });

  it("gives up after its time limit, with the signal that ends the call", async () => {
    let signal: AbortSignal | undefined;
    const never = ((_url: string, init: RequestInit = {}) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal?.reason));
      });
    }) as typeof fetch;
    expect(await listNumbers(SENDER, { fetchImpl: never, timeoutMs: 20 })).toEqual({ ok: false, reason: "timeout" });
    expect(signal?.aborted).toBe(true);
  });
});
