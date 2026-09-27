#!/usr/bin/env node
// The terminal live view. Tails /api/trace/stream and draws the evidence loop as it happens:
// the four stages of the story, then the sandbox steps, then every trace row.
//
//   LANTERN_URL=http://localhost:3000 LANTERN_CONSOLE_TOKEN=... npm run tail
//   npm run tail -- --group <groupId>          one opportunity only
//   npm run tail -- --escalation <id>          one forge run only
//   npm run tail -- --since 0 --backfill 200   replay the last rows before following
//
// Zero dependencies: Node's fetch reads the stream, ANSI escapes draw the screen. The token is
// the console's LANTERN_CONSOLE_TOKEN; without it the server answers 401, exactly as it would a
// browser with no session.
import { apply, createState, parseSse, renderLines } from "./lib/tail-render.mjs";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const BASE = (process.env.LANTERN_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.LANTERN_CONSOLE_TOKEN;
const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const BACKFILL = Number(value("backfill") ?? "120");

const filters = new URLSearchParams();
if (value("group")) filters.set("groupId", value("group"));
if (value("escalation")) filters.set("escalationId", value("escalation"));
if (value("conversation")) filters.set("conversationId", value("conversation"));

const state = createState();
if (value("since")) state.lastId = Number(value("since"));

const headers = () => ({
  accept: "text/event-stream",
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
});

function draw() {
  const lines = renderLines(state, {
    color: COLOR,
    rows: process.stdout.rows ?? 40,
    width: process.stdout.columns ?? 100,
    baseUrl: BASE,
  });
  if (COLOR) process.stdout.write("\x1b[H\x1b[2J");
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** The last rows before now, so the board is not blank when the run already started. */
async function backfill() {
  if (!(BACKFILL > 0)) return;
  const query = new URLSearchParams(filters);
  query.set("limit", String(BACKFILL));
  query.set("order", "desc");
  const response = await fetch(`${BASE}/api/trace?${query}`, { headers: headers() });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  const body = await response.json();
  const events = (body.events ?? []).slice().reverse();
  for (const event of events) apply(state, event);
}

async function follow() {
  for (;;) {
    try {
      const query = new URLSearchParams(filters);
      if (state.lastId) query.set("since", String(state.lastId));
      const response = await fetch(`${BASE}/api/trace/stream?${query}`, {
        headers: { ...headers(), ...(state.lastId ? { "last-event-id": String(state.lastId) } : {}) },
      });
      if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
      state.connection = "live";
      draw();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const parsed = parseSse(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.events) {
          if (frame.event !== "trace") continue;
          try {
            apply(state, JSON.parse(frame.data));
          } catch {
            // A malformed frame is not worth losing the stream over.
          }
        }
        if (parsed.events.length > 0) draw();
      }
      // The server closes every few minutes on purpose; reconnect from the last id.
      state.connection = "reconnecting";
      draw();
    } catch (error) {
      state.connection = `reconnecting: ${error.message}`;
      draw();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

try {
  await backfill();
} catch (error) {
  state.connection = `backfill failed: ${error.message}`;
}
draw();
await follow();
