/**
 * The console token: a terminal client presents `LANTERN_CONSOLE_TOKEN` as a bearer token and
 * reads one project. Off unless the variable is set; a session cookie always wins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  account: null as { id: string; email: string; company: string | null } | null,
  authorization: null as string | null,
  projectBySlug: null as { id: string; slug: string } | null,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.authorization ? { authorization: state.authorization } : {}),
}));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => state.account }));
vi.mock("@/lib/console/provision", () => ({ ensureProject: async (account: { id: string }) => ({ id: `project-of-${account.id}` }) }));
vi.mock("@/lib/console/project", () => ({ loadProjectBySlug: async (slug: string) => (state.projectBySlug?.slug === slug ? state.projectBySlug : null) }));

import { bearerOf, currentProject, tokenMatches } from "@/lib/console/current";

describe("currentProject with LANTERN_CONSOLE_TOKEN", () => {
  beforeEach(() => {
    state.account = null;
    state.authorization = null;
    state.projectBySlug = { id: "demo", slug: "novaair" };
    vi.stubEnv("LANTERN_CONSOLE_TOKEN", "secret-token");
    vi.stubEnv("LANTERN_CONSOLE_PROJECT", "novaair");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers the configured project for the right bearer token", async () => {
    state.authorization = "Bearer secret-token";
    expect(await currentProject()).toEqual({ id: "demo", slug: "novaair" });
  });

  it("answers 401 for a wrong token, a missing header, or an unknown project", async () => {
    state.authorization = "Bearer wrong";
    await expect(currentProject()).rejects.toMatchObject({ status: 401 });
    state.authorization = null;
    await expect(currentProject()).rejects.toMatchObject({ status: 401 });
    state.authorization = "Bearer secret-token";
    state.projectBySlug = null;
    await expect(currentProject()).rejects.toMatchObject({ status: 401 });
  });

  it("is off when the variable is not set", async () => {
    vi.stubEnv("LANTERN_CONSOLE_TOKEN", "");
    state.authorization = "Bearer secret-token";
    await expect(currentProject()).rejects.toMatchObject({ status: 401 });
  });

  it("lets a session cookie win over the token", async () => {
    state.account = { id: "acct", email: "a@b.c", company: null };
    state.authorization = "Bearer secret-token";
    expect(await currentProject()).toEqual({ id: "project-of-acct" });
  });

  it("parses the header and compares in constant time", () => {
    expect(bearerOf("Bearer abc")).toBe("abc");
    expect(bearerOf("bearer   abc ")).toBe("abc");
    expect(bearerOf("Basic abc")).toBeNull();
    expect(bearerOf(null)).toBeNull();
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abd", "abc")).toBe(false);
    expect(tokenMatches("ab", "abc")).toBe(false);
    expect(tokenMatches(null, "abc")).toBe(false);
  });
});
