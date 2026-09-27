import { describe, expect, it } from "vitest";
import { replayUrl } from "@/lib/console/replay";

describe("replayUrl", () => {
  it("carries the question to the customer's own site", () => {
    expect(replayUrl("https://example.com", "How do I change my username?")).toBe(
      "https://example.com/?lantern_ask=How+do+I+change+my+username%3F",
    );
  });

  it("keeps a query the site already had", () => {
    expect(replayUrl("https://example.com/app?tab=home", "Where is billing?")).toBe(
      "https://example.com/app?tab=home&lantern_ask=Where+is+billing%3F",
    );
  });

  it("has no link without a site, a question, or a usable url", () => {
    expect(replayUrl(null, "Anything?")).toBeNull();
    expect(replayUrl("https://example.com", null)).toBeNull();
    expect(replayUrl("not a url", "Anything?")).toBeNull();
  });
});
