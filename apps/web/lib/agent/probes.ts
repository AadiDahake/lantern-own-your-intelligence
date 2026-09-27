/**
 * The three independent checks behind every answer.
 *
 * Absence is only asserted when all three come back empty, so each one is kept
 * cheap, independent, and honest about what it actually saw.
 */
import {
  DEFAULT_THRESHOLDS,
  EFFORT,
  MODELS,
  concepts,
  coverageNeeded,
  coversCapability,
  graphSize,
  searchControls,
} from "@lantern/shared";
import type { Affordance, PageContext, ProbeResult, SiteGraph } from "@lantern/shared";
import { chatJson, embed } from "../openai";
import { serviceClient } from "../supabase";
import { activeGithubToken } from "../github/connection";

/** Words that mean the same thing to a user but not to a string comparison. */
const SYNONYMS: Record<string, string[]> = {
  dark: ["theme", "appearance", "night"],
  theme: ["dark", "appearance"],
  username: ["name", "profile", "account", "display"],
  name: ["username", "profile"],
  key: ["token", "secret", "credential"],
  invite: ["member", "teammate", "collaborator"],
};

function expand(query: string): string {
  const extra: string[] = [];
  for (const token of concepts(query)) {
    const synonyms = SYNONYMS[token];
    if (synonyms) extra.push(...synonyms);
  }
  return extra.length ? `${query} ${extra.join(" ")}` : query;
}

/** One passage the documentation check found, with where it came from. */
export type DocsEvidence = {
  documentTitle: string;
  url: string | null;
  heading: string | null;
  snippet: string;
  similarity: number;
};

/**
 * Below this score no passage is about the question, and no reading is needed. Tuned on the
 * offline set in `scripts/eval-docs.ts`: the strongest unrelated question scored 0.27.
 */
export const DOCS_SURE_MISS = 0.4;

/** How much of the question's vocabulary a passage shares, 0 to 1. */
export function overlapOf(question: string, text: string): number {
  const asked = concepts(question);
  const found = concepts(text);
  let overlap = 0;
  for (const token of asked) if (found.has(token)) overlap += 1;
  return asked.size === 0 ? 0 : overlap / asked.size;
}

/**
 * The score a passage is ranked by: similarity, damped when the passage does not use the words
 * the question is about. Embeddings put unrelated prose surprisingly close together, so distance
 * alone will happily "find" a contact page for a question about theming.
 */
export function docsScore(similarity: number, overlap: number): number {
  return similarity * (0.6 + 0.4 * overlap);
}

const READ_SCHEMA = {
  type: "object",
  properties: { covers: { type: "boolean" }, reason: { type: "string" } },
  required: ["covers", "reason"],
  additionalProperties: false,
};

/**
 * Reads one passage for the question. A passage about the right subject can still say the
 * product does not do the thing: the article on traveling with children is the nearest text to
 * "find us seats together", and what it says is that seats move one passenger at a time. No
 * score tells those apart, so the band between a sure miss and a sure hit is read.
 */
export async function passageCovers(question: string, article: string, passage: string): Promise<boolean> {
  const result = await chatJson<{ covers: boolean; reason: string }>(
    MODELS.understand,
    [
      {
        role: "system",
        content: [
          "You read one passage of a product's help documentation and one customer question, and decide whether the passage shows that the product offers what the question asks for.",
          "Answer covers: true only when the passage describes the product doing exactly what the question asks, or a control in the product the customer uses to do exactly that, or the rule, fee or time the question asks about.",
          "Answer covers: false when the passage is about the subject but says the product cannot do it, that it is not guaranteed, that the customer should call or ask someone, or that the customer must work it out by hand one item at a time when the question asks the product to find, choose, arrange or do it for them.",
          "Be strict: a passage that explains a manual workaround for what was asked does not cover it. JSON only.",
        ].join(" "),
      },
      { role: "user", content: `Question: ${question}

Article: ${article}

Passage:
${passage}` },
    ],
    READ_SCHEMA,
    { name: "passage_read", maxTokens: 800, effort: EFFORT.understand },
  );
  return result.covers === true;
}

/**
 * Documentation: cosine search over the ingested chunks, damped by OCR confidence.
 *
 * The embedding can be handed in already in flight: it only depends on the question, so the
 * caller starts it next to the understanding call rather than after it.
 */
