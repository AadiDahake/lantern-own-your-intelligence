/**
 * One turn, end to end, against a stubbed provider and a stubbed database.
 *
 * The two cases are the whole point of intent routing: "Hello, can you hear me?" is answered
 * without a single check and with nothing offered to report, and "Where do I change my seat?"
 * still runs the three checks and still comes back with a walk over the product map.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, PageContext } from "@lantern/shared";
import {
  CONTROLS,
  NOVAAIR_GRAPH,
  NOVAAIR_GRAPH_AFTER,
} from "../../../packages/shared/test/fixtures/novaair-graph";
import type { KnownRoute } from "@/lib/graph/store";
import { TRIP_PAGE } from "./fixtures/intents";

/** Every structured call the turn made, by the name it was sent under. */
const calls: { name: string; user: string }[] = [];
/** What each named call answers with. A call with no answer here is a fault in the test. */
let answers: Record<string, unknown> = {};
/** The rows the documentation search returns. Empty means the knowledge base has nothing. */
let chunks: Record<string, unknown>[] = [];
/** Every write the turn made, in order. */
const writes: { table: string; op: string; values: unknown }[] = [];
/** The project row the turn reads when it needs to know what the project is bound to. */
let projectRow: Record<string, unknown> = { id: "project-1", repo_full_name: "novaair/novaair" };

vi.mock("@/lib/openai", () => ({
  chatJson: async (
    _model: string,
    messages: { role: string; content: string }[],
    _schema: unknown,
    options: { name?: string },
  ) => {
    const name = options.name ?? "";
    const user = messages[messages.length - 1]?.content ?? "";
    calls.push({ name, user });
    if (!(name in answers)) throw new Error(`the turn made an unexpected "${name}" call`);
    const scripted = answers[name];
    // An answer may be a function, so a stand-in for the model can read the prompt it was given
    // and choose the way the model does: by the name of a control, never by its position.
    return typeof scripted === "function" ? (scripted as (prompt: string) => unknown)(user) : scripted;
  },
  embed: async (inputs: string[]) => inputs.map(() => new Array(1536).fill(0)),
}));

vi.mock("@/lib/trace", () => ({ emitTrace: async () => undefined }));

class FakeQuery {
  constructor(private readonly table: string) {}

  insert(values: unknown): this {
    writes.push({ table: this.table, op: "insert", values });
    return this;
  }
  update(values: unknown): this {
    writes.push({ table: this.table, op: "update", values });
    return this;
  }
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  async single(): Promise<{ data: { id: string }; error: null }> {
    return { data: { id: `${this.table}-1` }, error: null };
  }
  // The project row as the database holds it, which is the authority on the repository binding.
  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    return { data: this.table === "project" ? projectRow : null, error: null };
  }
  // `update(...).eq(...)` is awaited without a terminal call of its own.
  then<T>(resolve: (value: { data: null; error: null }) => T): T {
    return resolve({ data: null, error: null });
  }
}

vi.mock("@/lib/supabase", () => ({
  serviceClient: () => ({
    from: (table: string) => new FakeQuery(table),
    rpc: async (name: string) =>
      name === "match_chunks_with_source" ? { data: chunks, error: null } : { data: [], error: null },
  }),
}));

/** The route this question resolved to last time, when the test wants one. */
let remembered: KnownRoute | null = null;
/** The product map this turn plans over: before the capability is built, or after. */
let graph: typeof NOVAAIR_GRAPH = NOVAAIR_GRAPH;
/** Every route the turn remembered for the next visitor. */
const saved: unknown[] = [];

/** Every page scan the turn wrote into the product map. */
const scans: string[] = [];

vi.mock("@/lib/graph/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graph/store")>();
  return {
    ...actual,
    recordScan: async (_projectId: string, page: PageContext) => {
      scans.push(page.url);
      return "page-1";
    },
    loadGraph: async () => graph,
    findKnownRoute: async () => remembered,
    nearestKnownRoute: async () => null,
    saveKnownRoute: async (_projectId: string, input: unknown) => {
      saved.push(input);
    },
    touchKnownRoute: async () => undefined,
  };
});

vi.mock("@/lib/agent/memory", () => ({
  loadVisitorFacts: async () => [],
  rememberFromTurn: async () => [],
}));

