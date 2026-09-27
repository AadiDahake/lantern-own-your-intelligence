/**
 * The product's analytics contract, as data.
 *
 * Everything the compiler knows about the product lives in this file: the events the site emits,
 * what each one means, and how to say its properties in plain words. The algorithms in the other
 * files read these tables and nothing else about the domain, so a new event is one line here.
 *
 * Today the contract is NovaAir's seat map, from its `docs/analytics.md`.
 */
import type { CompileContext } from "./types";

/** The sub-goal an event belongs to. Adjacent steps of one family merge first. */
export type EventFamily = "open" | "scan" | "assign" | "confirm" | "help";

/**
 * What a step is inside a window: `start` opens one, `end` commits one, `action` is a manual step
 * the capability would replace, `view` is reading, which is not a manual action.
 */
export type EventRole = "start" | "action" | "end" | "view";

export type EventSpec = {
  /** Prose template. `{prop}` substitutes a property; a `[ ... ]` segment is dropped when any property in it is missing. */
  verb: string;
  family: EventFamily;
  role: EventRole;
  /** The single-action tool this event would become at level 0, which the naming prompt sees as "rejected, too small". */
  wrapper: string;
  /** When the event records the product refusing something, the property that carries the reason. */
  refusal?: string;
  /** The interactive element the event addresses: its type and the property that carries its stable id. */
  element?: { type: string; id: string };
};

export const EVENTS: Record<string, EventSpec> = {
  seat_map_opened: {
    verb: "opened the seat map for flight {flight_id}[ (party of {party_size}, seated at {current_seats})]",
    family: "open",
    role: "start",
    wrapper: "open_seat_map",
  },
  passenger_selected: {
    verb: "chose passenger {passenger_index}[ ({passenger_type})]",
    family: "assign",
    role: "action",
    wrapper: "pick_passenger",
    element: { type: "passenger", id: "passenger_index" },
  },
  seat_hovered: {
    verb: "hovered seat {seat}[ ({state})]",
    family: "scan",
    role: "action",
    wrapper: "scroll_to_row",
    element: { type: "seat", id: "seat" },
  },
  seat_selected: {
    verb: "selected seat {seat} for passenger {passenger_index}[, {state}][, ${price}]",
    family: "assign",
    role: "action",
    wrapper: "click_seat",
    element: { type: "seat", id: "seat" },
  },
  seat_selection_rejected: {
    verb: "was refused seat {seat}: {reason}",
    family: "assign",
    role: "action",
    wrapper: "retry_seat",
    refusal: "reason",
    element: { type: "seat", id: "seat" },
  },
  seat_assignment_confirmed: {
    verb: "confirmed seats {seats}[ (same row: {same_row}, contiguous: {contiguous}, extra cost ${additional_cost}, {interactions} interactions)]",
    family: "confirm",
    role: "end",
    wrapper: "confirm_seats",
  },
  help_article_viewed: {
    verb: 'read the help article "{slug}"',
    family: "help",
    role: "view",
    wrapper: "open_help_article",
  },
};

/** Names for the merged family level. Level 0 uses `wrapper` above. */
export const FAMILY_TOOLS: Record<EventFamily, string> = {
  open: "open_seat_map",
  scan: "scan_rows",
  assign: "assign_seat",
  confirm: "confirm_seats",
  help: "browse_help",
};

/** The whole-session level: everything the person did on the page. An area of the product, not a goal. */
export const SESSION_TOOL = "manage_trip";

/** How to say a property in a sentence. Used for constraints, preferences and postconditions. */
export const PROPERTY_GLOSS: Record<string, string> = {
  same_row: "the seats are in one row",
  contiguous: "the seats are side by side, with no gap and no aisle between them",
  additional_cost: "the extra cost of the seats",
  interactions: "the number of seat-map interactions",
  elapsed_ms: "the time spent on the seat map",
  seats: "the assigned seats",
  party_size: "the number of passengers in the party",
  current_seats: "the seats the party holds now",
  flight_id: "the flight",
  reservation_code: "the reservation",
  seat: "a seat",
  row: "a row",
  column: "a seat column",
  passenger_index: "which passenger in the party",
  passenger_type: "whether the passenger is an adult or a child",
  state: "whether a seat is available, booked, blocked or restricted",
  price: "the price of a seat",
  reason: "why the product refused a seat",
};

/** How to say a refusal reason in a sentence. */
export const REASON_GLOSS: Record<string, string> = {
  booked: "a seat that is already booked",
  blocked: "a seat that is blocked for accessibility",
  child_in_exit_row: "a child in an exit row",
  adults_only: "a child in an adults-only row",
};

/** Words the scenario rules use for this product. */
export const VOCABULARY = {
  unit: "seat",
  units: "seats",
  group: "party",
  container: "row",
  divider: "aisle",
  cabinExample: "a 3-3 cabin",
  paidExample: "a paid extra-legroom row",
  splitExample: "21C and 21D",
};

/**
 * What the compiler is told about NovaAir beyond the events: the page, and the rules its help
 * centre already states. The documentation probe finds these at run time; here they are data.
 */
export const NOVAAIR_CONTEXT: CompileContext = {
  product: "NovaAir, a consumer airline website",
  page: "the seat map for one reservation",
  constraints: [
    {
      id: "child_with_adult",
      statement: "A child must be seated next to an adult from the same party.",
      source: "documentation",
      evidence_ref: "help/traveling-with-children",
    },
  ],
  preferences: [
    {
      id: "keep_children_adjacent_to_parent",
      statement: "Prefer groups that put each child directly beside the adult.",
      direction: "maximize",
      weight: 0.6,
    },
  ],
};

export function specFor(event: string): EventSpec {
  return EVENTS[event] ?? { verb: "", family: "assign", role: "action", wrapper: event };
}

export function gloss(property: string): string {
  return PROPERTY_GLOSS[property] ?? property.replace(/_/g, " ");
}

export function glossReason(reason: string): string {
  return REASON_GLOSS[reason] ?? reason.replace(/_/g, " ");
}
