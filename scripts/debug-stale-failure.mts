/**
 * Pull one stale-failed translation row, attempt the translation call, and
 * dump the RAW Claude output so we can see exactly what JSON shape is breaking.
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

// Pick one of the persistent de-DE failures
const STALE_LOC_ID = "4be81dd2-c11f-4a56-b5f8-4c8b969ccea7";

const { data: stale } = await sb
  .from("content_localizations")
  .select("id, locale, content_item_id, last_updated_at")
  .eq("id", STALE_LOC_ID)
  .maybeSingle();

if (!stale) { console.error("Not found"); process.exit(1); }

const { data: enUs } = await sb
  .from("content_localizations")
  .select("title, slug, body_json")
  .eq("content_item_id", stale.content_item_id)
  .eq("locale", "en-US")
  .maybeSingle();

if (!enUs) { console.error("No en-US sibling"); process.exit(1); }

console.log(`Stale: ${stale.locale} ${stale.id} (last updated ${stale.last_updated_at})`);
console.log(`Source en-US: "${enUs.title}" — slug ${enUs.slug}`);
console.log(`Source en-US length: ${JSON.stringify(enUs).length} chars\n`);

const userPrompt = `Translate the article below from English to German (locale de-DE). Preserve voice, structure, HTML. NEVER use ASCII " inside string values — use „…" for German quotes.

ENGLISH ARTICLE:
${JSON.stringify({ title: enUs.title, slug: enUs.slug, body_json: enUs.body_json }, null, 2)}

Return ONLY valid JSON. No surrounding prose. No code fences.`;

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    system: "Translate Shopify chargebacks articles. Output ONLY valid JSON. NEVER use ASCII \" inside string values.",
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0.4,
    max_tokens: 8192,
  }),
});

const data = await res.json();
console.log(`HTTP ${res.status}, stop_reason: ${data.stop_reason}, output_tokens: ${data.usage?.output_tokens}`);
const raw = data.content?.[0]?.text ?? "";
console.log(`Raw output length: ${raw.length} chars\n`);

// Try parsing
const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();

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

try {
  JSON.parse(cleaned);
  console.log("✓ Parses cleanly without repair");
} catch (e: unknown) {
  console.log(`✗ Standard parse: ${(e as Error).message}`);
  const repaired = repairJsonStringQuotes(cleaned);
  try {
    JSON.parse(repaired);
    console.log("✓ Parses cleanly AFTER repair");
  } catch (e2: unknown) {
    console.log(`✗ Even after repair: ${(e2 as Error).message}`);
    const m = (e2 as Error).message.match(/position (\d+)/);
    if (m) {
      const pos = parseInt(m[1], 10);
      console.log(`\nContext in REPAIRED output around position ${pos}:`);
      console.log(`...${repaired.slice(Math.max(0, pos - 100), pos + 100)}...`);
    }
  }
}