/**
 * `POST /api/escalate` with the optional request for the one text.
 *
 * The route and the subscribe code are real, the database is in memory, and the code that records
 * the report is mocked at the module boundary. What matters here: a number is stored only with
 * consent, a bad request is refused before anything is written, the report never depends on the
 * text, and the number is in no answer and no trace row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, resetDb, seen, tables, type Row } from "./support/fake-db";

const traces: { title: string; detail: unknown }[] = [];
const reported: unknown[] = [];
let groupStatus = "filed";

vi.mock("@/lib/supabase", () => ({ serviceClient: () => fakeClient() }));
vi.mock("@/lib/trace", () => ({
  emitTrace: async (input: { title: string; detail: unknown }) => {
    traces.push({ title: input.title, detail: input.detail });
  },
}));
vi.mock("@/lib/opportunity/queue", () => ({ triggerDiscovery: async () => undefined }));
vi.mock("@/lib/agent/requests", () => ({
  reportRequest: async (input: unknown) => {
    reported.push(input);
    return {
      group: { id: "g1", status: groupStatus, reportCount: 3, userReportCount: 2, priority: "medium" },
      action: "update",
      escalationId: "e1",
    };
  },
}));

const { POST } = await import("@/app/api/escalate/route");
const { openPhone } = await import("@/lib/sms/phone");

const original = { ...process.env };
const REQUEST = { title: "Seat a party together", description: "d", area: "seats", quote: "q", rationale: "r" };

const post = (body: unknown): Promise<Response> =>
  POST(new Request("http://localhost/api/escalate", { method: "POST", body: JSON.stringify(body) }));

const base = { key: "pk_test", conversationId: "c1", messageId: "m1", visitorId: "v1" };
const subscribers = (): Row[] => tables.gap_subscriber ?? [];
const writes = (): typeof seen => seen.filter((query) => query.verb !== "select");

beforeEach(() => {
  resetDb();
  traces.length = 0;
  reported.length = 0;
  groupStatus = "filed";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  delete process.env.ESCALATION_ENGINE;
  // The worker's heartbeat says that it can send a text, so the offer is on.
  tables.trace_event = [
    { id: 1, project_id: "p1", title: "worker online", detail: { engine: "local", sms: true }, created_at: new Date().toISOString() },
  ];
  tables.project = [{ id: "p1", embed_key: "pk_test", repo_full_name: "acme/app", repo_default_branch: "main", site_url: null }];
  tables.message = [{ id: "m1", content: "There is no way of that.", feature_request: REQUEST, conversation: { project_id: "p1" } }];
  tables.conversation = [{ id: "c1", visitor_id: "v1" }];
  tables.feature_request_group = [{ id: "g1", project_id: "p1", status: "filed" }];
});

afterEach(() => {
  process.env = { ...original };
});

describe("a report with no request for a text", () => {
  it("answers as before, with no notify field, and reads no subscriber table", async () => {
    const response = await post(base);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ escalationId: "e1", groupId: "g1", status: "queued" });
    expect(seen.some((query) => query.table === "gap_subscriber")).toBe(false);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.detail).not.toHaveProperty("textNotice");
  });

  it("reads a null notify as no request", async () => {
    const response = await post({ ...base, notify: null });
    expect(await response.json()).toEqual({ escalationId: "e1", groupId: "g1", status: "queued" });
    expect(subscribers()).toEqual([]);
  });
});

describe("a report that asks for the text", () => {
  it("stores the number as it is dialled and says subscribed", async () => {
    const response = await post({ ...base, notify: { phone: " +1 (415) 555-0123 ", consent: true } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ escalationId: "e1", groupId: "g1", status: "queued", notify: "subscribed" });

    expect(subscribers()).toHaveLength(1);
    const row = subscribers()[0] as Row;
    expect(row).toMatchObject({ project_id: "p1", group_id: "g1", message_id: "m1", notified_at: null });
    expect(openPhone(String(row.phone_sealed))).toBe("+14155550123");
  });

  it("puts the state in the trace and the number nowhere", async () => {
    const response = await post({ ...base, notify: { phone: "+1 415 555 0123", consent: true } });
    const said = JSON.stringify([await response.json(), traces, [...response.headers]]);
    expect(traces[0]?.detail).toMatchObject({ textNotice: { state: "subscribed" } });
    for (const part of ["4155550123", "415 555 0123", "555-0123"]) expect(said).not.toContain(part);
    expect(JSON.stringify(subscribers())).not.toContain("4155550123");
  });

  it("records the report first, for the gap that the report joined", async () => {
    await post({ ...base, notify: { phone: "+14155550123", consent: true } });
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ messageId: "m1", conversationId: "c1" });
    expect(JSON.stringify(reported)).not.toContain("4155550123");
  });

  it("stores nothing and says not_needed when a change is already drafted", async () => {
    groupStatus = "pr_open";
    const response = await post({ ...base, notify: { phone: "+14155550123", consent: true } });
    expect(await response.json()).toMatchObject({ escalationId: "e1", notify: "not_needed" });
    expect(subscribers()).toEqual([]);
    expect(traces[0]?.detail).toMatchObject({ textNotice: { state: "not_needed" } });
  });

  it("still records the report when no runner can send the text, and says so in the trace", async () => {
    tables.trace_event = [];
    const response = await post({ ...base, notify: { phone: "+14155550123", consent: true } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ escalationId: "e1", notify: "unavailable" });
    expect(reported).toHaveLength(1);
    expect(subscribers()).toEqual([]);
    expect(traces[0]?.detail).toMatchObject({ textNotice: { state: "unavailable", reason: "the worker is not running" } });
  });
});

describe("a request for a text that is refused before anything is written", () => {
  it.each([
    ["no consent field", { phone: "+14155550123" }],
    ["consent false", { phone: "+14155550123", consent: false }],
    ["consent as a word", { phone: "+14155550123", consent: "true" }],
    ["consent as a number", { phone: "+14155550123", consent: 1 }],
    ["a string", "+14155550123"],
    ["a list", ["+14155550123", true]],
    ["a number", 14155550123],
    ["true", true],
  ])("refuses %s with consent_required", async (_name, notify) => {
    const response = await post({ ...base, notify });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "consent_required" });
    expect(reported).toEqual([]);
    expect(seen).toEqual([]);
    expect(traces).toEqual([]);
  });

  it.each([
    ["no number", { consent: true }],
    ["an empty number", { phone: "", consent: true }],
    ["no country code", { phone: "415 555 0123", consent: true }],
    ["letters", { phone: "+1 415 555 O123", consent: true }],
    ["a number that is not a string", { phone: 14155550123, consent: true }],
    ["two numbers", { phone: "+14155550123,+14155550124", consent: true }],
    ["a list", { phone: ["+14155550123"], consent: true }],
  ])("refuses %s with invalid_phone", async (_name, notify) => {
    const response = await post({ ...base, notify });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { reason: string; error: string };
    expect(body.reason).toBe("invalid_phone");
    // The answer says what is wrong and does not repeat what was typed.
    expect(body.error).not.toContain("O123");
    expect(reported).toEqual([]);
    expect(seen).toEqual([]);
  });
});

describe("a report that is refused for its own reason", () => {
  const notify = { phone: "+14155550123", consent: true };

  it("stores no number for an unknown key", async () => {
    const response = await post({ ...base, key: "pk_wrong", notify });
    expect(response.status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it("stores no number when no repository is connected", async () => {
    (tables.project?.[0] as Row).repo_full_name = null;
    const response = await post({ ...base, notify });
    expect(response.status).toBe(409);
    expect(writes()).toEqual([]);
  });

  it("stores no number for a message of a different project", async () => {
    (tables.message?.[0] as Row).conversation = { project_id: "p2" };
    const response = await post({ ...base, notify });
    expect(response.status).toBe(400);
    expect(writes()).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("stores no number when the engine cannot run, and writes nothing", async () => {
    process.env.ESCALATION_ENGINE = "forge";
    process.env.FORGE_STRATEGY = "runloop";
    delete process.env.RUNLOOP_API_KEY;
    const response = await post({ ...base, notify });
    expect(response.status).toBe(503);
    expect(seen).toEqual([]);
  });
});