vi.mock("@/lib/agent/summary", () => ({ closeConversation: async () => "solved" }));

vi.mock("@/lib/agent/requests", () => ({
  noteRequest: async () => ({ noted: true, groupId: "group-1" }),
}));

/** The opportunity pipeline the absence path enqueues, kept off this turn and out of the network. */
const discoveries: unknown[] = [];
vi.mock("@/lib/opportunity/queue", () => ({
  triggerDiscovery: async (input: unknown) => {
    discoveries.push(input);
  },
}));

const { runTurn } = await import("@/lib/agent/turn");

/** The whole stream of one turn, in the order the widget would receive it. */
async function stream(
  question: string,
  page: PageContext = TRIP_PAGE,
  repoFullName: string | null = "novaair/novaair",
  siteUrl: string | null = "http://localhost:4150",
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of runTurn({
    projectId: "project-1",
    repoFullName,
    defaultBranch: "main",
    siteUrl,
    question,
    page,
  })) {
    events.push(event);
  }
  return events;
}

/** The seat map: a wall of buttons that each share one word with a question about seats. */
const SEAT_MAP: PageContext = {
  url: "http://localhost:4150/trips/NVA7K2/seats",
  title: "Choose Seats | NovaAir",
  text: "Choose Seats. Select a passenger, then select a seat. One passenger moves at a time.",
  affordances: [
    { id: "s1", role: "link", name: "Manage Trip", landmark: "sidebar", href: "/trips/NVA7K2", visible: true },
    { id: "s2", role: "button", name: "Seat 1C, available, 45 dollars", landmark: "main", visible: true },
    { id: "s3", role: "button", name: "Seat 1D, available, 45 dollars", landmark: "main", visible: true },
    { id: "s4", role: "button", name: "Seat 1E, available, 45 dollars", landmark: "main", visible: true },
    { id: "s5", role: "button", name: "Confirm seats", landmark: "main", visible: true },
  ],
};

/** The same seat map on the day the capability ships. */
const SEAT_MAP_AFTER: PageContext = {
  ...SEAT_MAP,
  affordances: [
    ...SEAT_MAP.affordances,
    { id: "s6", role: "button", name: "Find seats together", landmark: "main", visible: true },
  ],
};

const HOME: PageContext = {
  url: "http://localhost:4150/",
  title: "NovaAir",
  text: "NovaAir. Fly the quiet way.",
  affordances: [
    { id: "h1", role: "link", name: "My Booking", landmark: "sidebar", href: "/my-booking", visible: true },
    { id: "h2", role: "link", name: "My Booking", landmark: "main", href: "/my-booking", visible: true },
    { id: "h3", role: "link", name: "Find a flight", landmark: "main", href: "/flights", visible: true },
  ],
};

const SEATS_TOGETHER = "I'm traveling with my two kids. Can you find us three seats together?";

/** The passage the seats-together question really lands on, and what it really says. */
const CHILDREN_PASSAGE = {
  document_title: "Traveling with children",
  source_ref: "http://localhost:4150/help/traveling-with-children",
  heading: "Traveling with children",
  content: "A child under 13 must sit next to an adult on the same booking. Move one passenger at a time.",
  similarity: 0.62,
  confidence: null,
};

const answerOf = (events: ChatEvent[]) => events.find((event) => event.type === "answer");

beforeEach(() => {
  calls.length = 0;
  writes.length = 0;
  saved.length = 0;
  scans.length = 0;
  projectRow = { id: "project-1", repo_full_name: "novaair/novaair" };
  chunks = [];
  answers = {};
  remembered = null;
  graph = NOVAAIR_GRAPH;
  discoveries.length = 0;
});

