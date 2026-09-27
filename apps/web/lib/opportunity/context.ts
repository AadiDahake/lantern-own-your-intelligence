/**
 * What the compiler is told about the product beyond its events: the page the sessions were
 * recorded on, and the rules the help centre already states. Today every project is NovaAir's
 * seat map; the context is looked up here so a second product is one more entry, not a fork.
 */
import { NOVAAIR_CONTEXT, type CompileContext } from "@lantern/capability";

export function compileContextFor(input: { groupId: string }): CompileContext {
  return { ...NOVAAIR_CONTEXT, opportunity_id: input.groupId };
}
