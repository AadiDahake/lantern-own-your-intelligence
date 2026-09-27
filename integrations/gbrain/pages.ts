/**
 * The pages Lantern keeps in a company brain, as GBrain takes them: Markdown with frontmatter.
 *
 * Pure: an article or a gap goes in and a slug with its content comes out. The slug prefix says
 * what kind of page it is (`help/`, `gaps/`), and a check reads only its own prefix: a page about
 * a gap names the feature more plainly than any article does, and read as documentation it would
 * say the product has what it lacks.
 */
export type HelpArticle = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  sections: { heading: string; body: string[] }[];
};

export type KnownGap = {
  slug: string;
  title: string;
  description: string;
  area: string;
  /** What a customer asked, in their words. */
  quote: string;
  rationale: string;
  status: string;
  /** The fixture file the gap comes from. */
  fixture: string;
};

export type BrainPage = { slug: string; title: string; content: string };

export const HELP_PREFIX = "help/";
export const GAP_PREFIX = "gaps/";

/** Frontmatter as YAML. A JSON string is a valid YAML string, so every value is quoted that way. */
function frontmatter(fields: Record<string, string | string[]>): string {
  const lines = Object.entries(fields).map(([key, value]) =>
    Array.isArray(value)
      ? `${key}: [${value.map((item) => JSON.stringify(item)).join(", ")}]`
      : `${key}: ${JSON.stringify(value)}`,
  );
  return `---\n${lines.join("\n")}\n---`;
}

const tagOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function helpPage(article: HelpArticle, product: string): BrainPage {
  const sections = article.sections.map(
    (section) => `## ${section.heading}\n\n${section.body.map((line) => `- ${line}`).join("\n")}`,
  );
  const content = [
    frontmatter({
      title: article.title,
      type: "help-doc",
      tags: ["lantern", tagOf(product), "help-doc", tagOf(article.category)],
      product,
      category: article.category,
      path: `/help/${article.slug}`,
    }),
    `# ${article.title}`,
    `${product} help article, category ${article.category}. ${article.summary}`,
    ...sections,
  ].join("\n\n");
  return { slug: `${HELP_PREFIX}${article.slug}`, title: article.title, content: `${content}\n` };
}

export function gapPage(gap: KnownGap, product: string): BrainPage {
  const title = `Known gap: ${gap.title}`;
  const content = [
    frontmatter({
      title,
      type: "known-gap",
      tags: ["lantern", tagOf(product), "known-gap", tagOf(gap.area)],
      product,
      area: gap.area,
      status: gap.status,
      fixture: gap.fixture,
    }),
    `# ${title}`,
    `${product} does not do this today. ${gap.description}`,
    `## What a customer asked\n\n> ${gap.quote}`,
    `## Why it matters\n\n${gap.rationale}`,
    `## Status\n\n${gap.status}`,
  ].join("\n\n");
  return { slug: `${GAP_PREFIX}${gap.slug}`, title, content: `${content}\n` };
}
