/**
 * Verification: the verifier's per-scenario report and the repository's own test run, turned into
 * the two numbers the demo shows and the list of scenario ids that failed.
 *
 * The verifier persona is a model. Its report is untrusted input: it is parsed into a checked
 * shape, a scenario it forgot counts as failed, and a scenario it invented is ignored. The
 * repository's own test runner is the second witness, recorded beside it.
 */

export type VerifierScenario = { id: string; passed: boolean; test_name: string; notes: string };

export type VerifierReport = {
  scenarios: VerifierScenario[];
  test_command: string;
  test_file: string;
  summary: string;
};

export type RunnerSummary = {
  passed: number;
  failed: number;
  total: number;
  success: boolean;
};

export type Verification = {
  scenariosPassed: number;
  scenariosTotal: number;
  /** Scenario ids that did not pass, in specification order. */
  failingScenarios: string[];
  /** What the verifier said, null when its report could not be read. */
  verifier: VerifierReport | null;
  /** What the repository's test runner said, null when its report could not be read. */
  runner: RunnerSummary | null;
  /** Why the verifier's report was not usable, when it was not. */
  problem: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The last JSON object in a text, for output that has a banner or a log line around it. */
function lastJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to the search below.
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Reads the verifier's final message. Returns null with the reason when it is not a report. */
export function parseVerifierReport(text: string): { report: VerifierReport | null; problem: string | null } {
  const value = lastJsonObject(text);
  if (!isRecord(value)) return { report: null, problem: "the verifier did not return a JSON object" };
  if (!Array.isArray(value.scenarios)) {
    return { report: null, problem: "the verifier's report has no scenarios array" };
  }
  const scenarios: VerifierScenario[] = [];
  for (const entry of value.scenarios) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    scenarios.push({
      id: entry.id,
      passed: entry.passed === true,
      test_name: typeof entry.test_name === "string" ? entry.test_name : "",
      notes: typeof entry.notes === "string" ? entry.notes : "",
    });
  }
  return {
    report: {
      scenarios,
      test_command: typeof value.test_command === "string" ? value.test_command : "",
      test_file: typeof value.test_file === "string" ? value.test_file : "",
      summary: typeof value.summary === "string" ? value.summary : "",
    },
    problem: null,
  };
}

/**
 * Reads a Vitest JSON report (`--reporter=json`). The shape is Jest's: `numPassedTests`,
 * `numFailedTests`, `numTotalTests`, `success`.
 */
export function parseRunnerReport(text: string): RunnerSummary | null {
  const value = lastJsonObject(text);
  if (!isRecord(value)) return null;
  const passed = Number(value.numPassedTests);
  const failed = Number(value.numFailedTests);
  const total = Number(value.numTotalTests);
  if (!Number.isFinite(passed) || !Number.isFinite(failed)) return null;
  return {
    passed,
    failed,
    total: Number.isFinite(total) ? total : passed + failed,
    success: value.success === true || (failed === 0 && passed > 0),
  };
}

/**
 * Scores one candidate against the specification's scenarios.
 *
 * The total is always the specification's count. A scenario the verifier did not report counts
 * as failed, because a test that was never written protects nothing.
 */
export function scoreVerification(
  scenarioIds: string[],
  verifierText: string | null,
  runnerText: string | null,
): Verification {
  const parsed = verifierText === null
    ? { report: null, problem: "the verifier wrote no report" }
    : parseVerifierReport(verifierText);
  const runner = runnerText === null ? null : parseRunnerReport(runnerText);

  const passedIds = new Set(
    (parsed.report?.scenarios ?? []).filter((scenario) => scenario.passed).map((scenario) => scenario.id),
  );
  const failingScenarios = scenarioIds.filter((id) => !passedIds.has(id));

  return {
    scenariosPassed: scenarioIds.length - failingScenarios.length,
    scenariosTotal: scenarioIds.length,
    failingScenarios,
    verifier: parsed.report,
    runner,
    problem: parsed.problem,
  };
}
