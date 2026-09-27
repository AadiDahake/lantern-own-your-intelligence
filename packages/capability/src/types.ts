/**
 * The Capability IR, field for field the shape of `capability-ir.schema.json`.
 *
 * The shape is ASIL's (Agent-Software Interaction Layer, arXiv 2608.26991): a structured
 * observation, semantic actions with typed params, and a final-state validator, plus the evidence
 * and the granularity decision that Lantern adds.
 *
 * The schema is the single source of truth. This type mirrors it by hand and `test/types.test.ts`
 * proves the two agree: typed examples must validate, and every property name the schema declares
 * must be a key of the type.
 */

export type SlotType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "string[]"
  | "number[]"
  | "object"
  | "object[]";

/** A typed field of the structured state. Never a DOM selector. */
export type Slot = {
  name: string;
  type: SlotType;
  description?: string;
  required?: boolean;
  enum?: unknown[];
  range?: { min?: number; max?: number };
};

export type ActionKind = "read" | "write" | "rank";

/** ASIL action types: how the product realizes an action. */
export type ActionType = "set_value" | "invoke_function" | "modify_file" | "api_call" | "navigate" | "batch";

export type CapabilityAction = {
  name: string;
  kind: ActionKind;
  action_type?: ActionType;
  /** The element type or resource the action addresses, e.g. `seat`. */
  target?: string;
  description?: string;
  params: Slot[];
  returns?: string;
  /** Where this action already exists in the target repository. Absent means Codex must build it. */
  primitive?: { symbol?: string; file?: string; confidence?: number };
  idempotent?: boolean;
};

export type ConstraintSource = "trajectory" | "documentation" | "repository" | "policy" | "inferred";

export type Constraint = {
  id: string;
  statement: string;
  source?: ConstraintSource;
  evidence_ref?: string;
};

export type Preference = {
  id: string;
  statement: string;
  direction: "minimize" | "maximize";
  weight?: number;
};

/** One check of the final state. ASIL judges an implementation on the state it leaves. */
export type FinalStateCheck = { id: string; statement: string };

/** An ASIL interactive element: a thing the actions address, with a stable id and typed attributes. */
export type InteractiveElement = {
  type: string;
  id: Slot;
  attributes?: Slot[];
  constraints?: string[];
  available_actions?: string[];
};

export type ScenarioKind = "happy" | "edge" | "adversarial" | "concurrency" | "permission";

export type Scenario = {
  id: string;
  given: string;
  when?: string;
  then: string;
  kind?: ScenarioKind;
};

export type ProposedUi = {
  location?: string;
  label?: string;
  affordance?: "button" | "menu_item" | "inline_panel" | "modal" | "toolbar_action";
  result_summary?: string;
};

/** OS-Genesis trajectory reward. Two axes kept separate; `total` is the sampling weight. */
export type Reward = { completion?: number; coherence?: number; total?: number };

export type EvidenceStep = { t: string; event: string; props?: Record<string, unknown> };

export type EvidenceTrajectory = {
  session_id: string;
  replay_url?: string;
  reward?: Reward;
  steps: EvidenceStep[];
};

export type Evidence = {
  session_count: number;
  median_manual_actions?: number;
  window?: { from?: string; to?: string };
  trajectories: EvidenceTrajectory[];
};

export type Granularity = {
  replaces_atomic_steps_median?: number;
  rejected_too_low?: string[];
  rejected_too_high?: string[];
  coverage?: number;
};

export type Provenance = {
  compiler_version?: string;
  model?: string;
  created_at?: string;
  opportunity_id?: string;
};

export type CapabilityIR = {
  schema_version?: "1";
  intent: string;
  summary?: string;
  observation: {
    inputs: Slot[];
    app_state: Slot[];
    interactive_elements?: InteractiveElement[];
    example?: Record<string, unknown>;
  };
  actions: CapabilityAction[];
  constraints: Constraint[];
  preferences?: Preference[];
  success: { final_state: FinalStateCheck[]; scenarios: Scenario[] };
  proposed_ui?: ProposedUi;
  evidence: Evidence;
  granularity?: Granularity;
  provenance?: Provenance;
};

/* ----------------------------------------------------------------------------------------------
 * Input: one trajectory row, the shape the PostHog mining query returns.
 * ---------------------------------------------------------------------------------------------- */

export type TrajectoryStep = {
  /** ISO 8601 timestamp of the event. */
  t: string;
  /** The PostHog event name, e.g. `seat_selected`. */
  event: string;
  /** The event's properties, as sent by the product's analytics contract. */
  props: Record<string, unknown>;
};

