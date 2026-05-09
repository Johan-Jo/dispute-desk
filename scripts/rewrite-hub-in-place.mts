/**
 * Rewrites every published hub article in-place. PRESERVES existing URLs:
 *   - same content_items.id
 *   - same content_localizations.id (per locale)
 *   - same slug per locale
 *   - workflow_status remains 'published'
 *   - last_updated_at is bumped
 *
 * For each article:
 *   1. Build a brief from the existing title + topic + small slice of body
 *   2. Pass 1 (gpt-4o) → source material
 *   3. Pass 2 (Claude Sonnet 4.6, merchant-decision prompt) → en-US article
 *   4. Write en-US article to the existing en-US localization row
 *   5. For each OTHER existing locale: translate the new en-US article via
 *      Claude, preserving voice + Shopify-specifics + structure. Write to
 *      existing row.
 *
 * Idempotent: re-running re-overwrites with fresh generation.
 *
 * Usage:
 *   npx tsx scripts/rewrite-hub-in-place.mts                    # all articles
 *   npx tsx scripts/rewrite-hub-in-place.mts --slug=<slug>      # single article
 *   npx tsx scripts/rewrite-hub-in-place.mts --limit=5          # first 5 only (for testing)
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { generatePassOne } from "@/lib/resources/generation/generate";
import {
  PASS_TWO_SYSTEM_PROMPT,
  buildPassTwoUserPrompt,
  type PassOneSourceMaterial,
  type TwoPassBriefContext,
} from "@/lib/resources/generation/twoPassPrompts";
import {
  DEFAULT_LOCALE_INSTRUCTIONS,
} from "@/lib/resources/generation/prompts";
import type { GenerationBrief } from "@/lib/resources/generation/prompts";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

// CLI args
const args = process.argv.slice(2);
const slugArg = args.find((a) => a.startsWith("--slug="))?.slice(7);
const limitArg = args.find((a) => a.startsWith("--limit="))?.slice(8);
const limit = limitArg ? parseInt(limitArg, 10) : null;
const skipRecent = args.includes("--skip-recent");
const SKIP_RECENT_HOURS = 24;

/**
 * Translation prompt uses a DELIMITED text format instead of JSON. German /
 * Swedish output regularly mixes Unicode curly quotes with ASCII closing
 * quotes inside string values — both standard JSON.parse and the heuristic
 * quote-repair fallback fail on that pattern (proven in fix-stale-translations
 * runs: 9/24 then 2/15 success with JSON, 13/13 with delimited).
 *
 * Pass 2 en-US assembly stays on JSON — English doesn't have the quote
 * ambiguity and JSON's structure is friendlier to programmatic validation.
 */
const TRANSLATION_SYSTEM_PROMPT = `You translate Shopify chargebacks articles between languages. Output a structured TEXT format (NOT JSON) so quote characters in the translated content do not break parsing.

Voice: operator-grade, sharp, opinionated. The same banned phrases that apply to English (corporate AI fluff, "is crucial", "leveraging", "robust", "comprehensive overview", "in conclusion", "the importance of", "is the backbone of", "plays a vital role", "throughout this process", "various factors", "typically includes") apply in every language — translate INTO target-language operator voice, not corporate marketing voice.

Preserve:
- All HTML tags (<h2>, <p>, <strong>, etc.) exactly
- Section structure and heading order
- Specific Shopify references (Settings → Payments → Manage stays in the local language equivalent if natural; product names like Shopify, Shopify Payments, Shopify Protect stay verbatim)
- Evidence specifics (AVS, CVV, 3-D Secure stay verbatim — international payment terms)
- Currency conventions: convert dollar amounts to local currency where idiomatic (e.g. €300 for German), magnitudes proportional
- Decision rules and operational stakes — every operationally-weighted paragraph in English must carry equivalent weight in translation

Locale conventions:
- de-DE: formal Sie-form
- fr-FR: formal vous-form
- es-ES: neutral professional Spanish (Latin American context welcome but stay professional)
- pt-BR: Brazilian Portuguese, professional tone
- sv-SE: semi-formal Nordic concise style

OUTPUT FORMAT — return EXACTLY this delimited structure with these markers (no other prose, no JSON, no code fences):

<<<TITLE>>>
[translated title]
<<<END>>>
<<<EXCERPT>>>
[translated excerpt, max 300 chars]
<<<END>>>
<<<SLUG>>>
[locale-language slug, ASCII, max 80 chars; never English words for non-en-US]
<<<END>>>
<<<META_TITLE>>>
[translated meta title, max 60 chars]
<<<END>>>
<<<META_DESCRIPTION>>>
[translated meta description, max 160 chars]
<<<END>>>
<<<MAIN_HTML>>>
[translated body HTML, preserve all tags, can use any quote characters freely]
<<<END>>>
<<<KEY_TAKEAWAY>>>
[one takeaway line]
<<<END>>>
<<<KEY_TAKEAWAY>>>
[another takeaway]
<<<END>>>
[... 3-5 KEY_TAKEAWAY blocks total ...]
<<<FAQ_Q>>>
[question text]
<<<END>>>
<<<FAQ_A>>>
[answer text, 2-4 sentences]
<<<END>>>
[... pair Q+A blocks 3-5 times ...]
<<<DISCLAIMER>>>
[translated disclaimer]
<<<END>>>

The marker syntax (<<<NAME>>> ... <<<END>>>) NEVER changes. Quote characters inside content are SAFE — use natural typographic quotes for the locale (German „…", French «…», Spanish «…» or "…"). No JSON escaping required.

Return ONLY this delimited output.`;

