/**
 * Token helpers shared by the interface probe and the widget's affordance ranking, so the
 * score the server computes and the ranking the page computes never disagree.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from",
  "get", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "the", "then", "there",
  "this", "to", "use", "want", "was", "what", "when", "where", "which", "with", "you", "your",
]);

/**
 * Groups of interchangeable words. Scoring counts a group as one concept, so "dark mode" is a
 * single thing to look for rather than two, and a control named "Appearance" satisfies it.
 */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["theme", "dark", "light", "appearance", "mode", "colour", "color"],
  ["username", "displayname", "name", "profile", "account", "handle"],
  ["signout", "logout", "signin", "login", "session"],
  ["billing", "invoice", "payment", "plan", "subscription"],
  ["key", "token", "credential", "secret", "apikey"],
  ["member", "team", "teammate", "invite", "organisation", "organization", "workspace"],
];

/** Maps every member of a group to that group's canonical first word. */
const CONCEPT_OF: ReadonlyMap<string, string> = new Map(
  SYNONYM_GROUPS.flatMap((group) =>
    group.map((word) => [stem(word), stem(group[0] as string)] as const),
  ),
);

/**
 * Strips the few suffixes that matter for short interface labels. Not a real stemmer.
 *
 * A base form ending in "e" loses it too, so "change", "changes", "changed" and "changing" all
 * meet at "chang". Without that last rule the inflected forms agreed with each other but never
 * with the plain verb a control is named by.
 */
export function stem(word: string): string {
  let base = word;
  if (base.length > 4 && base.endsWith("ies")) return `${base.slice(0, -3)}y`;
  if (base.length > 4 && base.endsWith("ing")) base = base.slice(0, -3);
  else if (base.length > 4 && base.endsWith("ed")) base = base.slice(0, -2);
  else if (base.length > 3 && base.endsWith("es")) base = base.slice(0, -2);
  else if (base.length > 3 && base.endsWith("s")) base = base.slice(0, -1);
  if (base.length > 4 && base.endsWith("e")) base = base.slice(0, -1);
  return base;
}

/** Lowercases, splits on anything that is not a letter or digit, drops stopwords, stems. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    const stemmed = stem(raw);
    if (stemmed.length >= 2) out.push(stemmed);
  }
  return out;
}

/**
 * The distinct concepts a piece of text is about: tokens, with every member of a synonym group
 * collapsed onto one entry.
 */
export function concepts(text: string): Set<string> {
  const set = new Set<string>();
  for (const token of tokenize(text)) set.add(CONCEPT_OF.get(token) ?? token);
  return set;
}

/**
 * How much of `query` is present in `candidate`, from 0 to 1: the fraction of the query's
 * concepts the candidate also mentions. Synonyms count, so a question about dark mode matches a
 * control named "Appearance".
 */
export function keywordScore(query: string, candidate: string): number {
  const wanted = concepts(query);
  if (wanted.size === 0) return 0;
  const have = concepts(candidate);
  if (have.size === 0) return 0;
  let matched = 0;
  for (const concept of wanted) if (have.has(concept)) matched += 1;
  return matched / wanted.size;
}

/**
 * The share of a capability's concepts one label has to carry before that label counts as the
 * thing itself.
 *
 * A capability of one or two concepts needs all of them: half of "changing a seat" is "seat", and
 * "Seat 12A" is a seat, not a way of changing one. A longer capability needs all but one, because
 * the one that is allowed to differ is the verb the question happened to use. "Find seats
 * together" is the control for "getting seats together" and for "finding seats together"; it is
 * not the control for "changing a seat", and no seat button is the control for either.
 */
export function coverageNeeded(capability: string): number {
  const size = concepts(capability).size;
  if (size <= 2) return 1;
  return (size - 1) / size;
}

/**
 * Whether a label - a control's accessible name, a file path - accounts for the capability
 * itself rather than for one word of it. This is the one rule behind every "is this the control
 * for it" decision: the interface check, the capabilities check, and the candidates a route may
 * be planned to.
 */
export function coversCapability(capability: string, label: string): boolean {
  const needed = coverageNeeded(capability);
  return keywordScore(capability, label) >= needed;
}
