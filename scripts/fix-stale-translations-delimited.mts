/**
 * Final cleanup pass for stubborn stale translations. Uses a DELIMITED text
 * output format instead of JSON — German articles consistently produce mixed
 * German/ASCII quotes that defeat JSON parsing + heuristic repair.
 *
 * Format: each field surrounded by unique markers.
 *   <<<TITLE>>>...<<<END>>>
 *   <<<EXCERPT>>>...<<<END>>>
 *   etc.
 *
 * Then parsed in JS by splitting on markers — no quote escaping needed.
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
const apiKey = process.env.ANTHROPIC_API_KEY!;

const STALE_THRESHOLD_MS = 30 * 60 * 1000;

const LOCALE_FULL_NAMES: Record<string, string> = {
  "de-DE": "German",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "pt-BR": "Brazilian Portuguese",
  "sv-SE": "Swedish",
};

const TRANSLATION_SYSTEM_PROMPT = `You translate Shopify chargebacks articles between languages. Output a structured TEXT format (NOT JSON) so quote characters in the translated content do not break parsing.

Voice: operator-grade, sharp, opinionated. Banned phrases: "is crucial", "leveraging", "robust", "comprehensive overview", "in conclusion", "the importance of", "is the backbone of", "plays a vital role", "throughout this process", "various factors", "typically includes". Translate INTO target-language operator voice, not corporate marketing.

Preserve: HTML tags, section structure, Shopify product names verbatim, AVS/CVV/3-D Secure terms verbatim. Adapt currency conventions to local idioms.

OUTPUT FORMAT — return EXACTLY this structure with these markers (no other prose):

<<<TITLE>>>
[translated title here]
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

The marker syntax (<<<NAME>>> ... <<<END>>>) NEVER changes. Use language-natural quotes inside the content (German „...", French «...», etc.) — quote characters are safe because we are not using JSON.

Return ONLY this delimited output. No surrounding prose, no JSON, no code fences.`;

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

function parseDelimited(text: string): ParsedTranslation | null {
  const blocks: Array<{ tag: string; content: string }> = [];
  // Match each <<<TAG>>> ... <<<END>>> block.
  const re = /<<<([A-Z_]+)>>>\s*([\s\S]*?)\s*<<<END>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ tag: m[1], content: m[2].trim() });
  }
  if (blocks.length === 0) return null;

  const single = (tag: string) => blocks.find((b) => b.tag === tag)?.content ?? "";
  const all = (tag: string) => blocks.filter((b) => b.tag === tag).map((b) => b.content);

  // Pair FAQ_Q with FAQ_A in order.
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
      return { raw, tokensUsed };
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  return { error: "Claude failed after 3 attempts" };
}

// ── Find stale ──
const { data: enUsRows, error } = await sb
  .from("content_localizations")
  .select("id, content_item_id, last_updated_at, body_json, title, slug, content_items!inner(workflow_status)")
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
    .select("id, locale, last_updated_at")
    .eq("content_item_id", enUs.content_item_id)
    .neq("locale", "en-US");
  for (const o of others ?? []) {
    const otherTime = o.last_updated_at ? new Date(o.last_updated_at).getTime() : 0;
    if (enUsTime - otherTime > STALE_THRESHOLD_MS) {
      stales.push({
        contentItemId: enUs.content_item_id,
        locId: o.id,
        locale: o.locale,
        sourceArticle: { title: enUs.title, slug: enUs.slug, body_json: enUs.body_json },
      });
    }
  }
}

console.log(`Found ${stales.length} stale rows. Fixing with DELIMITED format...\n`);

let succeeded = 0;
let failed = 0;
let totalTokens = 0;

for (const stale of stales) {
  const targetLang = LOCALE_FULL_NAMES[stale.locale] ?? stale.locale;
  const userPrompt = `Translate the article below from English to ${targetLang} (locale ${stale.locale}). Use the delimited TEXT format from your system prompt. Preserve voice, structure, HTML.

ENGLISH ARTICLE (as JSON for input only — your OUTPUT must be the delimited text format):
${JSON.stringify(stale.sourceArticle, null, 2)}`;

  const tr = await callClaude(TRANSLATION_SYSTEM_PROMPT, userPrompt);
  if ("error" in tr) {
    console.log(`  ✗ ${stale.locale} ${stale.locId.slice(0, 8)}: ${tr.error}`);
    failed++;
    continue;
  }
  totalTokens += tr.tokensUsed;
  const parsed = parseDelimited(tr.raw);
  if (!parsed) {
    console.log(`  ✗ ${stale.locale} ${stale.locId.slice(0, 8)}: delimited parse failed (no TITLE or MAIN_HTML)`);
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
  const wc = parsed.body_json.mainHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  console.log(`  ✓ ${stale.locale} ${stale.locId.slice(0, 8)} (${wc}w, ${tr.tokensUsed} tokens)`);
}

console.log(`\n══ SUMMARY ══`);
console.log(`Succeeded: ${succeeded}/${stales.length}`);
console.log(`Failed:    ${failed}`);
console.log(`Tokens:    ${totalTokens.toLocaleString()}`);
console.log(`Cost est:  $${((totalTokens / 1_000_000) * 9).toFixed(2)}`);
