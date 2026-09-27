/**
 * Choosing the winner. The rule is the verification result, not style: the candidate that passed
 * the most scenarios wins, and between equals the one that changed fewer files, because a smaller
 * change is easier for the reviewer.
 */

export type ScoredCandidate = {
  id: string;
  label: string;
  status: "ready" | "failed";
  scenariosPassed: number;
  scenariosTotal: number;
  changedFiles: number;
};

export type Selection<T extends ScoredCandidate> = { winner: T; reason: string };

/** The winner among the candidates that finished, or null when none did. */
export function selectWinner<T extends ScoredCandidate>(candidates: T[]): Selection<T> | null {
  const ready = candidates.filter((candidate) => candidate.status === "ready");
  if (ready.length === 0) return null;

  const ranked = [...ready].sort(
    (a, b) =>
      b.scenariosPassed - a.scenariosPassed ||
      a.changedFiles - b.changedFiles ||
      a.label.localeCompare(b.label),
  );
  const winner = ranked[0] as T;
  const runnerUp = ranked[1];

  let reason = `${winner.scenariosPassed} of ${winner.scenariosTotal} scenarios passed`;
  if (runnerUp) {
    if (runnerUp.scenariosPassed === winner.scenariosPassed) {
      reason += `, tied with candidate ${runnerUp.label} on scenarios and ahead on fewer changed files (${winner.changedFiles} against ${runnerUp.changedFiles})`;
    } else {
      reason += `, against ${runnerUp.scenariosPassed} for candidate ${runnerUp.label}`;
    }
  } else if (candidates.length > ready.length) {
    reason += "; the other candidate did not finish";
  }
  return { winner, reason };
}
