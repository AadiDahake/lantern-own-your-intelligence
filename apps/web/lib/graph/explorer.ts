/**
 * The explorer: functional discovery of the host product, done once, with a headless browser.
 *
 * It starts at the site's address, reads every page with the same scanner the widget uses, follows
 * internal links, presses the controls that are not links to see what they do, and fills the forms
 * it meets with values a model suggests from the page's own text. Every page becomes a node, every
 * press that changed the page becomes a transition, and every press that only showed more of the
 * same page becomes a reveal. Bounded in depth, pages and presses, and careful never to press
 * anything that reads as destructive.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { EFFORT, MODELS, controlKey, controlRefOf, routeOf } from "@lantern/shared";
import type { Affordance, PageContext } from "@lantern/shared";
import { chatJson } from "../openai";
import { recordScan, recordTransition } from "./store";

export type ExploreOptions = {
  projectId: string;
  siteUrl: string;
  /** How many links deep from the start page. */
  maxDepth?: number;
  maxPages?: number;
  /** How many non-link controls to press per page. */
  maxPressesPerPage?: number;
  /** How many forms to try to fill and submit over the whole run. */
  maxForms?: number;
  /** Reports progress as pages are read. */
  onProgress?: (line: string) => void;
};

export type ExploreSummary = {
  pages: number;
  controls: number;
  transitions: number;
  reveals: number;
  formsTried: number;
  visited: string[];
  skipped: string[];
  durationMs: number;
};

const DEFAULTS = { maxDepth: 3, maxPages: 40, maxPressesPerPage: 25, maxForms: 4 };

/** Controls that change or lose something. Reading a product must never press them. */
const DESTRUCTIVE =
  /\b(delete|remove|cancel|log ?out|sign ?out|pay|purchase|buy|confirm|submit|checkout|unsubscribe|reset|revoke|close account)\b/i;

/** A name this long is a data row, not a way around the product. */
const MAX_PRESS_NAME_LENGTH = 40;

const SETTLE_MS = 350;
/** A press that shows more than this has re-rendered the page, not opened something. */
const MAX_REVEALS_PER_PRESS = 20;
const NAVIGATION_TIMEOUT_MS = 15_000;

type Scanner = { scan: (question?: string) => PageContext; press: (id: string) => boolean };

declare global {
  interface Window {
    __lanternScanner?: Scanner;
  }
}

/** The scanner bundle the widget package builds beside itself. */
async function scannerSource(): Promise<string> {
  const candidates = [
    join(process.cwd(), "public", "scanner.js"),
    join(process.cwd(), "apps", "web", "public", "scanner.js"),
    join(process.cwd(), "..", "..", "packages", "widget", "dist", "scanner.js"),
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, "utf8");
    } catch {
      // Try the next location.
    }
  }
  throw new Error("The scanner bundle is missing. Run `npm run build -w @lantern/widget` first.");
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
}

async function inject(page: Page, source: string): Promise<void> {
  const present = await page.evaluate(() => typeof window.__lanternScanner !== "undefined");
  if (!present) await page.addScriptTag({ content: source });
}

/**
 * Reads the page from the top. A press scrolls its control into view, and a scan taken from there
 * would report everything that scrolled into the viewport as newly visible, which is not a reveal.
 */
async function scanPage(page: Page, source: string): Promise<PageContext> {
  await inject(page, source);
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(() => window.__lanternScanner!.scan(""));
}

function sameSite(href: string, site: URL): boolean {
  try {
    return new URL(href, site).origin === site.origin;
  } catch {
    return false;
  }
}

function isInternalLink(affordance: Affordance, site: URL): boolean {
  if (affordance.role !== "link" || !affordance.href) return false;
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(affordance.href)) return false;
  if (/\.(pdf|png|jpe?g|gif|svg|zip|xml|json)$/i.test(affordance.href)) return false;
  return sameSite(affordance.href, site);
}

/**
 * Controls to press on one page, in the order worth trying: tabs and openers first, and no more
 * than two of a series. A seat map has two hundred buttons that all do the same kind of thing;
 * pressing two of them says what a seat does, pressing all of them says nothing more.
 */