export async function probeDocs(
  question: string,
  projectId: string,
  embedding?: Promise<number[]> | number[],
  threshold: number = DEFAULT_THRESHOLDS.docsThreshold,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const vector = embedding ? await embedding : (await embed([question]))[0];
    const { data, error } = await serviceClient().rpc("match_chunks_with_source", {
      query_embedding: vector,
      match_count: 6,
      filter_project: projectId,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      document_title: string | null;
      source_ref: string | null;
      heading: string | null;
      content: string;
      similarity: number;
      confidence: number | null;
    }[];
    if (rows.length === 0) {
      return {
        probe: "docs",
        hit: false,
        score: 0,
        summary: "No documentation covers this.",
        evidence: [],
        latencyMs: Date.now() - started,
      };
    }
    // Rank by what the passage says as well as how near it sits, and read the best one when the
    // score alone cannot decide. A passage we parsed badly should not ground a confident answer.
    const ranked = rows
      .map((row) => {
        const damping = row.confidence === null ? 1 : 0.6 + 0.4 * row.confidence;
        const overlap = overlapOf(question, `${row.document_title ?? ""} ${row.heading ?? ""} ${row.content}`);
        return { row, score: docsScore(row.similarity, overlap) * damping };
      })
      .sort((a, b) => b.score - a.score);
    const top = ranked[0]!;
    const score = top.score;
    let hit = score >= threshold;
    let read: "sure" | "covers" | "does not cover" = "sure";
    if (!hit && score >= DOCS_SURE_MISS) {
      const covers = await passageCovers(question, top.row.document_title ?? "", top.row.content).catch(() => false);
      hit = covers;
      read = covers ? "covers" : "does not cover";
    }
    const evidence: DocsEvidence[] = ranked.slice(0, 3).map(({ row }) => ({
      documentTitle: row.document_title ?? "",
      url: row.source_ref,
      heading: row.heading,
      snippet: row.content.slice(0, 240),
      similarity: Number(row.similarity.toFixed(3)),
    }));
    const article = top.row.document_title ?? top.row.heading ?? "a passage";
    return {
      probe: "docs",
      hit,
      score,
      summary: hit
        ? read === "sure"
          ? `The documentation covers this: "${article}" (${score.toFixed(2)}).`
          : `The documentation covers this: "${article}" (${score.toFixed(2)}, confirmed by reading it).`
        : read === "does not cover"
          ? `The nearest passage, "${article}" (${score.toFixed(2)}), does not say the product does this.`
          : `Nothing in the documentation covers this (best ${score.toFixed(2)}).`,
      evidence,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      probe: "docs",
      hit: false,
      score: 0,
      summary: `The documentation check could not run: ${(error as Error).message}`,
      evidence: [],
      latencyMs: Date.now() - started,
    };
  }
}

/** A link whose target is documentation rather than product. */
const DOCUMENTATION_LINK = /^(https?:\/\/[^/]+)?\/(help|support|faq|docs|documentation|knowledge|kb|guides?)(\/|$)/i;

/**
 * Interface: does a control on the page in front of the user do this?
 *
 * The question names a capability ("usage export"); a control only counts when
 * its label covers that capability, not merely one of its words. "Usage" in the
 * sidebar is not an export button, and matching it once sent the agent off to
 * invent one.
 */