interface ParsedTranslation {
  title: string;
  excerpt: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  body_json: {
    mainHtml: string;
    keyTakeaways: string[];
    faq: Array<{ q: string; a: string }>;
    disclaimer: string;
  };
}

/**
 * Parse the <<<TAG>>> ... <<<END>>> block format. Returns null if the
 * required fields (TITLE + MAIN_HTML) are missing.
 */
function parseDelimitedTranslation(text: string): ParsedTranslation | null {
  const blocks: Array<{ tag: string; content: string }> = [];
  const re = /<<<([A-Z_]+)>>>\s*([\s\S]*?)\s*<<<END>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ tag: m[1], content: m[2].trim() });
  }
  if (blocks.length === 0) return null;

  const single = (tag: string) => blocks.find((b) => b.tag === tag)?.content ?? "";
  const all = (tag: string) => blocks.filter((b) => b.tag === tag).map((b) => b.content);

  // Pair FAQ_Q / FAQ_A in document order.
  const faq: Array<{ q: string; a: string }> = [];
  let pendingQ: string | null = null;
  for (const b of blocks) {
    if (b.tag === "FAQ_Q") pendingQ = b.content;
    else if (b.tag === "FAQ_A" && pendingQ) {
      faq.push({ q: pendingQ, a: b.content });
      pendingQ = null;
    }
  }

  const title = single("TITLE");
  const mainHtml = single("MAIN_HTML");
  if (!title || !mainHtml) return null;

  return {
    title,
    excerpt: single("EXCERPT"),
    slug: single("SLUG"),
    meta_title: single("META_TITLE"),
    meta_description: single("META_DESCRIPTION"),
    body_json: {
      mainHtml,
      keyTakeaways: all("KEY_TAKEAWAY"),
      faq,
      disclaimer: single("DISCLAIMER"),
    },
  };
}

const LOCALE_FULL_NAMES: Record<string, string> = {
  "de-DE": "German",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "pt-BR": "Brazilian Portuguese",
  "sv-SE": "Swedish",
};

