import { describe, expect, it } from "vitest";
import { isStorableFact } from "@/lib/agent/memory";

describe("isStorableFact", () => {
  it("keeps a short durable statement about the visitor", () => {
    expect(isStorableFact("The visitor is the owner of the workspace.")).toBe(true);
    expect(isStorableFact("The visitor is building a document extraction pipeline.")).toBe(true);
  });

  it("refuses anything that identifies or exposes the person", () => {
    expect(isStorableFact("The visitor's email is someone@example.com.")).toBe(false);
    expect(isStorableFact("The visitor can be reached on +1 415 555 0199.")).toBe(false);
    expect(isStorableFact("The visitor's API key starts with sk-live.")).toBe(false);
    expect(isStorableFact("The visitor said their password is hunter2.")).toBe(false);
  });

  it("refuses noise and essays", () => {
    expect(isStorableFact("ok")).toBe(false);
    expect(isStorableFact(`The visitor ${"x".repeat(200)}`)).toBe(false);
  });
});