describe('"Hello, can you hear me?"', () => {
  beforeEach(() => {
    answers = {
      understanding: { intent: "chat", feature: "" },
      chat_answer: { answer: "I can read you. Ask me anything about this page.", found: true },
    };
  });

  it("answers from the model, with no check and nothing to report", async () => {
    const events = await stream("Hello, can you hear me?");

    expect(events.filter((event) => event.type === "probe")).toEqual([]);
    expect(events.filter((event) => event.type === "verdict")).toEqual([]);
    const answer = answerOf(events);
    expect(answer?.text).toBe("I can read you. Ask me anything about this page.");
    expect(answer?.steps).toBeNull();
    expect(answer?.escalation).toEqual({ offered: false });
    expect(answer?.noted).toBe(false);
  });

  it("makes exactly two model calls: the read, and the answer", async () => {
    await stream("Hello, can you hear me?");
    expect(calls.map((call) => call.name)).toEqual(["understanding", "chat_answer"]);
  });

  it("says the message is chat, and names no capability", async () => {
    const events = await stream("Hello, can you hear me?");
    const understanding = events.find((event) => event.type === "understanding");
    expect(understanding).toMatchObject({ intent: "chat", feature: "" });
  });

  it("stores the answer with no verdict and no feature request", async () => {
    await stream("Hello, can you hear me?");
    const message = writes.find(
      (write) => write.table === "message" && (write.values as { role?: string }).role === "assistant",
    );
    expect(message?.values).toMatchObject({ role: "assistant", steps: null, probes: [], verdict: null, feature_request: null });
  });
});

describe('"Where do I change my seat?"', () => {
  beforeEach(() => {
    chunks = [
      {
        document_title: "How do I change my seat?",
        source_ref: "http://localhost:4150/help/how-do-i-change-my-seat",
        heading: "Change a seat online",
        content: "Open Manage Trip, go to the Seats section and select Change seats to change your seat.",
        similarity: 0.94,
        confidence: null,
      },
    ];
    answers = {
      understanding: { intent: "product", feature: "changing a seat" },
      resolve_target: {
        target: "c1",
        answer: 'You can do this with "Change seats" on Manage Trip. I will show you.',
        captions: ["Select the Seats tab", "Open Change seats"],
      },
    };
  });

  it("runs the three checks and comes back with a walk", async () => {
    const events = await stream("Where do I change my seat?");

    expect(events.filter((event) => event.type === "probe" && event.status === "done").map((event) => event.probe)).toEqual([
      "docs",
      "interface",
      "repository",
    ]);
    const verdict = events.find((event) => event.type === "verdict");
    expect(verdict?.verdict.outcome).toBe("answer");

    const answer = answerOf(events);
    expect(answer?.steps?.length).toBeGreaterThan(0);
    // The first step is bound to a control the widget really sent, by its identity on the map.
    expect(answer?.steps?.[0]?.target).toBe("a4");
    expect(answer?.steps?.[0]?.control?.name).toBe("Change seats");
    expect(answer?.plan).toMatchObject({ source: "graph", total: answer?.steps?.length });
    expect(answer?.escalation).toEqual({ offered: false });
  });

  it("never drafts a feature request when the product has the control", async () => {
    await stream("Where do I change my seat?");
    expect(calls.map((call) => call.name)).toEqual(["understanding", "resolve_target"]);
  });
});

describe('"What is my confirmation code?"', () => {
  beforeEach(() => {
    answers = {
      understanding: { intent: "page", feature: "" },
      page_answer: { answer: "Your confirmation code is NVA7K2.", found: true },
    };
  });

  it("answers from the page, with no check and nothing to report", async () => {
    const events = await stream("What is my confirmation code?");

    expect(events.filter((event) => event.type === "probe")).toEqual([]);
    expect(calls.map((call) => call.name)).toEqual(["understanding", "page_answer"]);
    const answer = answerOf(events);
    expect(answer?.text).toBe("Your confirmation code is NVA7K2.");
    expect(answer?.escalation).toEqual({ offered: false });
  });

  it("gives the model the page's own words and its controls", async () => {
    await stream("What is my confirmation code?");
    const call = calls.find((entry) => entry.name === "page_answer")!;
    expect(call.user).toContain("Confirmation NVA7K2");
    expect(call.user).toContain('link "Change seats"');
  });
});

