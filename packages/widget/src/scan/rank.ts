/**
 * Ranking for the affordance scan. The model only ever sees a capped list, so
 * the ordering here decides what it can point at. Scoring favours things the
 * user can see and things whose name echoes the question.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it',
  'me', 'my', 'of', 'on', 'or', 'the', 'this', 'to', 'up', 'what', 'where', 'with', 'you', 'your',
]);

/** Words that name a control without saying anything about it. */
const GENERIC_NAMES = new Set([
  'ok', 'go', 'close', 'open', 'menu', 'more', 'link', 'button', 'submit', 'click here', 'here',
  'next', 'previous', 'back', 'toggle', 'dismiss', 'x',
]);

const LANDMARK_BONUS: Record<string, number> = {
  dialog: 3,
  sidebar: 2,
  header: 2,
  navigation: 2,
  main: 1,
};

/** Words that mean the same thing to a user but not to a token match. */
const SYNONYMS: Record<string, string[]> = {
  theme: ['dark', 'light', 'appearance', 'mode'],
  dark: ['theme', 'appearance', 'night'],
  username: ['name', 'handle', 'profile', 'account', 'display'],
  profile: ['account', 'username', 'settings'],
  account: ['profile', 'user', 'settings'],
  password: ['security', 'credentials'],
  billing: ['payment', 'invoice', 'plan'],
  key: ['keys', 'token', 'api'],
};

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map(stem);
}

/** Enough stemming for UI labels: plurals and a couple of common suffixes. */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  return word;
}

/** Question tokens plus their synonyms, so "dark mode" also matches "appearance". */
export function expandTokens(question: string): Set<string> {
  const tokens = new Set(tokenize(question));
  for (const token of [...tokens]) {
    for (const synonym of SYNONYMS[token] ?? []) tokens.add(stem(synonym));
  }
  return tokens;
}

export type RankInput = {
  name: string;
  text?: string;
  landmark?: string;
  href?: string;
  role: string;
  visible: boolean;
  disabled?: boolean;
  state?: string;
};

/** Higher is more likely to be what the question is about. */
export function scoreCandidate(candidate: RankInput, questionTokens: Set<string>): number {
  let score = candidate.visible ? 4 : 0;
  score += LANDMARK_BONUS[candidate.landmark ?? ''] ?? 0;
  if (candidate.disabled) score -= 2;

  const haystack = tokenize(
    [candidate.name, candidate.text ?? '', candidate.href ?? ''].join(' '),
  );
  if (haystack.length === 0) score -= 3;

  let matches = 0;
  for (const token of new Set(haystack)) if (questionTokens.has(token)) matches += 1;
  score += matches * 6;

  const name = candidate.name.trim().toLowerCase();
  if (!name) score -= 4;
  else if (GENERIC_NAMES.has(name)) score -= 2;

  return score;
}

/**
 * Sorts by score and keeps the best `limit`. Ties keep document order, which is
 * what makes ids stable between two scans of an unchanged page.
 */
export function rank<T extends RankInput>(candidates: T[], question: string, limit: number): T[] {
  const questionTokens = expandTokens(question);
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate, questionTokens) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.candidate);
}
