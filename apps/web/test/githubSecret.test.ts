import { beforeAll, describe, expect, it } from "vitest";

/**
 * The stored GitHub token and the OAuth state cookie both hang off the service role key, so these
 * cover the two things that must never quietly stop working: a token that round-trips, and a state
 * that only verifies when this server signed it.
 */
beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

const load = async () => import("../lib/github/secret");

describe("token encryption", () => {
  it("round-trips a token", async () => {
    const { encryptToken, decryptToken } = await load();
    const token = "gho_" + "a".repeat(36);
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("produces a different ciphertext every time", async () => {
    const { encryptToken } = await load();
    expect(encryptToken("gho_same")).not.toBe(encryptToken("gho_same"));
  });

  it("refuses a tampered ciphertext instead of returning plaintext", async () => {
    const { encryptToken, decryptToken } = await load();
    const parts = encryptToken("gho_secret").split(".");
    const flipped = [parts[0], `${parts[1]}AA`, parts[2]].join(".");
    expect(decryptToken(flipped)).toBeNull();
  });

  it("treats an unreadable stored value as no connection", async () => {
    const { decryptToken } = await load();
    expect(decryptToken("not-a-ciphertext")).toBeNull();
    expect(decryptToken("")).toBeNull();
  });
});

describe("oauth state", () => {
  it("verifies a state it issued", async () => {
    const { issueState, verifyState } = await load();
    expect(verifyState(issueState())).toBe(true);
  });

  it("rejects a forged or truncated state", async () => {
    const { issueState, verifyState } = await load();
    const [nonce, signature] = issueState().split(".");
    expect(verifyState(`${nonce}.forged`)).toBe(false);
    expect(verifyState(`other-nonce.${signature}`)).toBe(false);
    expect(verifyState(nonce ?? "")).toBe(false);
    expect(verifyState("")).toBe(false);
  });
});
