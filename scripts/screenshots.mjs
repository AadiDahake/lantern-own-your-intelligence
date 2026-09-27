#!/usr/bin/env node
// Screenshots with a private headless Chromium, 1440x900 at 2x. Never a shared browser.
//
//   node scripts/screenshots.mjs pages <out-dir> name=url[@selector] ...
//       one screenshot per page; @selector scrolls that element to the top first
//   node scripts/screenshots.mjs widget <out-dir> [prefix] [host-url]
//       the widget flow on the dev host (packages/widget: `npm run dev`), light and dark:
//       open, the three checks, the spotlight, the answer, and the dark host
//
// Needs the dev server for the pages and the widget mock for the widget flow.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const [mode, outDir, ...rest] = process.argv.slice(2);
if (!mode || !outDir) {
  console.error("usage: node scripts/screenshots.mjs pages|widget <out-dir> ...");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

async function shot(name) {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  console.log("screenshot:", path);
}

/** The Next.js dev badge is not part of the page. */
async function clean() {
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((node) => node.remove()));
}

if (mode === "pages") {
  for (const pair of rest) {
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const target = pair.slice(eq + 1);
    const at = target.indexOf("@");
    const url = at === -1 ? target : target.slice(0, at);
    const selector = at === -1 ? null : target.slice(at + 1);
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    if (selector) {
      await page.evaluate((sel) => {
        const node = document.querySelector(sel);
        if (!node) throw new Error(`no ${sel}`);
        window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 72, behavior: "instant" });
      }, selector);
      // Cards that come into view have a 700 ms transition plus their stagger.
      await page.waitForTimeout(1600);
    }
    await clean();
    await shot(name);
  }
}

if (mode === "widget") {
  const prefix = rest[0] ?? "widget";
  const host = rest[1] ?? "http://localhost:4319/";
  const widgetReady = () => page.waitForFunction(() => typeof window.Lantern === "object", null, { timeout: 15000 });

  await page.goto(host, { waitUntil: "networkidle" });
  await widgetReady();
  await shot(`${prefix}-host`);

  // Playwright pierces the open shadow root, so the launcher is reachable by its name.
  await page.getByRole("button", { name: "Open support" }).click();
  await page.getByRole("textbox", { name: "Ask a question" }).waitFor();
  await shot(`${prefix}-open`);

  await page.evaluate(() => window.Lantern.ask("Where do I change my seat?"));
  await page.waitForTimeout(900);
  await shot(`${prefix}-thinking`);

  // The answer carries steps, so guidance starts on its own: the panel closes and the ring appears.
  await page.waitForFunction(
    () => {
      const root = document.querySelector("lantern-widget")?.shadowRoot;
      const caption = root?.querySelector(".pl-spot__caption")?.textContent ?? "";
      return caption.length > 0 && !root?.querySelector(".pl-panel");
    },
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(500);
  await shot(`${prefix}-spotlight`);

  await page.keyboard.press("Escape");
  await page.locator("lantern-widget .pl-panel").waitFor();
  await page.waitForTimeout(400);
  await shot(`${prefix}-answer`);

  await page.goto(`${host}?host=dark`, { waitUntil: "networkidle" });
  await widgetReady();
  await page.evaluate(() => window.Lantern.ask("Can you seat my family together?"));
  await page.locator("lantern-widget .pl-card").waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot(`${prefix}-dark-host`);
}

await browser.close();