function buildTwoPassContextFromArticle(article: {
  title: string;
  slug: string;
  primary_pillar: string;
  topic: string | null;
  target_keyword: string | null;
  bodyText: string;
}): TwoPassBriefContext {
  const audienceByPillar: Record<string, string> = {
    chargebacks: "Shopify merchants handling Shopify Payments disputes",
    evidence: "Shopify merchants assembling representment evidence",
    fraud: "Shopify merchants seeing fraud-coded chargebacks",
    "dispute-resolution": "Shopify merchants navigating dispute resolution",
    "mediation-arbitration": "Shopify merchants considering mediation/arbitration",
    "dispute-management-software": "Shopify merchants evaluating dispute tools",
  };

  const notesObj = {
    audience: audienceByPillar[article.primary_pillar] ?? "Shopify merchants",
    shopify_specifics: [
      "Disputes section in Shopify Admin (Settings → Payments → Manage)",
      "Shopify Payments dispute timelines and response window",
      "Shopify Protect coverage statuses (PROTECTED / ACTIVE / NONE)",
      "AVS / CVV result codes shown on the Order's payment summary",
    ],
    must_cover: [
      "What the merchant should check in Shopify Admin",
      "What evidence actually changes the outcome (and what doesn't)",
      "When the case is weak even if evidence looks good",
      "What the merchant should DO before submitting",
    ],
  };

  return {
    topic:
      article.target_keyword ||
      article.topic ||
      article.title.replace(/[^\w\s]/g, "").slice(0, 80),
    targetKeyword: article.target_keyword,
    contextSummary: `Existing article rewrite: "${article.title}". Original body excerpt: ${article.bodyText.slice(0, 400)}`,
    notes: JSON.stringify(notesObj, null, 2),
    locale: "en-US",
    localeInstruction: DEFAULT_LOCALE_INSTRUCTIONS["en-US"],
  };
}

function htmlToText(html: string): string {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function wordCount(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

/**
 * Repair JSON where the model produced unescaped ASCII quotes inside string
 * values. Heuristic: walk char-by-char tracking string state. When inside a
 * string, an unescaped " followed by non-delimiter content is treated as
 * content (escape it). Followed by JSON-delimiter ( , } ] : whitespace+) it's
 * treated as end-of-string.
 *
 * Handles the common Claude-German pattern: "Word"more text" → "Word\"more text"
 */
function repairJsonStringQuotes(jsonStr: string): string {
  const out: string[] = [];
  let inString = false;
  let lastWasBackslash = false;
  for (let i = 0; i < jsonStr.length; i += 1) {
    const c = jsonStr[i];
    if (!inString) {
      out.push(c);
      if (c === '"') { inString = true; lastWasBackslash = false; }
      continue;
    }
    if (lastWasBackslash) { out.push(c); lastWasBackslash = false; continue; }
    if (c === "\\") { out.push(c); lastWasBackslash = true; continue; }
    if (c !== '"') { out.push(c); continue; }
    // c === " inside a string — peek ahead to decide end-of-string vs needs-escape.
    let j = i + 1;
    while (j < jsonStr.length && (jsonStr[j] === " " || jsonStr[j] === "\t" || jsonStr[j] === "\n" || jsonStr[j] === "\r")) j += 1;
    const next = jsonStr[j];
    // End of value: , } ] : end-of-string
    if (next === "," || next === "}" || next === "]" || next === ":" || j >= jsonStr.length) {
      out.push(c);
      inString = false;
    } else {
      // Unescaped quote inside content — escape it
      out.push("\\");
      out.push(c);
    }
  }
  return out.join("");
}

/** Extract the outermost balanced-brace JSON object from a string that may
 *  contain surrounding prose. Returns the original string if no balanced
 *  object is found. Used as a pre-pass before JSON.parse on Pass 2 (en-US)
 *  responses where Claude occasionally wraps the JSON in explanatory prose. */
function extractJsonObject(s: string): string {
  if (s.startsWith("{")) return s;
  const firstBrace = s.indexOf("{");
  if (firstBrace < 0) return s;
  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < s.length; i += 1) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  return endIdx > firstBrace ? s.slice(firstBrace, endIdx + 1) : s;
}

/** Try standard JSON.parse, brace-extract + parse, then repair-and-retry. */
function parseJsonResilient(s: string): unknown | null {
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  const extracted = extractJsonObject(s);
  if (extracted !== s) {
    try { return JSON.parse(extracted); } catch { /* fallthrough */ }
  }
  try { return JSON.parse(repairJsonStringQuotes(extracted)); } catch { /* fallthrough */ }
  return null;
}

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.4
): Promise<{ raw: string; tokensUsed: number } | { error: string }> {
  // Wrap fetch in retry loop — Anthropic API can ECONNRESET on long-running batches.
  // 3 attempts with exponential backoff (2s, 4s, 8s).
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          temperature,
          max_tokens: 8192,
        }),
      });
      if (!res.ok) {
        const errText = (await res.text()).slice(0, 300);
        // 5xx and 429 are retryable; 4xx (except 429) are not.
        if (res.status >= 500 || res.status === 429) {
          lastError = `Claude API ${res.status}: ${errText}`;
          await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
          continue;
        }
        return { error: `Claude API error ${res.status}: ${errText}` };
      }
      const data = await res.json();
      const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
      const block = (data.content as Array<{ type: string; text?: string }> | undefined)?.find((b) => b.type === "text");
      const raw = block?.text;
      if (!raw) return { error: "Empty Claude response" };
      return processClaudeRaw(raw, tokensUsed);
    } catch (err: unknown) {
      // Network error (ECONNRESET, ETIMEDOUT, etc.) — retry
      const msg = err instanceof Error ? err.message : String(err);
      lastError = `Network: ${msg}`;
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  return { error: lastError || "Claude call failed after 3 attempts" };
}

