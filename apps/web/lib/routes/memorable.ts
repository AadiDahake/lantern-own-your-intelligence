/**
 * One completed walk as a Memorable trace, and the call that extracts it.
 *
 * Memorable reads only `input.command`, so the command line is the whole contract. It carries the
 * control's identity and nothing else: role, accessible name, landmark, link target, route. Never
 * a value the user typed, an id, a time or model text, so two equal walks give two equal traces.
 * Documented at https://www.memorable.sh/doc/api (`POST /v1/extract`).
 */

export type WalkStep = {
  caption: string;
  advanceOn: "click" | "input" | "navigation" | "manual";
  control: { role: string; name: string; landmark?: string; href?: string; route: string };
};

export type MemorableTrace = {
  session_id: string;
  harness: "lantern";
  task_description: string;
  skip_embedding: boolean;
  tool_calls: { name: string; input: { command: string }; result: { ok: boolean } }[];
};

export type Extraction =
  | { status: "extracted"; title: string | null; draft: unknown }
  | { status: "refused"; reason: string }
  | { status: "failed"; reason: string };

/** `name="Change seats"`, with the quote and the backslash escaped. */
function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `press role=button name="Change seats" landmark=main route=/trips/NVA7K2`. */
export function commandFor(step: WalkStep): string {
  const verb = step.advanceOn === "input" ? "fill" : "press";
  const { control } = step;
  const parts = [verb, `role=${control.role.toLowerCase()}`, `name=${quoted(control.name.trim())}`];
  if (control.landmark) parts.push(`landmark=${control.landmark}`);
  if (control.href) parts.push(`href=${control.href}`);
  parts.push(`route=${control.route}`);
  return parts.join(" ");
}

export function traceFor(input: { walkId: string; question: string; steps: WalkStep[] }): MemorableTrace {
  return {
    session_id: `walk-${input.walkId}`,
    harness: "lantern",
    task_description: input.question.slice(0, 2000),
    skip_embedding: false,
    tool_calls: input.steps.map((step) => ({
      name: step.advanceOn === "input" ? "fill" : "press",
      input: { command: commandFor(step) },
      result: { ok: true },
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sends one trace to `POST /v1/extract`. Never throws: a refusal and a failure are answers, and
 * the walk is remembered either way. The response is untrusted input and is read defensively.
 */
export async function extract(
  trace: MemorableTrace,
  options: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch },
): Promise<Extraction> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, "")}/v1/extract`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(trace),
      signal: AbortSignal.timeout(15_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = isRecord(body) && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
      return { status: "failed", reason: error };
    }
    if (!isRecord(body)) return { status: "failed", reason: "the response was not a JSON object" };
    if (typeof body.refused === "string" && body.refused) return { status: "refused", reason: body.refused };
    if (isRecord(body.judge) && body.judge.admitted === false) return { status: "refused", reason: "not admitted" };
    const draft = isRecord(body.draft) ? body.draft : null;
    if (!draft) return { status: "failed", reason: "the response had no draft" };
    return { status: "extracted", title: typeof draft.title === "string" ? draft.title : null, draft };
  } catch (error) {
    return { status: "failed", reason: (error as Error).message };
  }
}
