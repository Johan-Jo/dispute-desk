/**
 * Find any non-English localization whose last_updated_at is significantly
 * older than its sibling en-US row's last_updated_at (same content_item).
 * For each stale row: pull the (current) en-US article, translate via Claude,
 * save to the stale row.
 *
 * This catches:
 *  - Articles where the v4 run crashed mid-translation (en-US updated but
 *    other locales never got their turn)
 *  - Translation failures during the bulk runs (de-DE / sv-SE that retried
 *    twice and gave up)
 *
 * Usage: npx tsx scripts/fix-stale-translations.mts [--dry-run]
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY!;
const dryRun = process.argv.includes("--dry-run");

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

const LOCALE_FULL_NAMES: Record<string, string> = {
  "de-DE": "German",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "pt-BR": "Brazilian Portuguese",
  "sv-SE": "Swedish",
};

const TRANSLATION_SYSTEM_PROMPT = `You translate Shopify chargebacks articles between languages while preserving voice, structure, evidence specifics, and operational accuracy.

Voice: operator-grade, sharp, opinionated. Banned phrases (translate INTO target-language equivalent of operator voice, not corporate-marketing voice): "is crucial", "leveraging", "robust", "comprehensive overview", "in conclusion", "businesses should", "the importance of", "is the backbone of", "plays a vital role", "It's important to note", "key to", "helps streamline", "enhances efficiency", "throughout this process", "various factors", "typically includes".

Preserve: HTML tags, section structure, Shopify product names verbatim, AVS/CVV/3-D Secure terms verbatim. Adapt currency conventions to local idioms.

Locale conventions: de-DE formal Sie | fr-FR formal vous | es-ES neutral professional | pt-BR Brazilian professional | sv-SE Nordic concise.

CRITICAL JSON SAFETY RULE:
NEVER use the ASCII double-quote character (") inside string values — it's the JSON delimiter and breaks parsing. Use Unicode curly quotes for typographic quotes (German „…", English "…", French «…»), or use single quotes ' for inline references like 'Submit response'.

OUTPUT FORMAT:
{
  "title": "string (translated)",
  "excerpt": "string (translated, max 300 chars)",
  "slug": "string (locale-language slug, ASCII, max 80 chars; never English words for non-en-US)",
  "meta_title": "string (translated, max 60 chars)",
  "meta_description": "string (translated, max 160 chars)",
  "body_json": {
    "mainHtml": "string (translated body, preserve HTML)",
    "keyTakeaways": ["translated lines"],
    "faq": [{"q": "translated question", "a": "translated answer"}],
    "disclaimer": "string (translated)"
  }
}

Return ONLY the JSON. No surrounding prose.`;

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
    let j = i + 1;
    while (j < jsonStr.length && (jsonStr[j] === " " || jsonStr[j] === "\t" || jsonStr[j] === "\n" || jsonStr[j] === "\r")) j += 1;
    const next = jsonStr[j];
    if (next === "," || next === "}" || next === "]" || next === ":" || j >= jsonStr.length) {
      out.push(c);
      inString = false;
    } else {
      out.push("\\");
      out.push(c);
    }
  }
  return out.join("");
}

function parseJsonResilient(s: string): unknown | null {
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  try { return JSON.parse(repairJsonStringQuotes(s)); } catch { /* fallthrough */ }
  return null;
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<{ raw: string; tokensUsed: number } | { error: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          temperature: 0.4,
          max_tokens: 8192,
        }),
      });
      if (!res.ok) {
        if (res.status >= 500 || res.status === 429) {
          await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
          continue;
        }
        return { error: `Claude ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      const data = await res.json();
      const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
      const raw = (data.content as Array<{ type: string; text?: string }> | undefined)?.find((b) => b.type === "text")?.text;
      if (!raw) return { error: "Empty Claude response" };
      const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      return { raw: cleaned, tokensUsed };
    } catch (err) {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  return { error: "Claude failed after 3 attempts" };
}

// ── Find stale translation rows ──
console.log("Scanning for stale translations...\n");

const { data: enUsRows, error } = await sb
  .from("content_localizations")
  .select("id, content_item_id, last_updated_at, body_json, title, slug, content_items!inner(workflow_status, primary_pillar)")
  .eq("locale", "en-US")
  .eq("content_items.workflow_status", "published");

if (error) { console.error(error.message); process.exit(1); }

type Stale = { contentItemId: string; locId: string; locale: string; sourceArticle: Record<string, unknown> };
const stales: Stale[] = [];

for (const enUs of enUsRows ?? []) {
  if (!enUs.last_updated_at) continue;
  const enUsTime = new Date(enUs.last_updated_at).getTime();

  const { data: others } = await sb
    .from("content_localizations")
    .select("id, locale, last_updated_at, slug")
    .eq("content_item_id", enUs.content_item_id)
    .neq("locale", "en-US");

  for (const o of others ?? []) {
    const otherTime = o.last_updated_at ? new Date(o.last_updated_at).getTime() : 0;
    if (enUsTime - otherTime > STALE_THRESHOLD_MS) {
      stales.push({
        contentItemId: enUs.content_item_id,
        locId: o.id,
        locale: o.locale,
        sourceArticle: {
          title: enUs.title,
          slug: enUs.slug,
          body_json: enUs.body_json,
        },
      });
    }
  }
}

console.log(`Found ${stales.length} stale translation rows:\n`);
const byLocale: Record<string, number> = {};
for (const s of stales) byLocale[s.locale] = (byLocale[s.locale] ?? 0) + 1;
for (const [loc, count] of Object.entries(byLocale)) console.log(`  ${loc}: ${count}`);

if (dryRun || stales.length === 0) {
  console.log(`\n${dryRun ? "DRY RUN — no changes made" : "Nothing to fix"}`);
  process.exit(0);
}

console.log(`\nFixing ${stales.length} stale translations...\n`);

let succeeded = 0;
let failed = 0;
let totalTokens = 0;

for (const stale of stales) {
  const targetLang = LOCALE_FULL_NAMES[stale.locale] ?? stale.locale;
  const userPrompt = `Translate the article below from English to ${targetLang} (locale ${stale.locale}). Preserve voice, structure, HTML.

ENGLISH ARTICLE:
${JSON.stringify(stale.sourceArticle, null, 2)}

Return ONLY the translated JSON.`;

  const tr = await callClaude(TRANSLATION_SYSTEM_PROMPT, userPrompt);
  if ("error" in tr) {
    console.log(`  ✗ ${stale.locale} ${stale.locId.slice(0, 8)}: ${tr.error}`);
    failed++;
    continue;
  }
  totalTokens += tr.tokensUsed;
  const parsed = parseJsonResilient(tr.raw) as { title?: string; excerpt?: string; meta_title?: string; meta_description?: string; body_json?: unknown } | null;
  if (!parsed) {
    console.log(`  ✗ ${stale.locale} ${stale.locId.slice(0, 8)}: non-JSON`);
    failed++;
    continue;
  }
  const { error: updErr } = await sb
    .from("content_localizations")
    .update({
      title: parsed.title,
      excerpt: parsed.excerpt,
      meta_title: parsed.meta_title,
      meta_description: parsed.meta_description,
      body_json: parsed.body_json,
      last_updated_at: new Date().toISOString(),
    })
    .eq("id", stale.locId);
  if (updErr) {
    console.log(`  ✗ ${stale.locale} ${stale.locId.slice(0, 8)}: DB ${updErr.message}`);
    failed++;
    continue;
  }
  succeeded++;
  console.log(`  ✓ ${stale.locale} ${stale.locId.slice(0, 8)} (${tr.tokensUsed} tokens)`);
}

console.log(`\n══ SUMMARY ══`);
console.log(`Succeeded: ${succeeded}/${stales.length}`);
console.log(`Failed:    ${failed}`);
console.log(`Tokens:    ${totalTokens.toLocaleString()}`);
console.log(`Cost est:  $${((totalTokens / 1_000_000) * 9).toFixed(2)}`);
