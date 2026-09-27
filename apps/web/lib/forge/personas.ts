/**
 * The three personas as data.
 *
 * The shape is the one Reflex's own `AgentPersona` uses (name, agent type, system prompt, model,
 * sandbox options, environment variable names), so a persona can be handed to Reflex unchanged
 * the day the account has one. Until then Lantern stores them and applies one by rendering its
 * prompt into a `codex exec` run inside a sandbox created from its size and blueprint.
 *
 * The prompts live beside this file as Markdown so a change to one is reviewable in a diff.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CODEX_MODEL } from "./codex";
import type { CapabilityIr } from "./ir";

export type PersonaKey = "capability_builder" | "ux_builder" | "capability_verifier";

export type Persona = {
  key: PersonaKey;
  name: string;
  agentType: "codex";
  systemPrompt: string;
  model: typeof CODEX_MODEL;
  /** Reflex's launch modes. Builders implement; the verifier reviews. */
  promptMode: "implement" | "review";
  sandboxOptions: { resourceSize: "LARGE"; blueprintName: string | null };
  /** Names only. The values are injected by the sandbox strategy, never stored here. */
  envVarNames: string[];
  /** The verifier's report is constrained to this schema through `--output-schema`. */
  outputSchema: Record<string, unknown> | null;
  /** The UX Builder continues the Capability Builder's thread instead of re-reading the repo. */
  resumesThread: boolean;
};

export type Personas = Record<PersonaKey, Persona>;

/** Every property is required and no extra property is allowed, which is what strict output needs. */
export const VERIFIER_REPORT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["scenarios", "test_command", "test_file", "summary"],
  properties: {
    scenarios: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "passed", "test_name", "notes"],
        properties: {
          id: { type: "string" },
          passed: { type: "boolean" },
          test_name: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
    test_command: { type: "string" },
    test_file: { type: "string" },
    summary: { type: "string" },
  },
};

/**
 * Reads one prompt. The path is written out twice, as literals, because Next traces the files a
 * server function reads: a literal path pulls in that one file, a computed one pulls in the
 * whole project. The first form serves `next` (started in `apps/web`), the second the scripts
 * (started at the repository root).
 */
function readFirst(appPath: string, rootPath: string): string {
  try {
    return readFileSync(appPath, "utf8");
  } catch {
    try {
      return readFileSync(rootPath, "utf8");
    } catch {
      throw new Error(
        `The persona prompts were not found. Looked for ${appPath} and ${rootPath}. ` +
          "Start the process from apps/web or from the repository root.",
      );
    }
  }
}

export function readPrompt(key: PersonaKey): string {
  switch (key) {
    case "capability_builder":
      return readFirst(
        join(process.cwd(), "lib", "forge", "prompts", "capability-builder.md"),
        join(process.cwd(), "apps", "web", "lib", "forge", "prompts", "capability-builder.md"),
      );
    case "ux_builder":
      return readFirst(
        join(process.cwd(), "lib", "forge", "prompts", "ux-builder.md"),
        join(process.cwd(), "apps", "web", "lib", "forge", "prompts", "ux-builder.md"),
      );
    case "capability_verifier":
      return readFirst(
        join(process.cwd(), "lib", "forge", "prompts", "capability-verifier.md"),
        join(process.cwd(), "apps", "web", "lib", "forge", "prompts", "capability-verifier.md"),
      );
  }
}

/** The three personas, prompts loaded from disk once per call. */
export function loadPersonas(options: { blueprintName?: string | null } = {}): Personas {
  const blueprintName = options.blueprintName ?? null;
  const base: Pick<Persona, "agentType" | "model" | "sandboxOptions" | "envVarNames"> = {
    agentType: "codex",
    model: CODEX_MODEL,
    sandboxOptions: { resourceSize: "LARGE", blueprintName },
    envVarNames: ["CODEX_API_KEY", "GH_TOKEN"],
  };
  return {
    capability_builder: {
      ...base,
      key: "capability_builder",
      name: "Capability Builder",
      systemPrompt: readPrompt("capability_builder"),
      promptMode: "implement",
      outputSchema: null,
      resumesThread: false,
    },
    ux_builder: {
      ...base,
      key: "ux_builder",
      name: "UX Builder",
      systemPrompt: readPrompt("ux_builder"),
      promptMode: "implement",
      outputSchema: null,
      resumesThread: true,
    },
    capability_verifier: {
      ...base,
      key: "capability_verifier",
      name: "Capability Verifier",
      systemPrompt: readPrompt("capability_verifier"),
      promptMode: "review",
      outputSchema: VERIFIER_REPORT_SCHEMA,
      resumesThread: false,
    },
  };
}

