/**
 * Typed access to every environment variable the app reads.
 *
 * Every accessor resolves at call time, never at import time, so a missing variable fails the one
 * request that needed it with a message naming it, rather than taking the whole build or the whole
 * server down at boot.
 */
import type { EscalationEngine } from "@lantern/shared";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/** OpenAI API key. Server-side only. */
export const openaiApiKey = (): string => required("OPENAI_API_KEY");

/** Supabase project URL, `https://<ref>.supabase.co`. */
export const supabaseUrl = (): string => required("SUPABASE_URL");

/** Service role key. Server-side only; it bypasses row level security. */
export const supabaseServiceRoleKey = (): string => required("SUPABASE_SERVICE_ROLE_KEY");

/** Anon key. The public value behind NEXT_PUBLIC_SUPABASE_ANON_KEY. */
export const supabaseAnonKey = (): string => required("SUPABASE_ANON_KEY");

/** GitHub token used by the repository probe and the repository connection check. */
export const githubToken = (): string => required("GITHUB_TOKEN");

/**
 * The GitHub OAuth app that lets a console user link their own account.
 *
 * All three variables travel together, so this returns null unless the whole set is present. The
 * repository page then falls back to the server credential in GITHUB_TOKEN.
 */
export function githubOauthApp(): { clientId: string; clientSecret: string; redirect: string } | null {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const redirect = process.env.GITHUB_OAUTH_REDIRECT;
  if (!clientId || !clientSecret || !redirect) return null;
  return { clientId, clientSecret, redirect };
}

/** Vercel token used to watch the target project's deployments. */
export const vercelToken = (): string => required("VERCEL_TOKEN");

/** PostHog personal API key with `query:read` and `session_recording:read`. Server-side only. */
export const posthogPersonalApiKey = (): string => required("POSTHOG_PERSONAL_API_KEY");

/** The numeric id of the PostHog project the host product sends its events to. */
export const posthogProjectId = (): string => required("POSTHOG_PROJECT_ID");

/** The private API host: `https://us.posthog.com` on US Cloud, `https://eu.posthog.com` on EU. */
export const posthogHost = (): string => optional("POSTHOG_HOST", "https://us.posthog.com");

/** True when the two variables that make PostHog reachable are both set. */
export const posthogConfigured = (): boolean =>
  Boolean(process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID);

/** How far back the miner looks for sessions, in days. */
export const posthogWindowDays = (): number => {
  const value = Number(optional("POSTHOG_WINDOW_DAYS", "90"));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 90;
};

export type DiscoveryMode = "inline" | "runner";

/**
 * Who executes a queued discovery.
 *
 * `inline` lets the request that enqueued it run it after the response, which is right on a
 * laptop. `runner` leaves it for `npm run discover:runner`, which is right on a host that caps a
 * request's duration. The default follows the host: `runner` on Vercel, `inline` elsewhere.
 */
export function discoveryMode(): DiscoveryMode {
  const explicit = process.env.DISCOVERY_MODE;
  if (explicit === "inline" || explicit === "runner") return explicit;
  return process.env.VERCEL ? "runner" : "inline";
}

/**
 * A shared secret a terminal client presents as a bearer token in place of a session cookie,
 * with the slug of the project it may read. Off unless the token is set.
 */
export function consoleToken(): { token: string; projectSlug: string } | null {
  const token = process.env.LANTERN_CONSOLE_TOKEN;
  if (!token) return null;
  return { token, projectSlug: optional("LANTERN_CONSOLE_PROJECT", "novaair") };
}

/**
 * The key Codex runs with inside a sandbox, or null to run on the machine's own saved Codex
 * login. The local strategy accepts null; a devbox has no login, so the Runloop strategy does not.
 */
export const codexApiKey = (): string | null => process.env.OPENAI_API_KEY || null;

export type ForgeStrategyName = "reflex" | "runloop" | "local";

/**
 * Where the forge engine builds a candidate.
 *
 * `reflex` launches the three personas by id on Reflex and is the primary path. `runloop` drives
 * a Runloop devbox per candidate directly. `local` is a git worktree on this machine with the
 * machine's own `codex`: the development strategy and the fallback when no key is present. An
 * explicit `FORGE_STRATEGY` wins; otherwise the keys that are present decide, in that order.
 */
export function forgeStrategy(): ForgeStrategyName {
  const explicit = process.env.FORGE_STRATEGY;
  if (explicit === "local" || explicit === "runloop" || explicit === "reflex") return explicit;
  if (process.env.REFLEX_API_KEY) return "reflex";
  return process.env.RUNLOOP_API_KEY ? "runloop" : "local";
}

/** Reflex API key (`rfx_...`). Server-side only. */
export const reflexApiKey = (): string => required("REFLEX_API_KEY");

/** The Reflex organization every call is scoped to: an `org_...` id or the organization slug. */
export const reflexOrganizationId = (): string => optional("REFLEX_ORG", "doing_something");

/** The Reflex API base. */
export const reflexApiUrl = (): string => optional("REFLEX_API_URL", "https://reflex.runloop.ai/api");

/** The ids (`prs_...`) of the three personas, as created in the Reflex web app. */
export function reflexPersonaIds(): {
  capability_builder: string;
  ux_builder: string;
  capability_verifier: string;
} {
  return {
    capability_builder: required("REFLEX_PERSONA_BUILDER"),
    ux_builder: required("REFLEX_PERSONA_UX"),
    capability_verifier: required("REFLEX_PERSONA_VERIFIER"),
  };
}

/** Vercel token when one is set; the forge approval skips the deployment watch without it. */
export const vercelTokenIfSet = (): string | null => process.env.VERCEL_TOKEN || null;

/** Runloop API key. Server-side only. */
export const runloopApiKey = (): string => required("RUNLOOP_API_KEY");

/** A Runloop blueprint with Codex and the target's dependencies baked in. Optional. */
export const runloopBlueprint = (): string | null => process.env.RUNLOOP_BLUEPRINT || null;

/** `owner/name` of the repository a forge run targets when the project has none bound. */
export const forgeTargetRepo = (): string => optional("FORGE_TARGET_REPO", "AadiDahake/novaair-own-your-intelligence");

/** Where the local strategy keeps its clone and its worktrees. Defaults to the OS temp dir. */
export const forgeLocalCacheDir = (): string | null => process.env.FORGE_LOCAL_CACHE_DIR || null;

/**
 * Which engine runs an escalation.
 *
 * `local` is the worker's own runner and is the default. `forge` is the sandbox engine in
 * `lib/forge`: it builds a compiled capability in isolated sandboxes and opens the draft pull
 * request from the winner.
 */
export const escalationEngine = (): EscalationEngine =>
  optional("ESCALATION_ENGINE", "local") === "forge" ? "forge" : "local";

/** Public origin of this app, used to build the widget script URL and the embed snippet. */
export const appUrl = (): string => optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

/** Vercel project whose deployment the worker waits for after a merge. */
export const targetVercelProject = (): string => optional("TARGET_VERCEL_PROJECT", "novaair");

/** Stable address of the target project's production deployments. Unset returns each deployment's own URL. */
export const targetProductionUrl = (): string | null => process.env.TARGET_PRODUCTION_URL || null;

/** Optional Slack webhook, posted to when an issue and a pull request are drafted. */
export const slackWebhookUrl = (): string | null => process.env.SLACK_WEBHOOK_URL || null;
