#!/usr/bin/env node
/**
 * Asks the widget one question on the live host site, against a Lantern of your own.
 *
 * The host page keeps its own widget script tag. Every request it makes to the deployed Lantern
 * is intercepted and served from `LANTERN_API` instead: the widget bundle from
 * `apps/web/public/widget.js`, and every `/api/...` call from the running dev server. So the real
 * widget runs on the real page, and the answer comes from the code in this working tree.
 *
 * It prints what the server streamed (the capability, each check with its score, the verdict, the
 * answer, the steps and the plan) and what the widget ended up showing, so a pull request can
 * quote the answer a customer would read rather than a summary of it.
 *
 *   npm run dev -w @lantern/web -- -p 4211
 *   NOVAAIR_BASE_URL=https://<host site> LANTERN_DEPLOYED=https://<deployed Lantern> \
 *     LANTERN_API=http://localhost:4211 node scripts/ask-live.mjs "Where do I change my seat?" home
 *
 * The second argument is where to ask from: `home`, `trip` or `seats` (the default). Reaching the
 * trip and seat pages walks the booking lookup, so the run needs the demo reservation to exist.
 *
 * `LANTERN_KEY` asks as a different project than the one the page's own script tag names. Use it
 * when the page is a preview build: every question writes the page it was asked on into that
 * project's product map, and a preview's controls do not belong in the map of the site the
 * project was explored from.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const SITE = process.env.NOVAAIR_BASE_URL;
const DEPLOYED = process.env.LANTERN_DEPLOYED;
if (!SITE || !DEPLOYED) {
  console.error("Set NOVAAIR_BASE_URL to the host site and LANTERN_DEPLOYED to the Lantern origin its script tag names.");
  process.exit(2);
}
const API = process.env.LANTERN_API ?? "http://localhost:4211";
const BOOKING = process.env.NOVAAIR_BOOKING ?? "NVA7K2";
const LAST_NAME = process.env.NOVAAIR_LAST_NAME ?? "Musk";
const QUESTION = process.argv[2] ?? "Where do I change my seat?";
const FROM = process.argv[3] ?? "seats";
const SHOT = process.env.SHOT ?? "";

const widget = await readFile(new URL("../apps/web/public/widget.js", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: Number(process.env.VIEWPORT_HEIGHT ?? 900) } });

let answered = null;

await page.route(`${DEPLOYED}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/widget.js") {
    return route.fulfill({ status: 200, contentType: "application/javascript", body: widget });
  }
  const started = Date.now();
  let sent = route.request().postData() ?? undefined;
  if (sent && process.env.LANTERN_KEY) {
    sent = JSON.stringify({ ...JSON.parse(sent), key: process.env.LANTERN_KEY });
  }
  const response = await fetch(`${API}${url.pathname}${url.search}`, {
    method: route.request().method(),
    headers: { "content-type": "application/json" },
    body: sent,
  });
  const body = Buffer.from(await response.arrayBuffer());
  if (url.pathname === "/api/chat") {
    console.log(`--- the turn answered in ${Date.now() - started} ms`);
    for (const line of body.toString("utf8").split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "understanding") {
        console.log(`capability: "${event.feature}" (intent ${event.intent})`);
      } else if (event.type === "probe" && event.status === "done") {
        const score = event.result.score === null ? "none" : Number(event.result.score).toFixed(2);
        console.log(`${event.probe}: hit=${event.result.hit} score=${score} ${event.result.summary}`);
      } else if (event.type === "verdict") {
        console.log(`verdict: ${event.verdict.outcome}`);
      } else if (event.type === "answer") {
        answered = event;
        console.log(`answer: ${event.text}`);
        console.log(`steps: ${JSON.stringify(event.steps)}`);
        console.log(`plan: ${JSON.stringify(event.plan ?? null)}`);
        console.log(`report offered: ${event.escalation?.offered === true}, recorded: ${event.noted === true}`);
      }
    }
    console.log("---");
  }
  return route.fulfill({
    status: response.status,
    contentType: response.headers.get("content-type") ?? "application/json",
    body,
  });
});

if (FROM === "home") {
  await page.goto(`${SITE}/`, { waitUntil: "load" });
} else {
  await page.goto(`${SITE}/my-booking`, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByLabel("Confirmation code").fill(BOOKING);
    await page.getByLabel("Last name").fill(LAST_NAME);
    await page.getByRole("button", { name: "Find my booking" }).click();
    try {
      await page.waitForURL(/\/trips\//, { timeout: 20_000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  if (FROM === "seats") {
    await page.getByRole("link", { name: "Change seats" }).first().click();
    await page.waitForURL(/\/seats$/, { timeout: 30_000 });
  }
}
await page.waitForTimeout(1500);
console.log(`page: ${page.url()}`);
console.log(`asked: ${QUESTION}`);

await page.getByRole("button", { name: "Open support" }).click();
const composer = page.getByRole("textbox").last();
await composer.fill(QUESTION);
const asked = Date.now();
await composer.press("Enter");
for (let waited = 0; waited < 120 && !answered; waited += 1) await page.waitForTimeout(500);
console.log(`time to the answer: ${Date.now() - asked} ms`);

// The card reveals its text a few words at a time, and the actions appear once it has settled.
await page.waitForTimeout(3500);
const shown = await page.evaluate(() => {
  const root = document.querySelector("lantern-widget")?.shadowRoot;
  if (!root) return null;
  const card = [...root.querySelectorAll(".pl-card")].pop();
  return {
    card: card?.querySelector("p")?.textContent ?? "",
    action: card?.querySelector(".pl-btn")?.textContent ?? "",
    label: card?.querySelector(".pl-card__label")?.textContent ?? "",
    counter: root.querySelector(".pl-spot__counter")?.textContent ?? "",
  };
});
console.log(`the widget shows: ${JSON.stringify(shown, null, 2)}`);
if (SHOT) await page.screenshot({ path: SHOT });
await browser.close();
if (!answered) process.exitCode = 1;
