/**
 * The classifier against the real model. Skipped unless OPENAI_API_KEY is set, so the suite stays
 * offline by default and a fork's pull request is checked the same way as a branch.
 *
 * This is the measurement that matters for intent routing: every fixture message, on the page it
 * would be asked on, landing in the class a support lead would put it in.
 */
import { describe, expect, it } from "vitest";
import { INTENT_FIXTURES, TRIP_PAGE } from "./fixtures/intents";
import { understand } from "@/lib/agent/understand";

const key = process.env.OPENAI_API_KEY;

describe.skipIf(!key)("the classifier, live", () => {
  it(
    "puts every fixture message in its class",
    async () => {
      const read = await Promise.all(
        INTENT_FIXTURES.map(async (fixture) => {
          const result = await understand(fixture.message, TRIP_PAGE);
          return { message: fixture.message, expected: fixture.intent, got: result.intent, feature: result.feature };
        }),
      );
      const wrong = read.filter((entry) => entry.got !== entry.expected);
      expect(wrong, JSON.stringify(wrong, null, 2)).toEqual([]);
      // A product question is only useful with a capability to search for.
      for (const entry of read.filter((entry) => entry.expected === "product")) {
        expect(entry.feature, entry.message).not.toBe("");
      }
    },
    120_000,
  );
});
