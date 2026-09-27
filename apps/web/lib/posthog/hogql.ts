/**
 * The HogQL queries, as named strings built from a few parameters.
 *
 * Every query filters on a time range first and scans `events` once, which is what PostHog's
 * query guide asks for. Property access is the documented dotted form, wrapped in `toString` so
 * a missing property comes back as null rather than failing the tuple's type check. `OFFSET` is
 * never used: the query endpoint rejects it for personal API keys.
 *
 * The event and property names are NovaAir's analytics contract (`docs/analytics.md` in the
 * NovaAir repository). The miner adapts them to the compiler's trajectory shape.
 */

/** The event that opens a seat-map window and the one that commits it. */
export const OPEN_EVENT = "seat_map_opened";
export const COMMIT_EVENT = "seat_assignment_confirmed";

/** The manual steps a capability would replace, as the compiler counts them. */
export const MANUAL_EVENTS = ["seat_hovered", "seat_selected", "seat_selection_rejected", "passenger_selected"] as const;

/**
 * The properties carried per step, in tuple order after the timestamp and the event name. The
 * parser in `trajectories.ts` reads them back by this list, so the two never drift apart.
 */
export const STEP_PROPERTIES = [
  "seat",
  "row",
  "column",
  "state",
  "passenger_index",
  "passenger_type",
  "price",
  "reason",
  "party_size",
  "current_seats",
  "flight_id",
  "reservation_code",
  "seats",
  "same_row",
  "contiguous",
  "additional_cost",
  "interactions",
  "elapsed_ms",
  "slug",
] as const;

export type StepProperty = (typeof STEP_PROPERTIES)[number];

export type TrajectoryQueryOptions = {
  /** How far back to look. */
  windowDays: number;
  /** At most this many sessions, newest first. The endpoint caps a query at 50,000 rows. */
  limit: number;
};

function sqlList(names: readonly string[]): string {
  return names.map((name) => `'${name}'`).join(", ");
}

/**
 * One row per session: the window from the opening event to the committing event, and every
 * seat step inside it, in order.
 *
 * `groupArray(tuple(timestamp, ...))` collects the steps and `arraySort` orders them by the
 * tuple's first element, the timestamp, with no window function and no self-join. `minIf` and
 * `maxIf` find the window's edges in the same pass, and the `HAVING` keeps only sessions that
 * both opened the map and confirmed, which are the successful workflows the compiler starts from.
 * The outer `arrayFilter` trims the array to the window.
 */
export function trajectoryQuery(options: TrajectoryQueryOptions): string {
  const props = STEP_PROPERTIES.map((name) => `toString(properties.${name})`).join(", ");
  return `
SELECT
    session_id,
    distinct_id,
    opened_at,
    confirmed_at,
    dateDiff('second', opened_at, confirmed_at) AS duration_seconds,
    length(arrayFilter(x -> x.1 >= opened_at AND x.1 <= confirmed_at, all_steps)) AS step_count,
    arrayFilter(x -> x.1 >= opened_at AND x.1 <= confirmed_at, all_steps) AS steps
FROM (
    SELECT
        toString(properties.$session_id) AS session_id,
        any(distinct_id) AS distinct_id,
        minIf(timestamp, event = '${OPEN_EVENT}') AS opened_at,
        maxIf(timestamp, event = '${COMMIT_EVENT}') AS confirmed_at,
        countIf(event = '${OPEN_EVENT}') AS n_open,
        countIf(event = '${COMMIT_EVENT}') AS n_confirm,
        arraySort(groupArray(tuple(timestamp, event, ${props}))) AS all_steps
    FROM events
    WHERE timestamp >= now() - INTERVAL ${Math.floor(options.windowDays)} DAY
      AND event LIKE 'seat_%'
      AND notEmpty(toString(properties.$session_id))
    GROUP BY session_id
    HAVING n_open > 0 AND n_confirm > 0
)
WHERE confirmed_at > opened_at
ORDER BY opened_at DESC
LIMIT ${Math.floor(options.limit)}`.trim();
}

/** The trajectory query's column order, for readers that do not want to trust the response. */
export const TRAJECTORY_COLUMNS = [
  "session_id",
  "distinct_id",
  "opened_at",
  "confirmed_at",
  "duration_seconds",
  "step_count",
  "steps",
] as const;

/**
 * The two headline numbers: how many sessions worked around the gap, and the median number of
 * manual seat-map actions it took them. `manual_actions` counts the same events the compiler
 * counts, so the two agree; `interactions` is the product's own count from the committing event.
 */
export function headlineQuery(options: Pick<TrajectoryQueryOptions, "windowDays">): string {
  return `
SELECT
    count()                    AS matching_sessions,
    median(manual_actions)     AS median_manual_actions,
    median(interactions)       AS median_interactions
FROM (
    SELECT
        toString(properties.$session_id) AS session_id,
        countIf(event IN (${sqlList(MANUAL_EVENTS)})) AS manual_actions,
        maxIf(toFloat(properties.interactions), event = '${COMMIT_EVENT}') AS interactions
    FROM events
    WHERE timestamp >= now() - INTERVAL ${Math.floor(options.windowDays)} DAY
      AND event LIKE 'seat_%'
      AND notEmpty(toString(properties.$session_id))
    GROUP BY session_id
    HAVING countIf(event = '${OPEN_EVENT}') > 0
       AND countIf(event = '${COMMIT_EVENT}') > 0
)`.trim();
}

export type OutcomeQueryOptions = {
  /** The capability's intent, e.g. `seat_party_together`; the outcome events are named after it. */
  intent: string;
  windowDays: number;
  /** The support-contact event, with a `period` of `before_launch` or `after_launch`. */
  supportEvent?: string;
};

export const DEFAULT_SUPPORT_EVENT = "seat_support_contact";

/** The outcome events a shipped capability reports, named after its intent. */
export function outcomeEvents(intent: string): { eligible: string; used: string; succeeded: string } {
  return { eligible: `${intent}_eligible`, used: `${intent}_used`, succeeded: `${intent}_succeeded` };
}

/**
 * PostHog's second job: did the change help? Eligible, used and succeeded counts, the median
 * interactions after launch, support contacts before and after, and how many of those events
 * were seeded (`properties.seeded`), so the row can be labelled from the data itself.
 */
export function outcomeQuery(options: OutcomeQueryOptions): string {
  const events = outcomeEvents(options.intent);
  const support = options.supportEvent ?? DEFAULT_SUPPORT_EVENT;
  return `
SELECT
    countIf(event = '${events.eligible}')                                            AS eligible,
    countIf(event = '${events.used}')                                                AS used,
    countIf(event = '${events.succeeded}')                                           AS succeeded,
    medianIf(toFloat(properties.interactions), event = '${events.succeeded}')        AS median_actions_after,
    countIf(event = '${support}' AND toString(properties.period) = 'before_launch')  AS support_before,
    countIf(event = '${support}' AND toString(properties.period) = 'after_launch')   AS support_after,
    countIf(toString(properties.seeded) = 'true')                                    AS seeded_events,
    count()                                                                          AS total_events
FROM events
WHERE timestamp >= now() - INTERVAL ${Math.floor(options.windowDays)} DAY
  AND event IN (${sqlList([events.eligible, events.used, events.succeeded, support])})
  AND toString(properties.capability) = '${options.intent}'`.trim();
}
