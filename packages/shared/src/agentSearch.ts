/**
 * The agent search: where the product looks for a service that already does a job it has not got.
 *
 * The path and the caps were read from the search provider's OpenAPI document and measured
 * against its public endpoint on 2026-10-11. The reason for each one is in `docs/contracts.md`
 * section 5.
 */
export const AGENT_SEARCH = {
  /** `POST`: ranked capabilities for one query. It works with no key at the public rate. */
  searchPath: "/api/v2/search",
  /** How many ranked results one search asks for. */
  numResults: 10,
  /**
   * The longest one search may run. A turn stops its search sooner: the search has the time that
   * the turn needs for its own work, and no more.
   */
  timeoutMs: 8_000,
  /** The largest answer that is read. A real answer for 10 results is about 30 kB. */
  maxAnswerBytes: 512_000,
  /** How many services one answer offers at most. */
  maxOffered: 2,
  /** The longest query. A capability name is a few words. */
  queryChars: 120,
  /** The longest name of a listing and of its service that is kept. */
  nameChars: 80,
  providerChars: 60,
} as const;
