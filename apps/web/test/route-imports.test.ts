/**
 * What a serverless function may reach.
 *
 * A route or a page is deployed with everything its imports reach. The explorer drives a headless
 * browser, which a function cannot run, and when the explore route reached it through the job
 * queue the function shipped Playwright and, through the explorer's file read, the whole project.
 * This walks the real import graph from every file under `app/`, so that cannot come back unseen.
 *
 * The walk is stricter than the bundler on one point: an import counts unless it says `type`. An
 * import that is only used as a type must say so to pass.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BROWSER_PACKAGES = ["playwright", "playwright-core", "@playwright/test"];
const EXPLORER = "lib/graph/explorer.ts";

type Imports = { files: string[]; packages: string[] };

const display = (file: string): string => relative(WEB_ROOT, file).split("\\").join("/");
const isSource = (file: string): boolean => /\.tsx?$/.test(file) && !file.endsWith(".d.ts");

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return isSource(path) ? [path] : [];
  });
}

/** `@scope/name/sub` and `name/sub` both belong to the package before the subpath. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** The file a specifier inside this app names, or null when it names a package. */
function resolveLocal(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(WEB_ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (base === null) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? base;
}

/** True when the statement is erased before anything is bundled. */
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  if (clause.name || !named || !ts.isNamedImports(named)) return false;
  return named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly);
}

function specifiersOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!isTypeOnlyImport(node)) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) found.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const importCache = new Map<string, Imports>();

function importsOf(file: string): Imports {
  const cached = importCache.get(file);
  if (cached) return cached;
  const imports: Imports = { files: [], packages: [] };
  for (const specifier of specifiersOf(file)) {
    const local = resolveLocal(specifier, file);
    if (local === null) imports.packages.push(packageName(specifier));
    else if (isSource(local) && existsSync(local)) imports.files.push(local);
  }
  importCache.set(file, imports);
  return imports;
}

/**
 * The shortest import chain from an entry to the browser, or null when there is none. The chain
 * is what a failure prints, so the edit that caused it is the last arrow.
 */
function chainToBrowser(entry: string): string | null {
  const cameFrom = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (let at: string | null = file; at !== null; at = cameFrom.get(at) ?? null) chain.unshift(display(at));
    return chain;
  };
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (display(file) === EXPLORER) return chainTo(file).join(" -> ");
    const imports = importsOf(file);
    const browser = imports.packages.find((name) => BROWSER_PACKAGES.includes(name));
    if (browser) return [...chainTo(file), browser].join(" -> ");
    for (const next of imports.files) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, file);
      queue.push(next);
    }
  }
  return null;
}

const entries = [...sourcesUnder(join(WEB_ROOT, "app")), join(WEB_ROOT, "proxy.ts")];

describe("what a route or a page reaches", () => {
  it("never reaches the explorer or a headless browser", () => {
    expect(entries.length).toBeGreaterThan(40);
    const chains = entries.map(chainToBrowser).filter((chain): chain is string => chain !== null);
    expect(chains).toEqual([]);
  });

  it("follows the explore route to the job queue and finds the browser behind the runner's module", () => {
    // Without these the first test could pass because the walk saw nothing.
    const route = join(WEB_ROOT, "app/api/site/explore/route.ts");
    expect(importsOf(route).files.map(display)).toContain("lib/graph/jobs.ts");
    expect(chainToBrowser(join(WEB_ROOT, "lib/graph/run-exploration.ts"))).toBe(
      "lib/graph/run-exploration.ts -> lib/graph/explorer.ts",
    );
    expect(importsOf(join(WEB_ROOT, EXPLORER)).packages).toContain("playwright");
  });
});
