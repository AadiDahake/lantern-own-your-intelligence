/**
 * The draft pull request: its title, its branch, and a body that carries the evidence with it.
 *
 * Short plain sentences. A reviewer reads why the change exists, what it does, which rules it
 * keeps, how it was verified, what it touches, and where to see it running.
 */
import type { CapabilityIr } from "./ir";
import { intentSlug } from "./ir";
import type { Verification } from "./verify";

const IMPERATIVE_OPENERS = /^(add|allow|let|enable|show|offer|give|make|move|find|remove|fix)\b/i;

/** The first clause of the summary, or the intent itself, as an imperative title. */
export function prTitle(ir: CapabilityIr): string {
  const summary = (ir.summary ?? "").trim();
  const clause = summary.split(/[.:;]/)[0]?.trim() ?? "";
  const base = clause || ir.intent.replace(/_/g, " ");
  const title = IMPERATIVE_OPENERS.test(base) ? base : `Add ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  return title.length > 72 ? `${title.slice(0, 71).trimEnd()}` : title;
}

/** `lantern/seat-party-together-b`. */
export function branchName(ir: CapabilityIr, label: string): string {
  return `lantern/${intentSlug(ir)}-${label.toLowerCase()}`;
}

export type PrBodyInput = {
  ir: CapabilityIr;
  candidateLabel: string;
  verification: Verification;
  changedFiles: { path: string; kind: string }[];
  previewUrl: string | null;
  opportunityUrl: string | null;
  strategy: string;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function humanLabel(ir: CapabilityIr): string {
  return ir.proposed_ui?.label ?? ir.intent.replace(/_/g, " ");
}

export function prBody(input: PrBodyInput): string {
  const { ir, verification } = input;
  const lines: string[] = [];

  lines.push("## Why", "");
  const sessions = ir.evidence.session_count;
  lines.push(
    `PostHog found ${plural(sessions, "successful session")} where customers did this by hand.`,
  );
  if (typeof ir.evidence.median_manual_actions === "number") {
    lines.push(`The median session took ${ir.evidence.median_manual_actions} manual actions.`);
  }
  lines.push(`Lantern inferred the missing capability \`${ir.intent}\` from those sessions.`);
  lines.push("");

  lines.push("## What", "");
  const location = ir.proposed_ui?.location ? ` in the ${ir.proposed_ui.location.replace(/_/g, " ")}` : "";
  lines.push(`Adds "${humanLabel(ir)}"${location}.`);
  if (ir.summary) lines.push(ir.summary);
  lines.push(`It composes these actions: ${ir.actions.map((action) => `\`${action.name}\``).join(", ")}.`);
  lines.push("");

  lines.push("## Safety", "");
  for (const constraint of ir.constraints) lines.push(`- ${constraint.statement}`);
  lines.push("");

  lines.push("## Validation", "");
  lines.push(
    `${verification.scenariosPassed} / ${verification.scenariosTotal} sandbox scenarios passed (candidate ${input.candidateLabel}, ${input.strategy} sandbox).`,
  );
  if (verification.runner) {
    lines.push(
      `The repository's own test suite: ${verification.runner.passed} passed, ${verification.runner.failed} failed.`,
    );
  }
  if (verification.failingScenarios.length > 0) {
    lines.push("", "Scenarios that did not pass:", "");
    for (const id of verification.failingScenarios) {
      const note = verification.verifier?.scenarios.find((scenario) => scenario.id === id)?.notes;
      lines.push(`- \`${id}\`${note ? `: ${note}` : ""}`);
    }
  }
  if (verification.verifier?.test_file) {
    lines.push("", `Tests: \`${verification.verifier.test_file}\`.`);
  }
  lines.push("");

  lines.push("## Changed files", "");
  if (input.changedFiles.length === 0) lines.push("- none recorded");
  for (const file of input.changedFiles) lines.push(`- \`${file.path}\` (${file.kind})`);
  lines.push("");

  lines.push("## Preview", "");
  lines.push(
    input.previewUrl
      ? `${input.previewUrl}\n\nThe preview runs in the candidate's sandbox. It is live while the sandbox runs.`
      : "No preview is running.",
  );
  lines.push("");

  lines.push("## Lantern", "");
  if (input.opportunityUrl) lines.push(`Opportunity: ${input.opportunityUrl}`);
  lines.push("This pull request is a draft. A person approves it in the Lantern console before it merges.");
  lines.push("Nothing in this change reached production.");
  return lines.join("\n");
}
