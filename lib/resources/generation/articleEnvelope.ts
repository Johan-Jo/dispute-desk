/**
 * Free-form-body output contract for autopilot (batch) generation.
 *
 * Why this exists: structured outputs (output_config.format) put the whole
 * article — including the long HTML body — inside a JSON object the model had to
 * close. The model routinely ended the body early to close that object, producing
 * truncated, sub-floor articles (the team's own 278439d9 commit: "truncated long
 * bodies — model ended early to close the structured-output JSON"). It also forced
 * the model to JSON-escape every quote inside the HTML, which is what structured
 * outputs was originally adopted to fix.
 *
 * The envelope removes BOTH problems: the article body is plain HTML OUTSIDE any
 * JSON (no escaping, no "close the object" pressure), and only the short metadata
 * is JSON. The body is written LAST so there is nothing after it to rush toward —
 * the model writes to its natural, complete end.
 */

export interface ParsedArticle {
  title: string;
  excerpt: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  body_json: {
    mainHtml: string;
    keyTakeaways: string[];
    faq: { q: string; a: string }[];
    disclaimer: string;
  };
}

/** Appended to the user prompt for batch generation; replaces the JSON OUTPUT FORMAT block. */
export const ENVELOPE_OUTPUT_INSTRUCTION = `OUTPUT FORMAT
Output the article in exactly this envelope — short metadata first as JSON, then the FULL article body last as HTML:

<meta>
{"title":"article title, MAX 60 characters","excerpt":"1-2 sentence summary, max 300 chars","slug":"url-slug-in-article-language-ascii-only-max-80","meta_title":"SEO title, max 60 chars","meta_description":"SEO description, max 160 chars","keyTakeaways":["point 1","point 2","point 3"],"faq":[{"q":"Question?","a":"Answer."}],"disclaimer":"This content is for informational purposes only and does not constitute legal advice."}
</meta>
<article>
THE COMPLETE ARTICLE BODY AS HTML HERE (<h2>, <p>, <ul>, <li>, <blockquote>, etc.)
</article>

Rules:
- Put ONLY the short metadata inside <meta>, as a single valid JSON object. NEVER put the article body or any HTML in the JSON.
- Write the entire article body inside <article>...</article> as plain HTML. It comes LAST, so there is nothing after it — write the article to its natural, complete end. Close every tag. Do not stop mid-sentence.
- Do not wrap the output in markdown code fences.`;

function extractBlock(raw: string, tag: string): string | null {
  const closed = raw.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  if (closed) return closed[1];
  // Open-ended (truncated before the closing tag) — take from the tag to the end.
  const open = raw.match(new RegExp(`<${tag}>\\s*([\\s\\S]*)$`, "i"));
  return open ? open[1] : null;
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Parse the <meta>/<article> envelope. Returns null when the metadata JSON can't
 * be parsed or the body is empty — the caller treats that as a failed locale.
 * Tolerant of a truncated/unclosed <article> (the body repair handles the tail).
 */
export function parseArticleEnvelope(raw: string | null | undefined): ParsedArticle | null {
  if (!raw) return null;

  // The article body must be parsed BEFORE the meta JSON, because the body can
  // contain a literal "</meta>" only if the model misbehaved — guard by taking
  // <article> from its own tag. Meta is always the small leading block.
  const metaRaw = extractBlock(raw, "meta");
  let bodyRaw = extractBlock(raw, "article");

  // Fallback: model emitted meta but the <article> tag is missing — treat
  // everything after </meta> as the body.
  if (metaRaw && !bodyRaw) {
    const afterMeta = raw.split(/<\/meta>/i)[1];
    if (afterMeta && afterMeta.trim()) bodyRaw = afterMeta;
  }

  if (!metaRaw || !bodyRaw || !bodyRaw.trim()) return null;

  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(stripFences(metaRaw)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const title = typeof meta.title === "string" ? meta.title.trim() : "";
  if (!title) return null;

  const faq = Array.isArray(meta.faq)
    ? (meta.faq as unknown[]).filter(
        (f): f is { q: string; a: string } =>
          !!f && typeof (f as { q?: unknown }).q === "string" && typeof (f as { a?: unknown }).a === "string"
      )
    : [];

  return {
    title,
    excerpt: typeof meta.excerpt === "string" ? meta.excerpt : "",
    slug: typeof meta.slug === "string" ? meta.slug : "",
    meta_title: typeof meta.meta_title === "string" ? meta.meta_title : "",
    meta_description: typeof meta.meta_description === "string" ? meta.meta_description : "",
    body_json: {
      mainHtml: bodyRaw.trim(),
      keyTakeaways: Array.isArray(meta.keyTakeaways)
        ? (meta.keyTakeaways as unknown[]).filter((k): k is string => typeof k === "string")
        : [],
      faq,
      disclaimer: typeof meta.disclaimer === "string" ? meta.disclaimer : "",
    },
  };
}