/** The order the personas run in, inside one candidate's sandbox. */
export const PERSONA_ORDER: PersonaKey[] = ["capability_builder", "ux_builder", "capability_verifier"];

export type PromptContext = {
  ir: CapabilityIr;
  repo: { fullName: string; defaultBranch: string };
  candidate: { label: string; approach: string };
  /** The target repository's own AGENTS.md, when it has one. */
  agentsMd: string | null;
};

/** The acceptance criteria, rendered once from the specification and given to every persona. */
export function renderAcceptance(ir: CapabilityIr): string {
  const lines: string[] = [];
  lines.push(`# Acceptance criteria for \`${ir.intent}\``, "");
  if (ir.summary) lines.push(ir.summary, "");

  lines.push("## Final state (what must be true after the capability ran)", "");
  for (const item of ir.success.final_state) lines.push(`- \`${item.id}\`: ${item.statement}`);
  lines.push("");

  lines.push("## Constraints (hard rules, a violation is a failure)", "");
  for (const item of ir.constraints) {
    const source = item.source ? ` (source: ${item.source})` : "";
    lines.push(`- \`${item.id}\`: ${item.statement}${source}`);
  }
  lines.push("");

  if (ir.preferences && ir.preferences.length > 0) {
    lines.push("## Preferences (soft rules, used to rank valid results)", "");
    for (const item of ir.preferences) {
      lines.push(`- \`${item.id}\` (${item.direction}): ${item.statement}`);
    }
    lines.push("");
  }

  lines.push("## Scenarios (one test each)", "");
  lines.push("| id | kind | given | when | then |", "| --- | --- | --- | --- | --- |");
  for (const scenario of ir.success.scenarios) {
    const cells = [scenario.id, scenario.kind ?? "", scenario.given, scenario.when ?? "", scenario.then];
    lines.push(`| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`);
  }
  lines.push("");

  if (ir.proposed_ui) {
    lines.push("## Proposed interface", "");
    for (const [key, value] of Object.entries(ir.proposed_ui)) {
      if (value) lines.push(`- ${key}: ${value}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * The prompt one persona runs with: its system prompt, then the run's context. `codex exec`
 * takes one prompt, so the two parts of a Reflex launch (persona prompt, launch prompt) become
 * two sections of one file.
 */
export function renderPrompt(persona: Persona, context: PromptContext): string {
  const { ir, repo, candidate } = context;
  const parts: string[] = [persona.systemPrompt.trim(), "", "---", "", "# This run", ""];
  parts.push(`- Repository: \`${repo.fullName}\`, base branch \`${repo.defaultBranch}\`.`);
  parts.push(`- Capability: \`${ir.intent}\`.${ir.summary ? ` ${ir.summary}` : ""}`);
  parts.push(`- Candidate ${candidate.label}. Approach for this candidate: ${candidate.approach}`);
  parts.push(
    `- Authority: this run adds \`${ir.intent}\`. It is the product decision a repository guard asks for. Do not raise it; build it.`,
  );
  parts.push(
    `- Evidence: ${ir.evidence.session_count} user sessions did this by hand` +
      (typeof ir.evidence.median_manual_actions === "number"
        ? `, a median of ${ir.evidence.median_manual_actions} actions each.`
        : "."),
  );
  parts.push(
    "- Files: `.lantern/spec.json`, `.lantern/trajectories.json`, `.lantern/acceptance.md`.",
  );
  parts.push("- The `.lantern` directory is Lantern's. Do not edit it and do not add it to a commit.");
  if (persona.key === "capability_verifier") {
    parts.push(
      `- Scenario ids, in order: ${ir.success.scenarios.map((scenario) => `\`${scenario.id}\``).join(", ")}.`,
    );
  }
  parts.push("");
  if (context.agentsMd) {
    parts.push("# The repository's AGENTS.md", "", context.agentsMd.trim(), "");
  }
  return parts.join("\n");
}