/**
 * One session, one row. `opened_at` and `confirmed_at` are the window boundaries the query
 * computes; `confirmed_at` is null when the session never reached the committing event, which the
 * reward model then grades as incomplete. `steps` is the ordered event list inside the session.
 */
export type Trajectory = {
  session_id: string;
  distinct_id?: string;
  opened_at: string;
  confirmed_at: string | null;
  duration_seconds: number;
  step_count: number;
  steps: TrajectoryStep[];
  /** PostHog replay deep link, when the caller built one. */
  replay_url?: string;
};

/* ----------------------------------------------------------------------------------------------
 * The model boundary. The package defines it; the application supplies an implementation.
 * ---------------------------------------------------------------------------------------------- */

export type JsonSchema = Record<string, unknown>;

export type ModelPrompt = {
  /** Which prompt this is: `f_high`, `trm` or `tool_synth`. Lets a client log or route by purpose. */
  purpose: "f_high" | "trm" | "tool_synth";
  system: string;
  user: string;
};

/**
 * Structured output through one method. The compiler validates every reply against the schema it
 * passed, so an implementation may return whatever the provider gave it, unchecked.
 */
export interface ModelClient {
  /** A label for provenance, usually the model id. */
  readonly name: string;
  structured(prompt: ModelPrompt, schema: JsonSchema): Promise<unknown>;
}

/* ----------------------------------------------------------------------------------------------
 * The compiler's inputs and outputs.
 * ---------------------------------------------------------------------------------------------- */

export type CompileThresholds = {
  /** Keep a trajectory when its reward total is at least this. OS-Genesis keeps the middle. */
  min_reward_total: number;
  /** ToolCUA starts from successful trajectories: completion at least this. */
  min_completion: number;
  /** A candidate must explain at least this share of the successful trajectories. */
  min_support: number;
  /** A candidate must replace at least this many manual steps, by median. */
  min_replaces: number;
  /** Fewer successful sessions than this is an anecdote, not a specification. */
  min_sessions: number;
};

export type CompileContext = {
  /** Product name and the page the trajectories were recorded on, for the prompts. */
  product: string;
  page: string;
  /** Rules the caller already knows from documentation or policy. Merged into the IR as given. */
  constraints?: Constraint[];
  preferences?: Preference[];
  opportunity_id?: string;
  thresholds?: Partial<CompileThresholds>;
};

/**
 * The four stages of the story, in order: user workflows, inferred intent, semantic capability,
 * verified implementation. Every event belongs to one of them.
 */
export type CompilerStage = "workflows" | "intent" | "capability" | "verification";

export const STAGES: Record<CompilerStage, { title: string; powered_by: string }> = {
  workflows: {
    title: "user workflows",
    powered_by: "PostHog sessions, rendered as steps with no model",
  },
  intent: {
    title: "inferred intent",
    powered_by: "OS-Genesis: reverse task synthesis and the trajectory reward model",
  },
  capability: {
    title: "semantic capability",
    powered_by: "ToolCUA: bottom-up granularity with rejected levels; ASIL: the interface shape",
  },
  verification: {
    title: "verified implementation",
    powered_by: "the scenarios and final-state checks the Capability Verifier runs",
  },
};

export const STAGE_ORDER: CompilerStage[] = ["workflows", "intent", "capability", "verification"];

/** One line of the decision trail. The console and the terminal view render these in order. */
export type CompilerEvent = {
  stage: CompilerStage;
  title: string;
  detail: Record<string, unknown>;
  /** ISO 8601, when the event was recorded. */
  at: string;
};

/** A scored candidate tool at one granularity level, kept for the decision trail. */
export type RejectedCandidate = {
  name: string;
  level: number;
  goal: string;
  sessions: number;
  support: number;
  replaces: number;
  grounded: boolean;
  arguments: string[];
  reason: string;
};

export type CompileResult =
  | { decision: "capability"; ir: CapabilityIR; rejected: RejectedCandidate[]; events: CompilerEvent[] }
  | { decision: "none"; reasons: string[]; rejected: RejectedCandidate[]; events: CompilerEvent[] };

export type CompileOptions = {
  /** Called with each event as it is recorded, so a caller can stream the trail. */
  onEvent?: (event: CompilerEvent) => void;
  /** How many reward batches run at once. The synthesis batches always run in order. */
  concurrency?: number;
  /** The clock, for reproducible provenance and event timestamps. */
  now?: () => Date;
};