describe('a mixed message whose product half is missing', () => {
  beforeEach(() => {
    chunks = [
      {
        document_title: "Traveling with children",
        source_ref: "http://localhost:4150/help/traveling-with-children",
        heading: "Lap infants",
        content: "A lap infant under two years old travels free on domestic flights. Call us to add one.",
        similarity: 0.6,
        confidence: null,
      },
    ];
    answers = {
      understanding: { intent: "mixed", feature: "adding a lap infant" },
      passage_read: { covers: false, reason: "the passage says to call, not that the product does it" },
      verdict: { exists: false, confidence: 0.8, reasoning: "no control and no passage says it can be done" },
      feature_request: {
        title: "Add a lap infant to a booking",
        description: "Let a passenger add an infant under two to an existing booking.",
        area: "booking",
        quote: "Are lap infants free, and how do I add one to this booking?",
        rationale: "The help center sends the customer to the phone.",
      },
      passage_answer: { answer: "A lap infant under two flies free on domestic flights.", found: true },
    };
  });

  it("answers from the documentation first, then states the absence", async () => {
    const events = await stream("Are lap infants free, and how do I add one to this booking?");

    const verdict = events.find((event) => event.type === "verdict");
    expect(verdict?.verdict.outcome).toBe("absent");
    const answer = answerOf(events);
    expect(answer?.text).toMatch(/^A lap infant under two flies free on domestic flights\./);
    expect(answer?.text).toContain("There is still no way of adding a lap infant here today.");
    expect(answer?.escalation).toMatchObject({ offered: true });
    expect(answer?.noted).toBe(true);
    // The gap goes to the opportunity pipeline, off this turn.
    expect(discoveries).toHaveLength(1);
    expect(answer?.sources).toEqual([
      { title: "Traveling with children", url: "http://localhost:4150/help/traveling-with-children" },
    ]);
  });
});

describe("a question asked before", () => {
  it("answers from the product map without waiting for the message to be read", async () => {
    // The read is in flight, as it is on every turn, and this one never comes back. The turn
    // still finishes, which is what "served before the message is read" means.
    answers = { understanding: new Promise(() => undefined) };
    remembered = {
      id: "route-1",
      intent: "change my seat where",
      feature: "changing a seat",
      question: "Where do I change my seat?",
      target: { route: CONTROLS.changeSeats.route, key: CONTROLS.changeSeats.key },
      answer: 'You can do this with "Change seats" on Manage Trip. I will show you.',
      sources: [],
      hitCount: 3,
      similarity: null,
    };

    const events = await stream("Where do I change my seat?");

    expect(calls.map((call) => call.name)).toEqual(["understanding"]);
    const answer = answerOf(events);
    expect(answer?.plan).toMatchObject({ source: "cached", total: 1 });
    expect(events.find((event) => event.type === "understanding")).toMatchObject({ intent: "product" });
  });
});

describe("a capability the product does not have", () => {
  beforeEach(() => {
    chunks = [CHILDREN_PASSAGE];
    answers = {
      understanding: { intent: "product", feature: "finding seats together" },
      passage_read: { covers: false, reason: "it says to move one passenger at a time" },
      verdict: { exists: false, confidence: 0.9, reasoning: "no control and no passage says it can be done" },
      feature_request: {
        title: "Find seats together for a party",
        description: "Let a family take three seats side by side in one move.",
        area: "seats",
        quote: "Can you find us three seats together?",
        rationale: "Today they rebook one passenger at a time.",
      },
    };
  });

  it("states the absence and offers the report, from the seat map", async () => {
    const events = await stream(SEATS_TOGETHER, SEAT_MAP);
    const answer = answerOf(events);

    expect(events.find((event) => event.type === "verdict")?.verdict.outcome).toBe("absent");
    expect(answer?.steps).toBeNull();
    expect(answer?.plan).toBeUndefined();
    expect(answer?.text).toContain("there is no way of finding seats together here today");
    expect(answer?.text).toContain("I can report this to the developers");
    expect(answer?.escalation).toMatchObject({ offered: true });
  });

  it("never asks a model to find steps on the page it is standing on", async () => {
    await stream(SEATS_TOGETHER, SEAT_MAP);
    // No "resolve_target" and no "plan" is scripted, so either call would have thrown by name.
    expect(calls.map((call) => call.name)).toEqual([
      "understanding",
      "passage_read",
      "verdict",
      "feature_request",
    ]);
  });

  it("returns no step whose target is a seat button, from any page", async () => {
    for (const page of [SEAT_MAP, TRIP_PAGE, HOME]) {
      const answer = answerOf(await stream(SEATS_TOGETHER, page));
      const seats = new Set(
        page.affordances.filter((affordance) => affordance.name.startsWith("Seat ")).map((affordance) => affordance.id),
      );
      for (const step of answer?.steps ?? []) expect(seats.has(String(step.target))).toBe(false);
      expect(answer?.steps).toBeNull();
    }
  });

  it("says so without offering a report when there is no repository to file against", async () => {
    projectRow = { id: "project-1", repo_full_name: null };
    const answer = answerOf(await stream(SEATS_TOGETHER, SEAT_MAP, null));
    expect(answer?.text).not.toContain("report");
    expect(answer?.escalation).toMatchObject({ offered: false });
  });
});

