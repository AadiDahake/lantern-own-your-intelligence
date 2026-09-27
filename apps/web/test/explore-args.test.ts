import { describe, expect, it } from "vitest";
import { parseExploreArgs } from "@/lib/graph/explore-args";

describe("parseExploreArgs", () => {
  it("reads one site for one project", () => {
    expect(parseExploreArgs(["--project", "novaair", "--url", "https://novaair.example.com"])).toEqual({
      mode: "one",
      project: "novaair",
      url: "https://novaair.example.com",
    });
    expect(parseExploreArgs(["--project", "novaair"])).toEqual({ mode: "one", project: "novaair", url: null });
  });

  it("reads the queue modes and refuses to mix them with a project", () => {
    expect(parseExploreArgs(["--drain"])).toEqual({ mode: "drain" });
    expect(parseExploreArgs(["--watch"])).toEqual({ mode: "watch" });
    expect(parseExploreArgs(["--drain", "--project", "x"])).toHaveProperty("error");
  });

  it("explains a missing value or an unknown flag", () => {
    expect(parseExploreArgs([])).toHaveProperty("error");
    expect(parseExploreArgs(["--project"])).toHaveProperty("error");
    expect(parseExploreArgs(["--nope"])).toHaveProperty("error");
  });
});