function pressOrder(affordances: Affordance[], limit: number): Affordance[] {
  const ranked = affordances
    .filter(isPressable)
    .map((affordance, index) => ({ affordance, index, priority: affordance.role === "tab" || /\bmenu\b|\bopen\b|\bmore\b/i.test(affordance.name) ? 0 : 1 }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index);
  const seriesCount = new Map<string, number>();
  const kept: Affordance[] = [];
  for (const { affordance } of ranked) {
    const series = `${affordance.role}:${affordance.name.trim().split(/\s+/)[0]?.toLowerCase() ?? ""}`;
    const seen = seriesCount.get(series) ?? 0;
    if (seen >= 2) continue;
    seriesCount.set(series, seen + 1);
    kept.push(affordance);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** A control worth pressing to see what it does: not a link, visible, short-named, and safe. */
function isPressable(affordance: Affordance): boolean {
  if (affordance.role === "link" || affordance.role === "textbox" || affordance.role === "searchbox") return false;
  if (affordance.role === "combobox" || affordance.role === "spinbutton" || affordance.role === "slider") return false;
  if (!affordance.visible || affordance.disabled) return false;
  const name = affordance.name.trim();
  if (!name || name.length > MAX_PRESS_NAME_LENGTH) return false;
  if (DESTRUCTIVE.test(name)) return false;
  if (affordance.state?.includes("selected") || affordance.state?.includes("expanded")) return false;
  return true;
}

type FormField = { id: string; name: string; role: string; landmark?: string };

/** The fields and the submit control of the first form on the page, when it has both. */
function formOf(context: PageContext): { fields: FormField[]; submit: Affordance } | null {
  const inForm = context.affordances.filter((affordance) => affordance.landmark === "form" && affordance.visible);
  const fields = inForm.filter((affordance) =>
    ["textbox", "searchbox", "spinbutton", "combobox"].includes(affordance.role),
  );
  const submit = inForm.find(
    (affordance) => affordance.role === "button" && !DESTRUCTIVE.test(affordance.name) && affordance.name.trim() !== "",
  );
  if (fields.length === 0 || !submit) return null;
  return { fields: fields.map(({ id, name, role, landmark }) => ({ id, name, role, landmark })), submit };
}

const FORM_SCHEMA = {
  type: "object",
  properties: {
    values: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, value: { type: "string" } },
        required: ["id", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["values"],
  additionalProperties: false,
};

/**
 * Values for a form, suggested from what the page itself says: a demonstration site names its
 * sample code on the page, a search form says what it searches. The model invents plausible text
 * only where the page gives nothing.
 */
async function suggestFormValues(pageText: string, fields: FormField[]): Promise<Map<string, string>> {
  const result = await chatJson<{ values: { id: string; value: string }[] }>(
    MODELS.understand,
    [
      {
        role: "system",
        content:
          "You fill a form on a web page so that submitting it succeeds. Prefer values the page text itself gives as examples. Otherwise invent one plausible value per field. Never leave a field empty. JSON only.",
      },
      {
        role: "user",
        content: `Page text:\n${pageText.slice(0, 4000)}\n\nFields:\n${fields
          .map((field) => `${field.id}: ${field.role} "${field.name}"`)
          .join("\n")}`,
      },
    ],
    FORM_SCHEMA,
    { name: "form_values", maxTokens: 1500, effort: EFFORT.understand },
  );
  const values = new Map<string, string>();
  for (const entry of result.values ?? []) {
    if (typeof entry.id === "string" && typeof entry.value === "string" && entry.value.trim()) {
      values.set(entry.id, entry.value.trim());
    }
  }
  return values;
}

async function fillField(page: Page, id: string, value: string): Promise<void> {
  await page.evaluate(
    ([fieldId, text]) => {
      const scanner = window.__lanternScanner!;
      // The scanner keeps the element behind the id; pressing it focuses it, then typing lands there.
      scanner.press(fieldId as string);
      const active = document.activeElement as HTMLInputElement | null;
      if (!active) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(active, text);
      active.dispatchEvent(new Event("input", { bubbles: true }));
      active.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [id, value] as const,
  );
}

/** Explores the site and writes what it finds into the graph. */
export async function exploreSite(options: ExploreOptions): Promise<ExploreSummary> {
  const started = Date.now();
  const limits = { ...DEFAULTS, ...options };
  const site = new URL(options.siteUrl);
  const source = await scannerSource();
  const report = options.onProgress ?? (() => undefined);

  const summary: ExploreSummary = {
    pages: 0,
    controls: 0,
    transitions: 0,
    reveals: 0,
    formsTried: 0,
    visited: [],
    skipped: [],
    durationMs: 0,
  };

  const queue: { url: string; depth: number }[] = [{ url: site.toString(), depth: 0 }];
  const visited = new Set<string>();
  // Pages recorded so far, and the link edges waiting for their destination page to be recorded.
  const recorded = new Set<string>();
  const pendingLinks: { fromRoute: string; key: string; toRoute: string }[] = [];
  const linkEdges = new Set<string>();

  const flushLinks = async (): Promise<void> => {
    for (let index = pendingLinks.length - 1; index >= 0; index -= 1) {
      const edge = pendingLinks[index] as { fromRoute: string; key: string; toRoute: string };
      if (!recorded.has(edge.fromRoute) || !recorded.has(edge.toRoute)) continue;
      pendingLinks.splice(index, 1);
      await recordTransition(options.projectId, { ...edge, kind: "navigation" }, "explorer");
      summary.transitions += 1;
    }
  };
  const remember = async (context: PageContext): Promise<void> => {
    await recordScan(options.projectId, context, "explorer");
    recorded.add(routeOf(context.url));
    await flushLinks();
  };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    const page = await context.newPage();

    while (queue.length > 0 && summary.pages < limits.maxPages) {
      const next = queue.shift() as { url: string; depth: number };
      const route = routeOf(next.url);
      if (visited.has(route)) continue;
      visited.add(route);

      try {
        await page.goto(next.url, { waitUntil: "domcontentloaded" });
      } catch {
        summary.skipped.push(route);
        continue;
      }
      await settle(page);
      const scanned = await scanPage(page, source);
      // A soft redirect lands somewhere else; record where we actually are.
      const landedRoute = routeOf(scanned.url);
      visited.add(landedRoute);
      await remember(scanned);
      summary.pages += 1;
      summary.controls += scanned.affordances.length;
      summary.visited.push(landedRoute);
      report(`read ${landedRoute} (${scanned.affordances.length} controls)`);

      // Links: transitions we can be sure of, and the next pages to read. The edge is written
      // once its destination has been read, so it never points at a page the graph lacks.
      for (const affordance of scanned.affordances) {
        if (!isInternalLink(affordance, site)) continue;
        const target = new URL(affordance.href as string, scanned.url);
        target.hash = "";
        const targetRoute = routeOf(target.toString());
        const key = controlKey(controlRefOf(affordance, scanned.url));
        const edge = `${landedRoute}|${key}|${targetRoute}`;
        if (targetRoute !== landedRoute && !linkEdges.has(edge)) {
          linkEdges.add(edge);
          pendingLinks.push({ fromRoute: landedRoute, key, toRoute: targetRoute });
        }
        if (next.depth < limits.maxDepth && !visited.has(targetRoute)) {
          queue.push({ url: target.toString(), depth: next.depth + 1 });
        }
      }
      await flushLinks();

      // Buttons, tabs and the like: press each on a fresh load of the page and see what it did.
      const pressable = pressOrder(scanned.affordances, limits.maxPressesPerPage);
      for (const control of pressable) {
        const ref = controlRefOf(control, scanned.url);
        try {
          await page.goto(scanned.url, { waitUntil: "domcontentloaded" });
          await settle(page);
          const before = await scanPage(page, source);
          const live = before.affordances.find((candidate) => controlKey(controlRefOf(candidate, before.url)) === controlKey(ref));
          if (!live) continue;
          const pressed = await page.evaluate((id) => window.__lanternScanner!.press(id), live.id);
          if (!pressed) continue;
          await settle(page);
          const after = await scanPage(page, source);
          if (routeOf(after.url) !== landedRoute) {
            // It navigated. Record the new page and the edge, and queue it for its own read.
            await remember(after);
            await recordTransition(
              options.projectId,
              { fromRoute: landedRoute, key: controlKey(ref), toRoute: routeOf(after.url), kind: "navigation" },
              "explorer",
            );
            summary.transitions += 1;
            if (!visited.has(routeOf(after.url)) && next.depth < limits.maxDepth) {
              queue.push({ url: after.url, depth: next.depth + 1 });
            }
            continue;
          }
          // It stayed: whatever became visible is what this control reveals.
          const visibleBefore = new Set(
            before.affordances.filter((candidate) => candidate.visible).map((candidate) => controlKey(controlRefOf(candidate, before.url))),
          );
          const revealed = after.affordances.filter(
            (candidate) => candidate.visible && !visibleBefore.has(controlKey(controlRefOf(candidate, after.url))),
          );
          if (revealed.length === 0) continue;
          await remember(after);
          for (const shown of revealed.slice(0, MAX_REVEALS_PER_PRESS)) {
            await recordTransition(
              options.projectId,
              {
                fromRoute: landedRoute,
                key: controlKey(ref),
                toRoute: landedRoute,
                kind: "reveal",
                reveals: controlKey(controlRefOf(shown, after.url)),
              },
              "explorer",
            );
            summary.reveals += 1;
          }
          // A press that hid a panel made its sibling pressable: a tab that was selected on load.
          // Pressing it now records what it reveals, which is the way back to the default view.
          const wasPressable = new Set(before.affordances.filter(isPressable).map((candidate) => controlKey(controlRefOf(candidate, before.url))));
          const siblings = after.affordances.filter(
            (candidate) => isPressable(candidate) && !wasPressable.has(controlKey(controlRefOf(candidate, after.url))),
          );
          for (const sibling of siblings.slice(0, 3)) {
            const shownBefore = new Set(
              after.affordances.filter((candidate) => candidate.visible).map((candidate) => controlKey(controlRefOf(candidate, after.url))),
            );
            const pressedSibling = await page.evaluate((id) => window.__lanternScanner!.press(id), sibling.id);
            if (!pressedSibling) continue;
            await settle(page);
            const again = await scanPage(page, source);
            if (routeOf(again.url) !== landedRoute) break;
            const shownNow = again.affordances.filter(
              (candidate) => candidate.visible && !shownBefore.has(controlKey(controlRefOf(candidate, again.url))),
            );
            for (const shown of shownNow.slice(0, MAX_REVEALS_PER_PRESS)) {
              await recordTransition(
                options.projectId,
                {
                  fromRoute: landedRoute,
                  key: controlKey(controlRefOf(sibling, after.url)),
                  toRoute: landedRoute,
                  kind: "reveal",
                  reveals: controlKey(controlRefOf(shown, again.url)),
                },
                "explorer",
              );
              summary.reveals += 1;
            }
          }
        } catch {
          // One control that misbehaves should not end the exploration.
        }
      }

      // Forms: fill with values the page suggests, submit, and see where it leads.
      const form = formOf(scanned);
      if (form && summary.formsTried < limits.maxForms) {
        summary.formsTried += 1;
        try {
          await page.goto(scanned.url, { waitUntil: "domcontentloaded" });
          await settle(page);
          const fresh = await scanPage(page, source);
          const text = await page.evaluate(() => document.body.innerText);
          const liveForm = formOf(fresh);
          if (liveForm) {
            const values = await suggestFormValues(text, liveForm.fields);
            for (const field of liveForm.fields) {
              const value = values.get(field.id);
              if (value) await fillField(page, field.id, value);
            }
            await page.evaluate((id) => window.__lanternScanner!.press(id), liveForm.submit.id);
            await page.waitForURL((url) => routeOf(url.toString()) !== landedRoute, { timeout: 8_000 }).catch(() => undefined);
            await settle(page);
            const after = await scanPage(page, source);
            if (routeOf(after.url) !== landedRoute) {
              await remember(after);
              await recordTransition(
                options.projectId,
                {
                  fromRoute: landedRoute,
                  key: controlKey(controlRefOf(liveForm.submit, fresh.url)),
                  toRoute: routeOf(after.url),
                  kind: "navigation",
                },
                "explorer",
              );
              summary.transitions += 1;
              report(`form on ${landedRoute} led to ${routeOf(after.url)}`);
              if (!visited.has(routeOf(after.url)) && next.depth < limits.maxDepth) {
                queue.push({ url: after.url, depth: next.depth + 1 });
              }
            }
          }
        } catch {
          // A form that cannot be filled is simply not a path the graph knows.
        }
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  summary.durationMs = Date.now() - started;
  return summary;
}
