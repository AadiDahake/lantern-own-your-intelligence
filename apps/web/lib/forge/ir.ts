/**
 * The Capability IR as the forge engine consumes it.
 *
 * The type, the JSON Schema and the validator belong to the compiler (`@lantern/capability`).
 * The engine checks a specification at its own boundary because one can also arrive inline in a
 * request body, and a malformed one must fail before a sandbox is paid for.
 */
import { assertCapabilityIR, CapabilityIRError, type CapabilityIR, type Scenario } from "@lantern/capability";

export type CapabilityIr = CapabilityIR;
export type IrScenario = Scenario;

/**
 * Validates against the compiler's schema and returns the spec typed. The one check the schema
 * does not make is scenario id uniqueness, and the engine reports per scenario id, so it is made
 * here.
 */
export function parseCapabilityIr(input: unknown): CapabilityIr {
  let ir: CapabilityIr;
  try {
    ir = assertCapabilityIR(input);
  } catch (error) {
    if (error instanceof CapabilityIRError) throw new Error(`Capability IR: ${error.errors.join("; ")}`);
    throw error;
  }
  const seen = new Set<string>();
  for (const scenario of ir.success.scenarios) {
    if (seen.has(scenario.id)) throw new Error(`Capability IR: scenario id ${scenario.id} must be unique.`);
    seen.add(scenario.id);
  }
  return ir;
}

/** The scenario ids in specification order. The verifier reports against exactly these. */
export function scenarioIds(ir: CapabilityIr): string[] {
  return ir.success.scenarios.map((scenario) => scenario.id);
}

/** `seat_party_together` -> `seat-party-together`, for branch names and paths. */
export function intentSlug(ir: CapabilityIr): string {
  return ir.intent.replace(/_/g, "-");
}

/** `seat_party_together` -> `seat party together`, for prose. */
export function intentWords(ir: CapabilityIr): string {
  return ir.intent.replace(/_/g, " ");
}
