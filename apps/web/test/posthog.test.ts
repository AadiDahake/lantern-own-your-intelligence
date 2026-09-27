/**
 * The PostHog client and the HogQL queries, offline: the queries are checked for the shapes the
 * endpoint documents, the parser runs over rows a real query returned, and the client is driven
 * with a stub `fetch`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countManualActions } from "@lantern/capability";
import { HttpPosthogClient, PosthogError, replayUrl } from "@/lib/posthog/client";
import { headlineQuery, outcomeQuery, STEP_PROPERTIES, trajectoryQuery } from "@/lib/posthog/hogql";
import { collapseDuplicates, REASON_ALIASES, toStep, toTrajectories, toTrajectory } from "@/lib/posthog/trajectories";

type Rows = { columns: string[]; results: unknown[][] };

function fixture(name: string): Rows {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", "posthog", name), "utf8")) as Rows;
}

describe("hogql", () => {
  it("scans events once, filters the window first, and never pages with OFFSET", () => {
    const query = trajectoryQuery({ windowDays: 90, limit: 200 });
    expect(query).toContain("INTERVAL 90 DAY");
    expect(query).toContain("LIMIT 200");
    expect(query).not.toMatch(/OFFSET/i);
    expect((query.match(/FROM events/g) ?? []).length).toBe(1);
    expect(query).toContain("HAVING n_open > 0 AND n_confirm > 0");
    expect(query).toContain("arraySort(groupArray(tuple(timestamp, event,");
  });

  it("carries every step property the parser reads back, in order", () => {
    const query = trajectoryQuery({ windowDays: 30, limit: 10 });
    for (const name of STEP_PROPERTIES) expect(query).toContain(`toString(properties.${name})`);
    const first = query.indexOf("toString(properties.seat)");
    const last = query.indexOf("toString(properties.slug)");
    expect(first).toBeLessThan(last);
  });

  it("counts the same manual events the compiler counts in the headline", () => {
    const query = headlineQuery({ windowDays: 90 });
    expect(query).toContain("'seat_hovered', 'seat_selected', 'seat_selection_rejected', 'passenger_selected'");
    expect(query).toContain("median(manual_actions)");
    expect(query).toContain("median(interactions)");
  });

  it("names the outcome events after the intent and reads the seeded flag", () => {
    const query = outcomeQuery({ intent: "seat_party_together", windowDays: 90 });
    expect(query).toContain("'seat_party_together_eligible'");
    expect(query).toContain("'seat_party_together_used'");
    expect(query).toContain("'seat_party_together_succeeded'");
    expect(query).toContain("toString(properties.seeded) = 'true'");
    expect(query).toContain("toString(properties.capability) = 'seat_party_together'");
  });
});

describe("toTrajectories", () => {
  const rows = fixture("trajectory-rows.json");

  it("returns one trajectory per session row with typed, ordered steps", () => {
    const trajectories = toTrajectories(rows.columns, rows.results);
    expect(trajectories.length).toBe(rows.results.length);
    for (const t of trajectories) {
      expect(t.session_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(t.opened_at <= (t.confirmed_at ?? "")).toBe(true);
      expect(t.steps[0]?.event).toBe("seat_map_opened");
      expect(t.steps[t.steps.length - 1]?.event).toBe("seat_assignment_confirmed");
      for (let i = 1; i < t.steps.length; i += 1) {
        expect(Date.parse((t.steps[i - 1] as { t: string }).t) <= Date.parse((t.steps[i] as { t: string }).t)).toBe(true);
      }
      expect(t.step_count).toBe(t.steps.length);
    }
  });

  it("gives every property its type back and drops the missing ones", () => {
    const [first] = toTrajectories(rows.columns, rows.results);
    const opened = first?.steps.find((s) => s.event === "seat_map_opened");
    expect(typeof opened?.props.party_size).toBe("number");
    expect(Array.isArray(opened?.props.current_seats)).toBe(true);
    expect(opened?.props).not.toHaveProperty("seat");
    const confirmed = first?.steps.find((s) => s.event === "seat_assignment_confirmed");
    expect(typeof confirmed?.props.same_row).toBe("boolean");
    expect(typeof confirmed?.props.interactions).toBe("number");
    expect(Array.isArray(confirmed?.props.seats)).toBe(true);
    const hovered = first?.steps.find((s) => s.event === "seat_hovered");
    expect(typeof hovered?.props.row).toBe("number");
    expect(typeof hovered?.props.seat).toBe("string");
  });

  it("spells NovaAir's refusal reasons the way the compiler's scenario rules do", () => {
    const reasons = new Set(
      toTrajectories(rows.columns, rows.results)
        .flatMap((t) => t.steps)
        .filter((s) => s.event === "seat_selection_rejected")
        .map((s) => String(s.props.reason)),
    );
    for (const reason of reasons) expect(Object.values(REASON_ALIASES)).toContain(reason);
    expect(toStep(["2026-08-30T00:00:00Z", "seat_selection_rejected", "8F", null, null, null, null, null, null, "seat_booked"])?.props.reason).toBe("booked");
    expect(toStep(["2026-08-30T00:00:00Z", "seat_selection_rejected", "16C", null, null, null, null, null, null, "exit_row_child"])?.props.reason).toBe("child_in_exit_row");
  });

  it("collapses the opening event a development double mount sends twice", () => {
    const steps = [
      { t: "2026-08-30T00:00:00.000Z", event: "seat_map_opened", props: { party_size: 3 } },
      { t: "2026-08-30T00:00:00.004Z", event: "seat_map_opened", props: { party_size: 3 } },
      { t: "2026-08-30T00:00:02.000Z", event: "seat_hovered", props: { seat: "21A" } },
      { t: "2026-08-30T00:00:04.000Z", event: "seat_hovered", props: { seat: "21A" } },
    ];
    const collapsed = collapseDuplicates(steps);
    expect(collapsed.map((s) => s.t)).toEqual(["2026-08-30T00:00:00.000Z", "2026-08-30T00:00:02.000Z", "2026-08-30T00:00:04.000Z"]);
    const manual = toTrajectories(rows.columns, rows.results).map((t) => countManualActions(t.steps));
    expect(manual.every((n) => n > 0)).toBe(true);
  });

  it("drops a row with no session id or no steps", () => {
    expect(toTrajectory(rows.columns, [null, "u", "2026-08-30T00:00:00Z", "2026-08-30T00:01:00Z", 60, 0, []])).toBeNull();
    expect(toTrajectory(rows.columns, ["s1", "u", "2026-08-30T00:00:00Z", "2026-08-30T00:01:00Z", 60, 0, []])).toBeNull();
    expect(toStep("not a tuple")).toBeNull();
  });
});

describe("HttpPosthogClient", () => {
  const config = { host: "https://us.posthog.com", projectId: "12345", apiKey: "phx_test" };

  it("posts a named HogQL query with the bearer key and returns the rows", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ columns: ["n"], results: [[63]], types: [["n", "UInt64"]], is_cached: false }), { status: 200 });
    }) as typeof fetch;
    const client = new HttpPosthogClient({ ...config, fetchImpl });
    const result = await client.query("lantern_test", "SELECT count() AS n FROM events");
    expect(result.results).toEqual([[63]]);
    expect(result.columns).toEqual(["n"]);
    expect(calls[0]?.url).toBe("https://us.posthog.com/api/projects/12345/query/");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer phx_test");
    const body = JSON.parse(String(calls[0]?.init.body)) as { query: { kind: string; query: string }; name: string };
    expect(body.query.kind).toBe("HogQLQuery");
    expect(body.name).toBe("lantern_test");
  });

  it("raises a PosthogError with the status on a failed query", async () => {
    const fetchImpl = (async () => new Response('{"detail":"rate limited"}', { status: 429 })) as typeof fetch;
    const client = new HttpPosthogClient({ ...config, fetchImpl });
    await expect(client.query("x", "SELECT 1")).rejects.toBeInstanceOf(PosthogError);
    await expect(client.query("x", "SELECT 1")).rejects.toMatchObject({ status: 429, queryName: "x" });
  });

  it("reads a recording's existence off the status code", async () => {
    const fetchImpl = (async (url: string | URL | Request) =>
      new Response("{}", { status: String(url).includes("missing") ? 404 : 200 })) as typeof fetch;
    const client = new HttpPosthogClient({ ...config, fetchImpl });
    expect(await client.recordingExists("present")).toBe(true);
    expect(await client.recordingExists("missing")).toBe(false);
  });

  it("builds the replay deep link from the project id and the session id", () => {
    expect(replayUrl("https://us.posthog.com/", "12345", "abc")).toBe("https://us.posthog.com/project/12345/replay/abc");
    expect(replayUrl("https://us.posthog.com", "12345", "abc", { atSeconds: 42.7 })).toBe("https://us.posthog.com/project/12345/replay/abc?t=42");
    expect(new HttpPosthogClient(config).replayUrl("abc")).toBe("https://us.posthog.com/project/12345/replay/abc");
  });
});
