#!/usr/bin/env -S npx tsx
/**
 * Offline evaluation of the documentation check.
 *
 * Reads a site's help articles the way the importer does, chunks them the way ingestion does,
 * embeds every chunk and every question, and prints the best similarity per question with the
 * article it came from, so the threshold and the chunking can be tuned against a known answer key.
 * Needs OPENAI_API_KEY and a running site; touches no database.
 *
 *   npm run eval:docs -- http://localhost:4150
 */
import { DEFAULT_THRESHOLDS } from "@lantern/shared";
import { DOCS_SURE_MISS, docsScore, overlapOf, passageCovers } from "../apps/web/lib/agent/probes";
import { chunkPages } from "../apps/web/lib/ingest/chunk";
import { helpArticleSource, helpPageUrls } from "../apps/web/lib/ingest/helpcenter";
import { embed } from "../apps/web/lib/openai";

/** Questions with the article that answers them, or none when the product cannot do it. */
const CASES: { question: string; expect: string | null }[] = [
  { question: "Where do I change my seat?", expect: "How do I change my seat?" },
  { question: "how can I pick a different seat for my daughter", expect: "How do I change my seat?" },
  { question: "Where do I add a checked bag?", expect: "Baggage allowance" },
  { question: "how much does an exit row seat cost", expect: "Seat selection fees" },
  { question: "when does online check-in open", expect: "Check-in" },
  { question: "can I get a refund if I cancel today", expect: "Changes and refunds" },
  { question: "can my 9 year old sit in an exit row", expect: "Traveling with children" },
  { question: "I'm traveling with my two kids. Can you find us three seats together?", expect: null },
  { question: "seats together", expect: null },
  { question: "Can you seat my family together automatically?", expect: null },
  { question: "how do I change to a dark theme", expect: null },
  { question: "where do I download my invoice", expect: null },
];

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const combinedScore = docsScore;

async function main(): Promise<void> {
  const siteUrl = process.argv[2] ?? process.env.LANTERN_SITE_URL ?? "http://localhost:4150";
  const urls = await helpPageUrls("", siteUrl).catch(() => [] as string[]);
  const articleUrls = urls.length ? urls : await fromIndex(siteUrl);
  const chunks: { article: string; heading: string | null; content: string }[] = [];
  for (const url of articleUrls) {
    const source = await helpArticleSource(url);
    for (const chunk of chunkPages(source.pages)) {
      chunks.push({ article: source.title, heading: chunk.heading, content: chunk.content });
    }
  }
  console.log(`${articleUrls.length} articles, ${chunks.length} chunks`);

  const vectors = await embed(chunks.map((chunk) => `${chunk.article}\n${chunk.content}`));
  const questions = await embed(CASES.map((entry) => entry.question));

  type Row = { question: string; expect: string | null; similarity: number; overlap: number; score: number; article: string; heading: string | null; content: string; verdict?: string };
  const rows: Row[] = [];
  for (const [index, entry] of CASES.entries()) {
    let best: Row | null = null;
    for (const [candidate, vector] of vectors.entries()) {
      const chunk = chunks[candidate]!;
      const similarity = cosine(questions[index] as number[], vector);
      const overlap = overlapOf(entry.question, `${chunk.article} ${chunk.heading ?? ""} ${chunk.content}`);
      const score = combinedScore(similarity, overlap);
      if (!best || score > best.score) {
        best = { question: entry.question, expect: entry.expect, similarity, overlap, score, article: chunk.article, heading: chunk.heading, content: chunk.content };
      }
    }
    rows.push(best as Row);
  }

  // The check as it runs: a sure hit, a sure miss, or a reading of the passage in between.
  const sureHit = DEFAULT_THRESHOLDS.docsThreshold;
  let wrongVerdicts = 0;
  console.log(`mark    sim   ovl   score  verdict         question -> passage   (sure hit >= ${sureHit}, sure miss < ${DOCS_SURE_MISS})`);
  for (const row of rows) {
    const mark = row.expect === null ? "absent " : row.article === row.expect ? "right  " : "WRONG  ";
    let verdict: string;
    if (row.score >= sureHit) verdict = "hit";
    else if (row.score < DOCS_SURE_MISS) verdict = "miss";
    else verdict = (await passageCovers(row.question, row.article, row.content)) ? "hit (read)" : "miss (read)";
    const shouldHit = row.expect !== null;
    const ok = verdict.startsWith("hit") === shouldHit;
    if (!ok) wrongVerdicts += 1;
    console.log(
      `${mark} ${row.similarity.toFixed(3)} ${row.overlap.toFixed(2)}  ${row.score.toFixed(3)}  ${(verdict + (ok ? "" : " !")).padEnd(15)} ${row.question.padEnd(70)} -> ${row.article} / ${row.heading ?? ""}`,
    );
  }
  console.log(`${wrongVerdicts} wrong verdict(s) out of ${rows.length}`);

  // The widest gap between the weakest right answer and the strongest absent case.
  const positives = rows.filter((row) => row.expect !== null && row.article === row.expect).map((row) => row.score);
  const negatives = rows.filter((row) => row.expect === null).map((row) => row.score);
  const wrong = rows.filter((row) => row.expect !== null && row.article !== row.expect).length;
  const lowestRight = Math.min(...positives);
  const highestAbsent = Math.max(...negatives);
  console.log(`\n${wrong} wrong article(s); lowest right score ${lowestRight.toFixed(3)}, highest absent score ${highestAbsent.toFixed(3)}`);
  console.log(
    lowestRight > highestAbsent
      ? `a threshold anywhere in (${highestAbsent.toFixed(3)}, ${lowestRight.toFixed(3)}) separates them; midpoint ${((lowestRight + highestAbsent) / 2).toFixed(3)}`
      : "no single threshold separates them",
  );
}

/** Article links from the help index, for a site with no graph yet. */
async function fromIndex(siteUrl: string): Promise<string[]> {
  const { fetchPage } = await import("../apps/web/lib/ingest/crawl");
  const { sameOriginLinks } = await import("../apps/web/lib/ingest/html");
  const index = new URL("/help", siteUrl).toString();
  const html = await fetchPage(index);
  return sameOriginLinks(html, index, index).filter((url) => url !== index && !url.endsWith("/help"));
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
