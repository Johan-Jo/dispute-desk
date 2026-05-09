/**
 * Send a test translation request and dump the RAW Claude response so we
 * can see exactly what's failing JSON parsing.
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
const targetLocale = process.argv[2] || "de-DE";
const targetLang = {
  "de-DE": "German",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "pt-BR": "Brazilian Portuguese",
  "sv-SE": "Swedish",
}[targetLocale] || "German";

// Pull the article we just regenerated
const { data: loc } = await sb
  .from("content_localizations")
  .select("title, slug, excerpt, meta_title, meta_description, body_json")
  .eq("slug", "understanding-issuer-claims-shopify-checks")
  .eq("locale", "en-US")
  .maybeSingle();

if (!loc) {
  console.error("Article not found");
  process.exit(1);
}

const TRANSLATION_SYSTEM_PROMPT = `You translate Shopify chargebacks articles between languages while preserving voice, structure, evidence specifics, and operational accuracy.

CRITICAL JSON SAFETY RULE:
NEVER use the ASCII double-quote character (") inside string values — it's the JSON delimiter and breaks parsing. Use Unicode curly quotes for typographic quotes (German "…", English "…", French «…»), or use single quotes ' for inline references like 'Submit response'. Never mix opening Unicode quotes with closing ASCII quotes.

OUTPUT FORMAT — return valid JSON with this exact structure:
{
  "title": "string (translated)",
  "excerpt": "string (translated, max 300 chars)",
  "slug": "string (locale-language slug, ASCII, max 80 chars)",
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

const translateUserPrompt = `Translate the article below from English to ${targetLang} (locale ${targetLocale}). Preserve voice, structure, HTML.

ENGLISH ARTICLE:
${JSON.stringify(loc, null, 2)}

Return ONLY the translated JSON.`;

console.log(`Calling Claude for ${targetLocale} translation...`);
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    system: TRANSLATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: translateUserPrompt }],
    temperature: 0.4,
    max_tokens: 8192,
  }),
});

const data = await res.json();
console.log(`HTTP ${res.status}`);
console.log(`Tokens: input ${data.usage?.input_tokens}, output ${data.usage?.output_tokens}`);
console.log(`stop_reason: ${data.stop_reason}`);
console.log(`stop_sequence: ${data.stop_sequence}`);

const block = data.content?.find((b: { type: string; text?: string }) => b.type === "text");
const raw = block?.text ?? "";

console.log(`\nRaw output length: ${raw.length} chars`);
console.log(`Starts with: "${raw.slice(0, 100)}"`);
console.log(`Ends with:   "${raw.slice(-100)}"`);

// Try parsing the JSON
let cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
console.log(`\nAfter fence-strip starts with: "${cleaned.slice(0, 100)}"`);
console.log(`After fence-strip ends with:   "${cleaned.slice(-100)}"`);

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
  console.log(`\n✓ JSON parses cleanly on first attempt`);
} catch (e: unknown) {
  const err = e as Error;
  console.log(`\n✗ Standard JSON parse failed: ${err.message}`);
  // Try repair pass
  try {
    const repaired = repairJsonStringQuotes(cleaned);
    JSON.parse(repaired);
    console.log(`✓ JSON parses cleanly after quote-repair pass`);
  } catch (e2: unknown) {
    const err2 = e2 as Error;
    console.log(`✗ Even after repair pass: ${err2.message}`);
    const match = err.message.match(/position (\d+)/);
    if (match) {
      const pos = parseInt(match[1], 10);
      const start = Math.max(0, pos - 80);
      const end = Math.min(cleaned.length, pos + 80);
      console.log(`\nOriginal context around position ${pos}:`);
      console.log(`...${cleaned.slice(start, end)}...`);
    }
  }
}
