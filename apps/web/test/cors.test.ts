import { describe, expect, it } from "vitest";
import { corsJson, preflight } from "@/lib/cors";

describe("cors", () => {
  it("answers preflight with no content and the allow headers", () => {
    const response = preflight();
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("sets the headers on a JSON response", async () => {
    const response = corsJson({ ok: true });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
