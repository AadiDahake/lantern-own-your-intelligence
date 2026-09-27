import { afterEach, describe, expect, it } from "vitest";
import { appUrl, codexApiKey, escalationEngine, forgeStrategy, forgeTargetRepo, openaiApiKey, targetVercelProject } from "@/lib/env";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("env", () => {
  it("names the variable when a required one is missing", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => openaiApiKey()).toThrow(/OPENAI_API_KEY/);
  });

  it("treats an empty value as missing", () => {
    process.env.OPENAI_API_KEY = "";
    expect(() => openaiApiKey()).toThrow(/OPENAI_API_KEY/);
  });

  it("falls back to the documented default for optional variables", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(appUrl()).toBe("http://localhost:3000");
    delete process.env.TARGET_VERCEL_PROJECT;
    expect(targetVercelProject()).toBe("novaair");
  });

  it("only accepts the two known escalation engines", () => {
    process.env.ESCALATION_ENGINE = "forge";
    expect(escalationEngine()).toBe("forge");
    process.env.ESCALATION_ENGINE = "nonsense";
    expect(escalationEngine()).toBe("local");
    delete process.env.ESCALATION_ENGINE;
    expect(escalationEngine()).toBe("local");
  });

  it("picks the forge strategy from the keys that are present unless told otherwise", () => {
    delete process.env.FORGE_STRATEGY;
    delete process.env.REFLEX_API_KEY;
    delete process.env.RUNLOOP_API_KEY;
    expect(forgeStrategy()).toBe("local");
    process.env.RUNLOOP_API_KEY = "rl";
    expect(forgeStrategy()).toBe("runloop");
    process.env.REFLEX_API_KEY = "rfx";
    expect(forgeStrategy()).toBe("reflex");
    process.env.FORGE_STRATEGY = "local";
    expect(forgeStrategy()).toBe("local");
    process.env.FORGE_STRATEGY = "nonsense";
    expect(forgeStrategy()).toBe("reflex");
  });

  it("defaults the forge target and lets Codex run on the saved login without a key", () => {
    delete process.env.FORGE_TARGET_REPO;
    expect(forgeTargetRepo()).toBe("AadiDahake/novaair-own-your-intelligence");
    delete process.env.OPENAI_API_KEY;
    expect(codexApiKey()).toBeNull();
  });
});
