/**
 * `POST /api/site/observe`: the widget's own report of a page it scanned and a move it saw.
 *
 * This is the second door into the product map, and it takes the same rule as the turn: only the
 * site the project names teaches the map. A widget running on a preview deployment of an unmerged
 * branch is answered normally and nothing it saw is written down.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  project: null as Record<string, unknown> | null,
  scans: [] as string[],
  transitions: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => ({
  serviceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.project }) }) }),
    }),
  }),
}));

vi.mock("@/lib/graph/store", () => ({
  recordScan: async (_projectId: string, page: { url: string }) => {
    state.scans.push(page.url);
    return "/trips/:id/seats";
  },
  recordTransition: async (_projectId: string, transition: unknown) => {
    state.transitions.push(transition);
  },
}));

const { POST } = await import("@/app/api/site/observe/route");

const SEATS = {
  url: "http://localhost:4150/trips/NVA7K2/seats",
  title: "Choose Seats | NovaAir",
  affordances: [{ id: "s6", role: "button", name: "Find seats together", landmark: "sidebar", visible: true }],
};

const PREVIEW = {
  ...SEATS,
  url: "https://novaair-git-a1b2c3.example.com/trips/NVA7K2/seats",
};

function observe(page: unknown, transition?: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/site/observe", {
      method: "POST",
      body: JSON.stringify({ key: "embed-key", page, transition }),
    }),
  );
}

beforeEach(() => {
  state.project = { id: "project-1", site_url: "http://localhost:4150" };
  state.scans.length = 0;
  state.transitions.length = 0;
});

describe("POST /api/site/observe", () => {
  it("records a page of the project's own site, and the move that reached it", async () => {
    const response = await observe(SEATS, {
      fromUrl: "http://localhost:4150/trips/NVA7K2",
      control: { role: "link", name: "Change seats", landmark: "main" },
    });

    expect(response.status).toBe(200);
    expect(state.scans).toEqual([SEATS.url]);
    expect(state.transitions).toHaveLength(1);
  });

  it("writes nothing at all for a page from a preview deployment", async () => {
    const response = await observe(PREVIEW, {
      fromUrl: PREVIEW.url.replace("/seats", ""),
      control: { role: "link", name: "Change seats", landmark: "main" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.scans).toEqual([]);
    expect(state.transitions).toEqual([]);
  });

  /**
   * Nothing about a project is cached: the row is read on every call, so the moment the console
   * saves a new site the next report from that origin is recorded.
   */
  it("takes a page as soon as the project says that is where it lives", async () => {
    await observe(PREVIEW);
    expect(state.scans).toEqual([]);

    state.project = { id: "project-1", site_url: "https://novaair-git-a1b2c3.example.com" };
    await observe(PREVIEW);
    expect(state.scans).toEqual([PREVIEW.url]);
  });

  it("still records everything while the project has not said where its site is", async () => {
    state.project = { id: "project-1", site_url: null };
    await observe(PREVIEW);
    expect(state.scans).toEqual([PREVIEW.url]);
  });
});
