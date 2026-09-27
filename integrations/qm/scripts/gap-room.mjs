#!/usr/bin/env node
/**
 * Posts Lantern gaps into a QM room and prints what the room agent answers.
 *
 *   node scripts/gap-room.mjs [--from fixtures/requests.json] [--id GROUP_ID] [--dry-run]
 *
 * Lantern is a QM surface ("lantern"). It signs each request to core with CORE_SIGNING_SECRET from
 * this directory's .env. The room is one QM project, "Lantern gaps"; each gap is one thread in it,
 * so a teammate who is a member reads and continues the same thread from the web UI.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = join(here, "..");
const tool = join(deployment, "sandbox", "tools", "lantern", "lantern");

const ROOM_NAME = "Lantern gaps";
const REPLY_TIMEOUT_MS = 180_000;

function parseArgs(argv) {
  const args = { from: null, id: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--from") args.from = argv[++i];
    else if (flag === "--id") args.id = argv[++i];
    else throw new Error(`unknown option ${flag}`);
  }
  return args;
}

/** Reads one value from .env without exporting the rest. */
function envValue(name) {
  if (process.env[name]) return process.env[name];
  const text = readFileSync(join(deployment, ".env"), "utf8");
  const line = text.split("\n").find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
}

/** The first gap, formatted by the same tool the room agent runs. */
function firstGap(args) {
  const toolArgs = ["gaps", "--json", "--limit", "1"];
  if (args.from) toolArgs.push("--from", args.from);
  if (args.id) toolArgs.push("--id", args.id);
  const run = spawnSync(process.execPath, [tool, ...toolArgs], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr.trim() || "the lantern tool failed");
  const [first] = JSON.parse(run.stdout);
  if (!first) throw new Error("Lantern has no gap to post.");
  return first;
}

export function sign(secret, method, pathWithQuery, body, nowSec = Math.floor(Date.now() / 1000)) {
  const canonical = `${method}\n${pathWithQuery}\n${body}`;
  const signature = createHmac("sha256", secret).update(`v0:${nowSec}:${canonical}`).digest("hex");
  return { "x-timestamp": String(nowSec), "x-signature": `v0=${signature}` };
}

/** The portal identity core requires on user-scoped routes: base64url claims, a dot, their HMAC. */
export function portalIdentity(secret, principal, nowMs = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ p: principal, exp: nowMs + 60_000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function coreClient(base, secrets, principal) {
  return async function call(method, pathWithQuery, payload) {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const response = await fetch(`${base}${pathWithQuery}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-portal-identity": portalIdentity(secrets.portal, principal),
        ...sign(secrets.core, method, pathWithQuery, body),
      },
      body: body || undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`QM core answered ${response.status} for ${method} ${pathWithQuery}: ${text}`);
    return text ? JSON.parse(text) : {};
  };
}

async function ensureRoom(call, principal) {
  const query = `/v1/projects?principalId=${encodeURIComponent(principal)}`;
  const { projects = [] } = await call("GET", query);
  const existing = projects.find((project) => project.name === ROOM_NAME);
  if (existing) return existing;
  const { project } = await call("POST", "/v1/projects", { principalId: principal, name: ROOM_NAME });
  return project;
}

export function gapTurn(principal, projectId, gap) {
  const threadRef = `lantern:gap:${gap.gap.id}`;
  return {
    surface: "lantern",
    actor: { externalId: principal, displayName: "Lantern" },
    conversation: { kind: "group", channelRef: `web-project-${projectId}`, channelName: ROOM_NAME, threadRef },
    deliveryTarget: threadRef,
    text: `${gap.text}\n\nUse the lantern-gap-room skill. Tell the room what users want and what to do next.`,
  };
}

async function waitForReply(call, threadRef) {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { deliveries = [] } = await call("GET", "/v1/deliveries?type=lantern");
    const mine = deliveries.filter((delivery) => delivery.destination?.target === threadRef);
    if (mine.length > 0) {
      for (const delivery of mine) await call("POST", `/v1/deliveries/${delivery.id}/ack`, {});
      return mine.map((delivery) => delivery.text ?? delivery.message?.text ?? JSON.stringify(delivery)).join("\n");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`No reply from the room agent in ${REPLY_TIMEOUT_MS / 1000} s.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gap = firstGap(args);
  const principal = envValue("QM_PRINCIPAL") || "admin@lantern.local";
  process.stdout.write(`Gap from Lantern:\n${gap.text}\n\n`);
  if (args.dryRun) {
    process.stdout.write(`Turn Lantern would post:\n${JSON.stringify(gapTurn(principal, "<room>", gap), null, 2)}\n`);
    return;
  }
  const secrets = { core: envValue("CORE_SIGNING_SECRET"), portal: envValue("PORTAL_IDENTITY_SECRET") };
  const call = coreClient(envValue("QM_CORE_URL") || "http://localhost:8080", secrets, principal);
  const room = await ensureRoom(call, principal);
  process.stdout.write(`Room: "${room.name}" (QM project ${room.id})\n`);
  const turn = gapTurn(principal, room.id, gap);
  const accepted = await call("POST", "/v1/turns?async=1", turn);
  process.stdout.write(`Posted to thread ${turn.conversation.threadRef} (run ${accepted.runId ?? "accepted"})\n`);
  process.stdout.write("Waiting for the room agent...\n\n");
  process.stdout.write(`Room agent:\n${await waitForReply(call, turn.conversation.threadRef)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`gap-room: ${error.message}\n`);
    process.exitCode = 1;
  });
}