export function probeInterface(question: string, page: PageContext, feature = ""): ProbeResult {
  const started = Date.now();
  const asked = feature || question;
  const capability = concepts(expand(asked));
  const featureTokens = concepts(asked);
  const scored = page.affordances
    .map((affordance: Affordance) => {
      const label = `${affordance.name} ${affordance.text ?? ""}`;
      const have = concepts(expand(label));
      // How much of the capability the control's own label accounts for.
      let covered = 0;
      for (const token of featureTokens) if (have.has(token)) covered += 1;
      const featureCoverage = featureTokens.size === 0 ? 0 : covered / featureTokens.size;
      // And how much of the label is about the capability, so a long generic
      // label does not win on one shared word.
      let shared = 0;
      for (const token of have) if (capability.has(token)) shared += 1;
      const labelFocus = have.size === 0 ? 0 : shared / have.size;
      // The damping is for a label that shares a word with the capability, not for one that
      // accounts for it: "Find three seats together" says the same thing as "Find seats together"
      // with one word more, and used to score below the line for exactly that.
      let score = coversCapability(asked, affordance.name)
        ? featureCoverage
        : Math.min(featureCoverage, Math.max(labelFocus, 0.5));
      // A link into the help pages is about the capability; it is not the capability.
      if (affordance.role === "link" && affordance.href && DOCUMENTATION_LINK.test(affordance.href)) score *= 0.6;
      return { affordance, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  const hit = best >= coverageNeeded(feature || question);
  return {
    probe: "interface",
    hit,
    score: best,
    summary: hit
      ? `A control on this page does this (${best.toFixed(2)}).`
      : "No control on this page does this.",
    evidence: scored.slice(0, 5).map((entry) => ({
      id: entry.affordance.id,
      name: entry.affordance.name,
      role: entry.affordance.role,
      score: Number(entry.score.toFixed(2)),
    })),
    latencyMs: Date.now() - started,
  };
}

type TreeCache = { at: number; paths: string[] };
const treeCache = new Map<string, TreeCache>();
const SOURCE = /\.(ts|tsx|js|jsx|css|md)$/;

type RepositoryMatch = { path: string; matches: number };

/** The source files of the connected repository that mention the capability, best first. */
async function repositoryMatches(
  projectId: string,
  question: string,
  repoFullName: string,
  branch: string,
): Promise<RepositoryMatch[]> {
  const cached = treeCache.get(repoFullName);
  let paths: string[];
  if (cached && Date.now() - cached.at < 60_000) {
    paths = cached.paths;
  } else {
    const response = await fetch(
      `https://api.github.com/repos/${repoFullName}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          authorization: `Bearer ${await activeGithubToken(projectId)}`,
          accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const body = (await response.json()) as { tree?: { path: string; type: string }[] };
    paths = (body.tree ?? [])
      .filter((entry) => entry.type === "blob" && SOURCE.test(entry.path))
      .map((entry) => entry.path)
      .filter((path) => !path.includes("node_modules"));
    treeCache.set(repoFullName, { at: Date.now(), paths });
  }

  // The same rule as a control's name: a path covers the capability or it is not evidence of it.
  // Every seat question matches `app/trips/[code]/seats/page.tsx` on one word, and six such paths
  // were enough to make "finding seats together" look like something the product already does.
  const wanted = [...concepts(expand(question))];
  if (wanted.length === 0) return [];
  const needed = coverageNeeded(question);
  return paths
    .map((path) => ({
      path,
      score: wanted.filter((token) => path.toLowerCase().includes(token)).length,
    }))
    .filter((entry) => entry.score / wanted.length >= needed)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => ({ path: entry.path, matches: entry.score }));
}

/** One control somewhere on the site whose name says what the question asks for. */
export type CapabilityMatch = {
  key: string;
  name: string;
  role: string;
  route: string;
  pageTitle: string;
  score: number;
  /** How much of the capability this control's own name accounts for, 0 to 1. */
  coverage: number;
};

/** What the capabilities check looked through and what it found. */
export type CapabilityEvidence = {
  graph: { pages: number; controls: number; matches: CapabilityMatch[] };
  repository: { connected: boolean; files: RepositoryMatch[]; error?: string };
};

/**
 * Known product capabilities: is there a control for this anywhere on the site, or code for it in
 * the connected repository?
 *
 * The site graph is what makes an absence proof grounded in the live product rather than in the
 * one page the user happens to be on: the evidence says how many pages and controls were searched.
 * The key stays `repository` for the widget and the console; the user-facing label names the
 * capability.
 */
export async function probeCapabilities(
  projectId: string,
  feature: string,
  graph: SiteGraph,
  repoFullName: string | null,
  branch: string,
  threshold: number = DEFAULT_THRESHOLDS.interfaceThreshold,
): Promise<ProbeResult> {
  const started = Date.now();
  const size = graphSize(graph);
  const matches: CapabilityMatch[] = searchControls(graph, feature, 8).map((match) => ({
    key: match.control.key,
    name: match.control.name,
    role: match.control.role,
    route: match.control.route,
    pageTitle: match.page.title,
    score: Number(match.score.toFixed(2)),
    coverage: Number(match.coverage.toFixed(2)),
  }));
  // The same rule as the interface check, on the control's own name and never on the title of the
  // page it sits on. One shared word ("seat") is not a control for "seats together", however high
  // the page title ranks it.
  const needed = Math.max(threshold, coverageNeeded(feature));
  const covering = matches.find((match) => match.coverage >= needed) ?? null;
  const graphHit = covering !== null;

  const repository: CapabilityEvidence["repository"] = { connected: repoFullName !== null, files: [] };
  if (repoFullName) {
    try {
      repository.files = await repositoryMatches(projectId, feature, repoFullName, branch);
    } catch (error) {
      repository.error = (error as Error).message;
    }
  }
  const repositoryHit = repository.files.length > 0;

  const searched = `searched ${size.pages} ${size.pages === 1 ? "page" : "pages"} and ${size.controls} controls`;
  const summary = covering
    ? `The product has a control for this: "${covering.name}" on ${covering.pageTitle || covering.route} (${searched}).`
    : repositoryHit
      ? `No control for this on the site (${searched}), but the repository has code that mentions it (${repository.files.length} file(s)).`
      : repository.error
        ? `No control for this on the site (${searched}); the repository check could not run: ${repository.error}`
        : repoFullName
          ? `No control for this on the site (${searched}) and nothing in the repository implements it.`
          : `No control for this on the site (${searched}). No repository is connected.`;

  const evidence: CapabilityEvidence = { graph: { ...size, matches }, repository };
  return {
    probe: "repository",
    hit: graphHit || repositoryHit,
    // Only a control the user can be walked to is a score, and only its coverage is that score.
    // Code alone, and a control that does not cover the capability, both stay a hedge.
    score: covering ? covering.coverage : null,
    summary,
    evidence,
    latencyMs: Date.now() - started,
  };
}