function processClaudeRaw(raw: string, tokensUsed: number): { raw: string; tokensUsed: number } {
  // Strip code fences. Do NOT auto-extract a JSON object — translations now
  // use a delimited format (<<<TAG>>>...<<<END>>>) which has no braces, and
  // brace-extraction would corrupt that. Each caller is responsible for its
  // own parsing strategy (JSON for Pass 2 en-US, delimited for translations).
  return {
    raw: raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim(),
    tokensUsed,
  };
}

// ── 1. Pull articles to rewrite ──────────────────────────────────────
let q = sb
  .from("content_localizations")
  .select(
    "id, content_item_id, locale, slug, title, body_json, last_updated_at, content_items!inner(id, primary_pillar, content_type, workflow_status, topic, target_keyword)"
  )
  .eq("locale", "en-US")
  .eq("content_items.workflow_status", "published");

if (slugArg) q = q.eq("slug", slugArg);

const { data: locs, error } = await q;
if (error) {
  console.error(error.message);
  process.exit(1);
}

let articles = (locs ?? []).map((l) => {
  const item = Array.isArray(l.content_items) ? l.content_items[0] : l.content_items;
  return {
    locId: l.id,
    contentItemId: l.content_item_id,
    slug: l.slug,
    title: l.title,
    bodyText: htmlToText(((l.body_json as Record<string, unknown>)?.mainHtml as string) ?? ""),
    primary_pillar: item?.primary_pillar ?? "chargebacks",
    content_type: item?.content_type ?? "cluster_article",
    topic: item?.topic ?? null,
    target_keyword: item?.target_keyword ?? null,
    last_updated_at: l.last_updated_at as string | null,
  };
});

// Skip articles whose en-US row was updated within SKIP_RECENT_HOURS hours
// (avoids re-processing yesterday's successful runs after a credit failure).
if (skipRecent) {
  const cutoff = Date.now() - SKIP_RECENT_HOURS * 60 * 60 * 1000;
  const before = articles.length;
  articles = articles.filter((a) => {
    if (!a.last_updated_at) return true;
    return new Date(a.last_updated_at).getTime() < cutoff;
  });
  console.log(`Skip-recent: dropped ${before - articles.length} articles updated in last ${SKIP_RECENT_HOURS}h`);
}

if (limit) articles = articles.slice(0, limit);

console.log(`══ Hub rewrite-in-place ══`);
console.log(`Articles to process: ${articles.length}\n`);

let totalTokens = 0;
let totalCostUsd = 0;
let succeeded = 0;
let failed = 0;
const failures: Array<{ slug: string; locale: string; reason: string }> = [];