describe("the same question once the capability is built", () => {
  beforeEach(() => {
    graph = NOVAAIR_GRAPH_AFTER;
    chunks = [CHILDREN_PASSAGE];
    answers = {
      passage_read: { covers: false, reason: "it says to move one passenger at a time" },
      resolve_target: {
        target: "c1",
        answer: "NovaAir supports this directly now. I will show you.",
        captions: ["Select Find seats together"],
      },
    };
  });

  it("resolves to the new control and spotlights it as the one step there is", async () => {
    // The verb the reading reaches for must not decide the answer: the button is named for one
    // verb, and the visitor may as easily have used another.
    for (const feature of ["finding seats together", "getting seats together"]) {
      answers.understanding = { intent: "product", feature };
      const events = await stream("Okay, how do I get seats together now?", SEAT_MAP_AFTER);
      const answer = answerOf(events);

      expect(events.find((event) => event.type === "verdict")?.verdict.outcome).toBe("answer");
      expect(answer?.plan).toMatchObject({ source: "graph", total: 1 });
      expect(answer?.steps?.map((step) => step.target)).toEqual(["s6"]);
      expect(answer?.steps?.[0]?.control?.name).toBe("Find seats together");
      expect(answer?.text).toContain("NovaAir supports this directly");
      // Nothing is missing any more, so nothing is drafted and nothing is offered.
      expect(answer?.escalation).toMatchObject({ offered: false });
      expect(calls.map((call) => call.name)).not.toContain("feature_request");
      expect(discoveries).toHaveLength(0);
    }
  });

  it("remembers the route, so the next visitor is answered without a model", async () => {
    answers.understanding = { intent: "product", feature: "finding seats together" };
    await stream("Okay, how do I get seats together now?", SEAT_MAP_AFTER);
    expect(scans).toEqual([SEAT_MAP_AFTER.url]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ target: { key: "button|find seats together|main|" } });
  });

  /**
   * The same page, served by a preview deployment of the branch that adds the control. It is the
   * product the project is bound to, but it is not the product its visitors are using, and a
   * control learned here would be planned for someone standing on the live site tomorrow.
   */
  it("answers from a preview deployment and teaches the product map nothing", async () => {
    answers.understanding = { intent: "product", feature: "finding seats together" };
    const preview: PageContext = {
      ...SEAT_MAP_AFTER,
      url: "https://novaair-git-a1b2c3.example.com/trips/NVA7K2/seats",
    };

    const answer = answerOf(
      await stream("Okay, how do I get seats together now?", preview, "novaair/novaair", "http://localhost:4150"),
    );

    // The visitor in front of it is still answered from the controls the page really has.
    expect(answer?.steps?.map((step) => step.target)).toEqual(["s6"]);
    // And nothing about that page is written down.
    expect(scans).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("still learns from a project that has not said where its site is", async () => {
    answers.understanding = { intent: "product", feature: "finding seats together" };
    await stream("Okay, how do I get seats together now?", SEAT_MAP_AFTER, "novaair/novaair", null);
    expect(scans).toEqual([SEAT_MAP_AFTER.url]);
    expect(saved).toHaveLength(1);
  });
});

/**
 * "The team has not connected a repository yet" is a claim about the customer, shown to their
 * visitors as a fact. It is only ever made from the binding the project row carries, never from a
 * name this turn happened to be started without.
 */
describe("a project whose repository is bound", () => {
  beforeEach(() => {
    chunks = [CHILDREN_PASSAGE];
    answers = {
      understanding: { intent: "product", feature: "finding seats together" },
      passage_read: { covers: false, reason: "it says to move one passenger at a time" },
      verdict: { exists: false, confidence: 0.9, reasoning: "no control and no passage says it can be done" },
      feature_request: {
        title: "Find seats together for a party",
        description: "Let a family take three seats side by side in one move.",
        area: "seats",
        quote: "Can you find us three seats together?",
        rationale: "Today they rebook one passenger at a time.",
      },
    };
  });

  it("offers the report even when the turn was started without the repository name", async () => {
    projectRow = { id: "project-1", repo_full_name: "AadiDahake/novaair-own-your-intelligence" };
    const answer = answerOf(await stream(SEATS_TOGETHER, SEAT_MAP, null));

    expect(answer?.escalation).toMatchObject({ offered: true });
    expect(answer?.text).toContain("I can report this to the developers");
  });

  it("says a repository is missing only when the project really has none", async () => {
    projectRow = { id: "project-1", repo_full_name: null };
    const answer = answerOf(await stream(SEATS_TOGETHER, SEAT_MAP, null));

    expect(answer?.escalation).toEqual({ offered: false, reason: "no_repository" });
    expect(answer?.text).not.toContain("report");
  });

  it("treats a binding of empty text as no binding at all", async () => {
    projectRow = { id: "project-1", repo_full_name: "   " };
    const answer = answerOf(await stream(SEATS_TOGETHER, SEAT_MAP, ""));
    expect(answer?.escalation).toEqual({ offered: false, reason: "no_repository" });
  });
});

describe("the walk that has to keep its count", () => {
  beforeEach(() => {
    chunks = [
      {
        document_title: "How do I change my seat?",
        source_ref: "http://localhost:4150/help/how-do-i-change-my-seat",
        heading: "Change a seat online",
        content: "On the Manage Trip page, go to the Seats section and select Change seats.",
        similarity: 0.94,
        confidence: null,
      },
    ];
    answers = {
      understanding: { intent: "product", feature: "changing a seat" },
      // The stand-in for the resolution model: pick the candidate named "Change seats", the way
      // the model does, by name and never by position.
      resolve_target: (user: string) => ({
        target: user.split("\n").find((row) => /^c\d+: .*"Change seats"/.test(row))?.split(":")[0] ?? "none",
        answer: "Seat changes live under Manage Trip, in Change seats. I will show you the way.",
        captions: ["Open My Booking", "Fill in the form, then select Find my booking", "Open Change seats"],
      }),
    };
  });

  it("is three steps from the home page, and only the first is bound to a live id", async () => {
    const answer = answerOf(await stream("Where do I change my seat?", HOME));
    expect(answer?.plan).toEqual({
      source: "graph",
      total: 3,
      destination: { route: "/trips/:id", title: "Manage Trip | NovaAir" },
    });
    expect(answer?.steps?.map((step) => step.control?.name)).toEqual([
      "My Booking",
      "Find my booking",
      "Change seats",
    ]);
    expect(answer?.steps?.map((step) => step.target)).toEqual([expect.stringMatching(/^h[12]$/), null, null]);
  });

  it("is one step from Manage Trip", async () => {
    const answer = answerOf(await stream("Where do I change my seat?", TRIP_PAGE));
    expect(answer?.plan?.total).toBe(1);
    expect(answer?.steps?.map((step) => step.target)).toEqual(["a4"]);
  });
});

/** The seat map of a build that has the capability, served before anything about it was recorded. */
const SEAT_MAP_NEW_BUTTON: PageContext = {
  ...SEAT_MAP,
  affordances: [
    ...SEAT_MAP.affordances,
    { id: "s7", role: "button", name: "Find three seats together", landmark: "sidebar", visible: true },
  ],
};

/** The same page, served by a preview deployment of the branch that adds the button. */
const PREVIEW_NEW_BUTTON: PageContext = {
  ...SEAT_MAP_NEW_BUTTON,
  url: "https://novaair-git-a1b2c3.example.com/trips/NVA7K2/seats",
};

/**
 * The closing beat. The control is on the page in front of the visitor and nowhere in the product
 * map: it shipped minutes ago, or it is a preview deployment the map is not allowed to learn from.
 * Either way the visitor can press it, so it is what the answer points at, in one step.
 */
describe("a control the page has and the product map has not", () => {
  beforeEach(() => {
    graph = NOVAAIR_GRAPH;
    chunks = [];
    answers = {
      understanding: { intent: "product", feature: "finding seats together" },
      // The stand-in for the resolution model: pick the candidate by its name, never by position.
      resolve_target: (user: string) => ({
        target:
          user.split("\n").find((row) => /^c\d+: .*"Find three seats together"/.test(row))?.split(":")[0] ?? "none",
        answer: 'You can do this with "Find three seats together" on this page. I will show you.',
        captions: ["Select Find three seats together"],
      }),
    };
  });

  const pages = [
    { where: "the project's own site", page: SEAT_MAP_NEW_BUTTON, recorded: true },
    { where: "a preview deployment", page: PREVIEW_NEW_BUTTON, recorded: false },
  ];

  for (const { where, page, recorded } of pages) {
    it(`points at the control in one step, on ${where}`, async () => {
      const events = await stream("How do I get seats together now?", page);
      const answer = answerOf(events);

      expect(events.find((event) => event.type === "verdict")?.verdict.outcome).toBe("answer");
      expect(answer?.plan).toEqual({
        source: "graph",
        total: 1,
        destination: { route: "/trips/:id/seats", title: "Choose Seats | NovaAir" },
      });
      expect(answer?.steps?.map((step) => step.target)).toEqual(["s7"]);
      expect(answer?.steps?.[0]?.control?.name).toBe("Find three seats together");
      expect(answer?.escalation).toEqual({ offered: false });
      // The page planner is never reached, so no seat button is ever a step.
      expect(calls.map((call) => call.name)).toEqual(["understanding", "resolve_target"]);
    });

    it(`points at it even when the model declines every candidate, on ${where}`, async () => {
      answers.resolve_target = { target: "none", answer: "", captions: [] };
      const answer = answerOf(await stream("How do I get seats together now?", page));

      expect(answer?.steps?.map((step) => step.target)).toEqual(["s7"]);
      expect(answer?.steps?.[0]?.caption).toBe("Select Find three seats together");
      expect(answer?.text).toContain('"Find three seats together" on this page');
      expect(calls.map((call) => call.name)).not.toContain("plan");
    });

    it(`writes ${recorded ? "the page" : "nothing"} down, from ${where}`, async () => {
      await stream("How do I get seats together now?", page);
      expect(scans).toEqual(recorded ? [page.url] : []);
      expect(saved).toHaveLength(recorded ? 1 : 0);
    });
  }
});

/**
 * The page planner is the last resort, and it plans over a wall of controls that each share one
 * word with the question. It may only point at a control that does the thing; a walk that ends on
 * a seat cell is not an answer to "seats together", it is three clicks of the thing the visitor
 * was already doing by hand.
 */
describe("the page planner on a seat map", () => {
  beforeEach(() => {
    graph = NOVAAIR_GRAPH;
    chunks = [
      {
        document_title: "Seating a family",
        source_ref: "http://localhost:4150/help/seating-a-family",
        heading: "Seating a family",
        content: "Finding a seat together: choose each seat now, one passenger at a time, on the map.",
        similarity: 0.85,
        confidence: null,
      },
    ];
    answers = {
      understanding: { intent: "product", feature: "finding seats together" },
      plan: {
        answer: "You can pick the seats one at a time on this map.",
        steps: [
          { target: "s2", caption: "Select available seat 1C for the first passenger", advanceOn: "click" },
          { target: "s3", caption: "Select available seat 1D for the second passenger", advanceOn: "click" },
          { target: "s4", caption: "Select available seat 1E for the third passenger", advanceOn: "click" },
        ],
      },
    };
  });

  it("keeps the words and drops a walk that ends on a seat cell", async () => {
    const answer = answerOf(await stream("How do I get seats together now?", SEAT_MAP));

    expect(answer?.text).toBe("You can pick the seats one at a time on this map.");
    expect(answer?.steps).toBeNull();
    expect(answer?.plan).toBeUndefined();
  });

  it("is never reached at all once a control on the page does the thing", async () => {
    answers.resolve_target = {
      target: "c1",
      answer: 'You can do this with "Find three seats together" on this page. I will show you.',
      captions: ["Select Find three seats together"],
    };
    const answer = answerOf(await stream("How do I get seats together now?", SEAT_MAP_NEW_BUTTON));

    expect(answer?.steps?.map((step) => step.target)).toEqual(["s7"]);
    expect(calls.map((call) => call.name)).not.toContain("plan");
  });
});
