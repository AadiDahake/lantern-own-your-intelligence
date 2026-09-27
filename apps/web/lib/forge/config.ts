/**
 * Wiring the engine from the environment. The one place that decides which strategy runs and
 * where the model key comes from; everything below it takes explicit dependencies.
 */
import {
  codexApiKey,
  forgeLocalCacheDir,
  forgeStrategy,
  reflexApiKey,
  reflexApiUrl,
  reflexOrganizationId,
  reflexPersonaIds,
  runloopApiKey,
  runloopBlueprint,
  type ForgeStrategyName,
} from "../env";
import type { ForgeDeps } from "./engine";
import { LocalStrategy } from "./local";
import { loadPersonas } from "./personas";
import { ReflexClient } from "./reflex-client";
import { ReflexStrategy } from "./reflex";
import { RunloopStrategy, KEY_ENV } from "./runloop";
import type { ForgeStore } from "./store";
import type { SandboxStrategy } from "./strategy";

export type StrategyBuild = { strategy: SandboxStrategy; codexApiKeyEnvVar: string | null };

/** Builds the configured strategy. Throws with the variable's name when it cannot run. */
export function buildStrategy(options: { name?: ForgeStrategyName; log?: (line: string) => void } = {}): StrategyBuild {
  const name = options.name ?? forgeStrategy();
  const key = codexApiKey();
  if (name === "reflex") {
    return {
      strategy: new ReflexStrategy({
        reflex: new ReflexClient({ apiKey: reflexApiKey(), organizationId: reflexOrganizationId(), baseUrl: reflexApiUrl() }),
        personaIds: reflexPersonaIds(),
        runloopApiKey: runloopApiKey(),
        log: options.log,
      }),
      // Reflex holds the organization's model key; nothing is handed to the box by Lantern.
      codexApiKeyEnvVar: null,
    };
  }
  if (name === "runloop") {
    if (!key) {
      throw new Error("Missing required environment variable OPENAI_API_KEY. A devbox has no saved Codex login.");
    }
    return {
      strategy: new RunloopStrategy({
        apiKey: runloopApiKey(),
        openaiApiKey: key,
        blueprintName: runloopBlueprint(),
        log: options.log,
      }),
      codexApiKeyEnvVar: KEY_ENV,
    };
  }
  return {
    strategy: new LocalStrategy({ cacheDir: forgeLocalCacheDir(), codexApiKey: key, log: options.log }),
    codexApiKeyEnvVar: key ? KEY_ENV : null,
  };
}

/**
 * Whether the configured strategy can run at all, decided before anything is written. The
 * message names the first missing variable.
 */
export function forgeAvailability(name: ForgeStrategyName = forgeStrategy()): { ok: true } | { ok: false; reason: string } {
  try {
    if (name === "reflex") {
      reflexApiKey();
      reflexPersonaIds();
      runloopApiKey();
    } else if (name === "runloop") {
      runloopApiKey();
      if (!codexApiKey()) throw new Error("Missing required environment variable OPENAI_API_KEY. A devbox has no saved Codex login.");
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

/** The engine's dependencies for one run. */
export function buildForgeDeps(store: ForgeStore, options: { name?: ForgeStrategyName; log?: (line: string) => void } = {}): ForgeDeps {
  const built = buildStrategy(options);
  return {
    strategy: built.strategy,
    store,
    personas: loadPersonas({ blueprintName: runloopBlueprint() }),
    codexApiKeyEnvVar: built.codexApiKeyEnvVar,
    log: options.log,
  };
}
