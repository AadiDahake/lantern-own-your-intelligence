import { DEFAULT_THRESHOLDS } from "./models";
import type { ProbeResult, VerdictOutcome } from "./types";

export type Thresholds = {
  docsThreshold?: number;
  interfaceThreshold?: number;
};

/**
 * Decides what kind of answer the three probes justify, without a model call where the evidence
 * is already clear.
 *
 * - The documentation or the live page found it, so answer it.
 * - The capabilities check found a control for it elsewhere on the site, so answer it: the
 *   planner can route the user there.
 * - Only the repository's code mentions it, so it may exist but the user cannot be shown it: hedge.
 * - Nothing found it, so absence is plausible. The caller then asks the verdict model to confirm
 *   before telling a user a feature does not exist.
 */
export function routeProbes(
  results: readonly ProbeResult[],
  thresholds: Thresholds = {},
): VerdictOutcome {
  const docsThreshold = thresholds.docsThreshold ?? DEFAULT_THRESHOLDS.docsThreshold;
  const interfaceThreshold = thresholds.interfaceThreshold ?? DEFAULT_THRESHOLDS.interfaceThreshold;

  const found = (probe: ProbeResult["probe"]): ProbeResult | undefined =>
    results.find((candidate) => candidate.probe === probe);

  // Each probe applies its own threshold and, for the documentation, reads the passage when the
  // score alone cannot decide. Its `hit` is the decision; a score below the line is only ever
  // a hit because the reading said so, and that is not overruled here.
  const hit = (probe: ProbeResult["probe"], threshold: number): boolean => {
    const result = found(probe);
    if (!result || !result.hit) return false;
    if (result.score === null) return true;
    return result.score >= threshold || probe === "docs";
  };

  if (hit("docs", docsThreshold) || hit("interface", interfaceThreshold)) return "answer";

  // The capabilities check scores the control it found on the site, which the user can be walked
  // to. It scores nothing when what it found was code alone, or a control whose name does not
  // cover the capability, so neither of those can be read here as a control to route to.
  const repository = found("repository");
  if (repository?.hit && repository.score !== null && repository.score >= interfaceThreshold) return "answer";
  if (repository?.hit) return "hedge";

  return "absent";
}
