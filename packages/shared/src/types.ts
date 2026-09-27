/** An interactive element the widget found on the host page. */
export type Affordance = {
  id: string;            // opaque, e.g. "a7"; the only handle the model gets
  role: string;          // button | link | textbox | checkbox | tab | menuitem | switch | combobox
  name: string;          // accessible name
  text?: string;         // visible text when different from name
  landmark?: string;     // nearest landmark or labelled region: "sidebar", "header", "main", "dialog"
  href?: string;         // for links
  visible: boolean;      // in viewport and hit-testable
  disabled?: boolean;
  state?: string;        // "selected", "expanded", "checked" and so on, when the control has one
};

export type PageContext = {
  url: string;
  title: string;
  affordances: Affordance[];
  /** The visible text of the page, collapsed and bounded by the scanner. Absent on an old widget. */
  text?: string;
};

/**
 * What kind of message the visitor sent, decided before any check runs.
 *
 * `chat` is a greeting, thanks, small talk, a question about the assistant, or general knowledge
 * that is not about this product. `page` is a question the page in front of the visitor already
 * answers. `product` is a question about what the product can do or where a control is. `mixed`
 * is both at once, and is also what an unsure classification falls back to, because the product
 * path is the one that checks its evidence.
 */
export type MessageIntent = "chat" | "page" | "product" | "mixed";

/**
 * One instruction in a walk. `target` is the live affordance id on the page the widget scanned;
 * it is null for a step on a later page, which the widget binds by `control` once it gets there.
 */
export type Step = {
  target: string | null;
  caption: string;
  advanceOn: "click" | "input" | "navigation" | "manual";
  /** The control's stable identity and the route it lives on, from the site graph. */
  control?: {
    role: string;
    name: string;
    landmark?: string;
    href?: string;
    route: string;
  };
};

export type ProbeName = "docs" | "interface" | "repository";

export type ProbeResult = {
  probe: ProbeName;
  hit: boolean;
  score: number | null;
  summary: string;
  evidence: unknown;
  latencyMs: number;
};

export type VerdictOutcome = "answer" | "hedge" | "absent";

export type Verdict = {
  outcome: VerdictOutcome;
  confidence: number;
  reasoning: string;
  feature: string;
};

export type FeatureRequest = {
  title: string;
  description: string;
  area: string;
  quote: string;
  rationale: string;
};

/** How much weight a request group carries. Derived from its two counts, never set by hand. */
export type RequestPriority = "low" | "medium" | "high";

/** Where a request group has got to. `observed` means noticed but not yet on GitHub. */
export type RequestGroupStatus =
  | "observed"
  | "filed"
  | "drafting"
  | "pr_open"
  | "awaiting_approval"
  | "shipped"
  | "rejected";

/**
 * One gap in the product, however many conversations reached it.
 *
 * The counts are what turn a quiet observation into work: `reportCount` is every conversation
 * where the agent found the gap, `userReportCount` the subset where the user asked for it.
 */
export type RequestGroup = {
  id: string;
  title: string;
  description: string;
  area: string;
  reportCount: number;
  userReportCount: number;
  priority: RequestPriority;
  status: RequestGroupStatus;
  issueUrl: string | null;
  issueNumber: number | null;
  prUrl: string | null;
  /** The run currently carrying this group forward, whose trace the console streams. */
  escalationId: string | null;
  firstSeen: string;
  lastSeen: string;
};

/** Body of `POST /api/chat`. */
export type ChatRequest = {
  key: string;
  conversationId?: string;
  /** Random id the widget keeps in the visitor's browser, the key of the agent's memory. */
  visitorId?: string;
  question: string;
  page: PageContext;
  continueFrom?: number;
};

/** Body of `POST /api/escalate`. */
export type EscalateRequest = {
  key: string;
  conversationId?: string;
  messageId: string;
  visitorId?: string;
};

/** How a visitor rated one answer in the widget. */
export type FeedbackRating = "up" | "down";

/** Body of `POST /api/feedback`. */
export type FeedbackRequest = {
  key: string;
  messageId: string;
  rating: FeedbackRating;
  note?: string;
};

/**
 * Whether the agent offered to report a missing feature.
 *
 * `reason` says why it could not: today the only one is a project with no repository bound, which
 * the widget explains rather than offering a button that cannot work.
 */
export type EscalationOffer =
  | { offered: true; request: FeatureRequest }
  | { offered: false; reason?: "no_repository" };

/** How a step plan was made: read off the site graph, replayed from a known route, or planned over the current page alone. */
export type PlanSource = "graph" | "cached" | "page";

export type PlanSummary = {
  source: PlanSource;
  total: number;
  /** The page the walk ends on, when the graph knows it. */
  destination?: { route: string; title: string };
};

/** A help article the answer cites. */
export type AnswerSource = { title: string; url: string | null };

/** `/api/chat` server-sent events, in order of emission. */
export type ChatEvent =
  | { type: "conversation"; conversationId: string; messageId: string }
  | {
      type: "understanding";
      /** The capability the question is about. Empty when the message is not about one. */
      feature: string;
      intent: MessageIntent;
      /** What the agent already knows about this visitor, oldest first. Empty on a first visit. */
      memory: string[];
    }
  | { type: "probe"; probe: ProbeName; status: "running" }
  | { type: "probe"; probe: ProbeName; status: "done"; result: ProbeResult }
  | { type: "verdict"; verdict: Verdict }
  | {
      type: "answer";
      text: string;
      steps: Step[] | null;
      escalation: EscalationOffer;
      /** The gap was recorded for the developers without the user having to ask. */
      noted?: boolean;
      /** Where the steps came from and how many there are, fixed for the whole walk. */
      plan?: PlanSummary;
      /** The documentation the answer rests on. */
      sources?: AnswerSource[];
      /** A continuation had to change the route, so the count the user saw is no longer true. */
      routeChanged?: boolean;
    }
  | { type: "error"; message: string };

/**
 * One run of the worker. `updated` is the terminal state of a run that only carried a new count
 * and quote to an issue and pull request that already exist.
 */
export type EscalationStatus =
  | "queued"
  | "filing"
  | "filed"
  | "inspecting"
  | "drafting"
  | "pr_open"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "merging"
  | "deploying"
  | "shipped"
  | "updated"
  | "failed";

/**
 * What builds the change.
 *
 * `local` is the worker's own runner: it files the issue, drafts the diff and opens the pull
 * request in one process. `forge` is the sandbox engine in `apps/web/lib/forge`: Codex personas
 * build and verify a compiled capability inside isolated sandboxes, and the winner opens the
 * draft pull request.
 */
export type EscalationEngine = "local" | "forge";

export type TraceEvent = {
  id: number;
  projectId: string;
  conversationId: string | null;
  escalationId: string | null;
  /** The opportunity (request group) the row belongs to, when the writer knew it. */
  groupId: string | null;
  /** `forge` is the sandbox engine's lane, so the console can colour it apart from the chat. */
  source: "agent" | "workflow" | "forge";
  kind:
    | "probe"
    | "verdict"
    | "decision"
    | "model"
    | "tool"
    | "artifact"
    | "pause"
    | "status"
    | "error"
    /** A capability the compiler discovered; detail carries the granularity decision. */
    | "capability"
    /** One candidate implementation in one sandbox: provisioning, building, or its test result. */
    | "candidate"
    /** A live sandbox preview; detail carries the URL and the candidate. */
    | "preview";
  status: "running" | "ok" | "failed";
  title: string;
  detail: unknown;
  createdAt: string;
};
