import { describe, expect, it } from "vitest";
import { objectKey } from "@/lib/ingest/storage";

const PROJECT = "0cbbb9a0-3753-43c1-bef0-eef42a7046b6";
const DOCUMENT = "37bd9a43-6f87-409a-a2f5-972b7bbb31c5";

describe("objectKey", () => {
  it("keeps a plain filename as it is", () => {
    expect(objectKey(PROJECT, DOCUMENT, "handbook.pdf")).toBe(
      `${PROJECT}/${DOCUMENT}/handbook.pdf`,
    );
  });

  it("collapses anything that is not a path segment", () => {
    expect(objectKey(PROJECT, DOCUMENT, "my handbook (v2).pdf")).toBe(
      `${PROJECT}/${DOCUMENT}/my-handbook-v2-.pdf`,
    );
  });

  it("refuses to let a filename climb out of its folder", () => {
    expect(objectKey(PROJECT, DOCUMENT, "../../secrets.env")).toBe(
      `${PROJECT}/${DOCUMENT}/..-..-secrets.env`,
    );
  });

  it("falls back to a name when there is nothing usable left", () => {
    expect(objectKey(PROJECT, DOCUMENT, "///")).toBe(`${PROJECT}/${DOCUMENT}/source`);
  });

  it("keeps long names within the key limit", () => {
    const key = objectKey(PROJECT, DOCUMENT, `${"a".repeat(400)}.pdf`);
    expect(key.split("/")[2]?.length).toBe(120);
  });
});
