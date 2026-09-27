import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "./capability-ir.schema.json";
import type { CapabilityIR, JsonSchema } from "./types";

/**
 * One Ajv instance for the package. Strict mode, so an unknown keyword in any schema is an error
 * at compile time rather than a silently ignored rule. Formats come from ajv-formats, which is
 * what makes `date-time` and `uri` real checks.
 */
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const validateIr: ValidateFunction<CapabilityIR> = ajv.compile<CapabilityIR>(schema);

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function describe(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => {
    const where = e.instancePath === "" ? "/" : e.instancePath;
    const extra =
      e.keyword === "additionalProperties" && typeof e.params.additionalProperty === "string"
        ? ` (${e.params.additionalProperty})`
        : "";
    return `${where} ${e.message ?? e.keyword}${extra}`;
  });
}

/**
 * Validate a candidate IR. An invalid one is refused with the reasons; it is never stored, and
 * the compiler never returns one.
 */
export function validateCapabilityIR(value: unknown): ValidationResult<CapabilityIR> {
  if (validateIr(value)) return { ok: true, value };
  return { ok: false, errors: describe(validateIr.errors) };
}

export class CapabilityIRError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Capability IR is invalid: ${errors.join("; ")}`);
    this.name = "CapabilityIRError";
  }
}

export function assertCapabilityIR(value: unknown): CapabilityIR {
  const result = validateCapabilityIR(value);
  if (!result.ok) throw new CapabilityIRError(result.errors);
  return result.value;
}

/** The schema itself, for callers that hand it to a model as an output format. */
export const CAPABILITY_IR_SCHEMA: JsonSchema = schema as JsonSchema;

const compiled = new Map<JsonSchema, ValidateFunction>();

/**
 * Validate a model reply against the output schema the prompt was given. Model output is input
 * from outside the system, so it is checked at the boundary and never cast.
 */
export function validateAgainst<T>(value: unknown, outputSchema: JsonSchema): ValidationResult<T> {
  let fn = compiled.get(outputSchema);
  if (!fn) {
    fn = ajv.compile(outputSchema);
    compiled.set(outputSchema, fn);
  }
  if (fn(value)) return { ok: true, value: value as T };
  return { ok: false, errors: describe(fn.errors) };
}