for (const article of articles) {
  console.log(`\n── ${article.slug} (${article.contentItemId}) ──`);

  // Step 1: Pass 1 — source material
  const briefForPassOne: GenerationBrief = {
    archiveItemId: article.contentItemId,
    proposedTitle: article.title,
    contentType: article.content_type,
    pageRole: null,
    primaryPillar: article.primary_pillar,
    targetKeyword: article.target_keyword,
    searchIntent: "informational",
    complexity: "high",
    targetWordRange: null,
    tier: "A",
    archetype: "authority_pillar",
    isHubArticle: false,
    summary: article.bodyText.slice(0, 400),
    notes: null,
    targetLocales: ["en-US"],
  };
  const p1 = await generatePassOne(briefForPassOne, "en-US");
  if (!p1.material) {
    console.log(`  ✗ Pass 1 failed: ${p1.error}`);
    failed++;
    failures.push({ slug: article.slug, locale: "en-US", reason: `Pass 1: ${p1.error}` });
    continue;
  }
  totalTokens += p1.tokensUsed;
  totalCostUsd += (p1.tokensUsed / 1_000_000) * 5; // rough gpt-4o blended estimate
  console.log(`  Pass 1 done (${p1.tokensUsed} tokens)`);

  // Step 2: Pass 2 — assembly via Claude
  const passTwoCtx = buildTwoPassContextFromArticle(article);
  const passTwoUserPrompt = buildPassTwoUserPrompt(passTwoCtx, p1.material as PassOneSourceMaterial);
  const p2 = await callClaude(PASS_TWO_SYSTEM_PROMPT, passTwoUserPrompt);
  if ("error" in p2) {
    console.log(`  ✗ Pass 2 failed: ${p2.error}`);
    failed++;
    failures.push({ slug: article.slug, locale: "en-US", reason: `Pass 2: ${p2.error}` });
    continue;
  }
  totalTokens += p2.tokensUsed;
  totalCostUsd += (p2.tokensUsed / 1_000_000) * 9; // rough Sonnet 4.6 blended estimate

  let parsedEnUs;
  try {
    parsedEnUs = parseJsonResilient(p2.raw);
    if (!parsedEnUs) throw new Error("non-JSON");
  } catch {
    console.log(`  ✗ Pass 2 returned non-JSON`);
    failed++;
    failures.push({ slug: article.slug, locale: "en-US", reason: "Pass 2 non-JSON" });
    continue;
  }
  const newWords = wordCount(htmlToText(parsedEnUs.body_json?.mainHtml ?? ""));
  console.log(`  Pass 2 done (${p2.tokensUsed} tokens, ${newWords}w en-US)`);

  // Step 3: Save en-US to existing row (preserve slug)
  const { error: enUsErr } = await sb
    .from("content_localizations")
    .update({
      title: parsedEnUs.title ?? article.title,
      // KEEP existing slug — user wants URL preservation
      excerpt: parsedEnUs.excerpt,
      meta_title: parsedEnUs.meta_title,
      meta_description: parsedEnUs.meta_description,
      body_json: parsedEnUs.body_json,
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", article.locId);
  if (enUsErr) {
    console.log(`  ✗ DB write failed (en-US): ${enUsErr.message}`);
    failed++;
    failures.push({ slug: article.slug, locale: "en-US", reason: `DB: ${enUsErr.message}` });
    continue;
  }
  console.log(`  ✓ en-US saved`);

  // Step 4: Translate to ALL 5 non-English locales — UPSERT pattern
  // (UPDATE if locale row already exists, INSERT if missing).
  const { data: existingOther } = await sb
    .from("content_localizations")
    .select("id, locale, slug, route_kind")
    .eq("content_item_id", article.contentItemId)
    .neq("locale", "en-US");

  const existingByLocale = new Map<string, { id: string; slug: string; route_kind: string }>();
  for (const o of existingOther ?? []) {
    existingByLocale.set(o.locale, { id: o.id, slug: o.slug, route_kind: o.route_kind });
  }

  // Read the en-US row so we can copy route_kind for any missing locales we INSERT.
  const { data: enUsRow } = await sb
    .from("content_localizations")
    .select("route_kind")
    .eq("id", article.locId)
    .maybeSingle();
  const routeKind = enUsRow?.route_kind ?? "resources";

  const TARGET_TRANSLATIONS = ["de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

  for (const targetLocale of TARGET_TRANSLATIONS) {
    const targetLang = LOCALE_FULL_NAMES[targetLocale];
    const translateUserPrompt = `Translate the article below from English to ${targetLang} (locale ${targetLocale}). Use the delimited TEXT format from your system prompt. Preserve voice, structure, HTML, evidence specifics. Adapt currency/conventions where idiomatic.

ENGLISH ARTICLE (as JSON for INPUT only — your OUTPUT must use the delimited <<<TAG>>>...<<<END>>> format, not JSON):
${JSON.stringify(parsedEnUs, null, 2)}`;

    let tr = await callClaude(TRANSLATION_SYSTEM_PROMPT, translateUserPrompt);
    let parsedTrans: ParsedTranslation | null = null;
    if (!("error" in tr)) {
      parsedTrans = parseDelimitedTranslation(tr.raw);
    }
    // Retry once on either API error or parse failure.
    if (!parsedTrans) {
      const reason1 = "error" in tr ? tr.error : "delimited parse failed";
      console.log(`  … ${targetLocale} attempt 1 failed (${reason1}); retrying…`);
      tr = await callClaude(TRANSLATION_SYSTEM_PROMPT, translateUserPrompt);
      if (!("error" in tr)) {
        parsedTrans = parseDelimitedTranslation(tr.raw);
      }
    }
    if (!parsedTrans) {
      console.log(`  ✗ ${targetLocale} translate failed (after retry)`);
      failures.push({ slug: article.slug, locale: targetLocale, reason: "Translate failed after retry" });
      continue;
    }
    if (!("error" in tr)) {
      totalTokens += tr.tokensUsed;
      totalCostUsd += (tr.tokensUsed / 1_000_000) * 9;
    }

    const trWords = wordCount(htmlToText(parsedTrans.body_json?.mainHtml ?? ""));

    const existingRow = existingByLocale.get(targetLocale);
    if (existingRow) {
      // UPDATE existing row, KEEP its slug (URL preservation per user).
      const { error: trErr } = await sb
        .from("content_localizations")
        .update({
          title: parsedTrans.title,
          excerpt: parsedTrans.excerpt,
          meta_title: parsedTrans.meta_title,
          meta_description: parsedTrans.meta_description,
          body_json: parsedTrans.body_json,
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", existingRow.id);
      if (trErr) {
        console.log(`  ✗ ${targetLocale} DB update failed: ${trErr.message}`);
        failures.push({ slug: article.slug, locale: targetLocale, reason: `DB: ${trErr.message}` });
        continue;
      }
      console.log(`  ✓ ${targetLocale} updated (${trWords}w)`);
    } else {
      // INSERT new locale row. Use the model's slug (locale-language).
      const { error: insErr } = await sb
        .from("content_localizations")
        .insert({
          content_item_id: article.contentItemId,
          locale: targetLocale,
          route_kind: routeKind,
          title: parsedTrans.title,
          slug: parsedTrans.slug,
          excerpt: parsedTrans.excerpt,
          body_json: parsedTrans.body_json,
          meta_title: parsedTrans.meta_title,
          meta_description: parsedTrans.meta_description,
          translation_status: "complete",
          is_published: true,
        });
      if (insErr) {
        console.log(`  ✗ ${targetLocale} DB insert failed: ${insErr.message}`);
        failures.push({ slug: article.slug, locale: targetLocale, reason: `DB insert: ${insErr.message}` });
        continue;
      }
      console.log(`  + ${targetLocale} inserted (${trWords}w, slug: ${parsedTrans.slug})`);
    }
  }

  succeeded++;
  console.log(`  Running totals: succeeded ${succeeded}, failed ${failed}, tokens ${totalTokens}, est cost $${totalCostUsd.toFixed(2)}`);
}

console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(`SUMMARY`);
console.log(`══════════════════════════════════════════════════════════════════`);
console.log(`Succeeded: ${succeeded}/${articles.length} articles`);
console.log(`Failed:    ${failed} (${failures.length} locale-level failures)`);
console.log(`Total tokens: ${totalTokens.toLocaleString()}`);
console.log(`Estimated cost: $${totalCostUsd.toFixed(2)}`);
if (failures.length > 0) {
  console.log(`\nFAILURES:`);
  failures.forEach((f) => console.log(`  - ${f.slug} [${f.locale}]: ${f.reason}`));
}
