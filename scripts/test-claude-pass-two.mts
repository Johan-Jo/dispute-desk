/**
 * Path C test — runs Pass 1 (OpenAI) then Pass 2 (Claude Sonnet 4.6) for ONE pillar.
 *
 * Bypasses the autopilot/Vercel route entirely so the test runs against the
 * caller's local .env.local. Saves the resulting article + diagnostic info to
 * stdout; does NOT persist to DB. Pure read-only test.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-claude-pass-two.mts <slug>
 *
 * Required env:
 *   OPENAI_API_KEY
 *   ANTHROPIC_API_KEY (or CLAUDE_API_KEY)
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   GENERATION_MODEL_PASS_TWO   default claude-sonnet-4-6 (try claude-opus-4-7 too)
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

const slug = process.argv[2] || "shopify-chargebacks-complete-merchant-guide";
const locale = "en-US";

const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in .env.local");
  process.exit(1);
}
const model = process.env.GENERATION_MODEL_PASS_TWO ?? "claude-sonnet-4-6";

const { data: row, error } = await sb
  .from("content_archive_items")
  .select("*")
  .eq("proposed_slug", slug)
  .maybeSingle();

if (error || !row) {
  console.error(`Archive item ${slug} not found: ${error?.message ?? "no row"}`);
  process.exit(1);
}

const brief: GenerationBrief = {
  archiveItemId: row.id,
  proposedTitle: row.proposed_title,
  contentType: row.content_type,
  pageRole: row.page_role,
  primaryPillar: row.primary_pillar,
  targetKeyword: row.target_keyword,
  searchIntent: row.search_intent,
  complexity: row.complexity,
  targetWordRange: row.target_word_range,
  tier: row.tier_override,
  archetype: row.archetype,
  isHubArticle: row.is_hub_article,
  summary: row.summary,
  notes: row.notes,
  targetLocales: row.target_locale_set,
};

console.log(`══ Path C test: ${slug} ══`);
console.log(`Model (Pass 2): ${model}`);
console.log(`Locale: ${locale}\n`);

// PASS 1 — OpenAI (existing, working)
console.log("Running Pass 1 (OpenAI gpt-4o)...");
const p1 = await generatePassOne(brief, locale);
if (!p1.material) {
  console.error(`Pass 1 failed: ${p1.error}`);
  process.exit(1);
}
console.log(`  Pass 1 done — tokens: ${p1.tokensUsed}`);

const sourceMaterial = p1.material;

// PASS 2 — direct Claude call
function filterNotes(notes: string | null): string | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>;
    const noisy = new Set([
      "brief_version", "cluster", "page_role", "complexity",
      "target_word_range", "page_title", "seo_title", "cta_type",
    ]);
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!noisy.has(k)) filtered[k] = v;
    }
    return JSON.stringify(filtered, null, 2);
  } catch {
    return notes;
  }
}

const ctx: TwoPassBriefContext = {
  topic: brief.proposedTitle,
  targetKeyword: brief.targetKeyword,
  contextSummary: brief.summary,
  notes: filterNotes(brief.notes),
  locale,
  localeInstruction:
    DEFAULT_LOCALE_INSTRUCTIONS[locale] ?? DEFAULT_LOCALE_INSTRUCTIONS["en-US"],
};

const userPrompt = buildPassTwoUserPrompt(ctx, sourceMaterial as PassOneSourceMaterial);

console.log(`\nRunning Pass 2 (Claude ${model})...`);
const start = Date.now();
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model,
    system: PASS_TWO_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0.4,
    max_tokens: 8192,
  }),
});

if (!res.ok) {
  const errBody = await res.text();
  console.error(`Claude API error ${res.status}: ${errBody.slice(0, 500)}`);
  process.exit(1);
}

const elapsed = Date.now() - start;
const data = await res.json();
const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
const block = (data.content as Array<{ type: string; text?: string }> | undefined)?.find(
  (b) => b.type === "text"
);
const raw = block?.text;
if (!raw) {
  console.error("Empty response from Claude");
  process.exit(1);
}

console.log(`  Pass 2 done — tokens: ${tokensUsed}, latency: ${elapsed}ms`);

const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch {
  console.error("Pass 2 returned non-JSON. First 500 chars of raw response:\n");
  console.log(cleaned.slice(0, 500));
  process.exit(1);
}

// Diagnostics
function htmlToText(html: string): string {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function wordCount(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}
function extractH2s(html: string): string[] {
  const out: string[] = [];
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? "")) !== null) {
    out.push(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  }
  return out;
}
function sectionWordCounts(html: string): number[] {
  const re = /<h2\b[^>]*>[\s\S]*?<\/h2>([\s\S]*?)(?=<h2\b|$)/gi;
  const counts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? "")) !== null) {
    counts.push(wordCount(htmlToText(m[1])));
  }
  return counts;
}

const FORBIDDEN_PHRASES = [
  "it's important to note", "is crucial", "comprehensive overview",
  "in conclusion", "robust", "leveraging", "businesses should",
  "the importance of", "is the backbone of", "plays a vital role",
  "helps streamline", "enhances efficiency", "seamlessly",
];

const html = parsed.body_json?.mainHtml ?? "";
const text = htmlToText(html);
const wc = wordCount(text);
const h2s = extractH2s(html);
const counts = sectionWordCounts(html);
const lower = text.toLowerCase();
const phraseHits = FORBIDDEN_PHRASES.filter((p) => lower.includes(p));

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("PASS 2 RESULT (Claude):");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  Title:           ${parsed.title}`);
console.log(`  Slug:            ${parsed.slug}`);
console.log(`  Words:           ${wc}`);
console.log(`  H2 count:        ${h2s.length}`);
console.log(`  Section words:   [${counts.join(", ")}]`);
console.log(`  FAQ entries:     ${parsed.body_json?.faq?.length ?? 0}`);
console.log(`  AI-phrase hits:  ${phraseHits.length} ${phraseHits.length ? `(${phraseHits.join(", ")})` : ""}`);
console.log(`\n  Section headings:`);
h2s.forEach((h, i) => console.log(`    ${i + 1}. ${h}`));

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("FULL ARTICLE BODY:");
console.log("══════════════════════════════════════════════════════════════════");
console.log(html);
