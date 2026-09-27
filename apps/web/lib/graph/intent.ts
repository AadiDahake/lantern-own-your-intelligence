import { concepts } from "@lantern/shared";

/**
 * The key a question is remembered under: its concepts, sorted. "Where do I change my seat?" and
 * "how can I change seats" share one key, so the second answers from the graph with no model.
 */
export function intentKey(question: string): string {
  return [...concepts(question)].sort().join(" ");
}
