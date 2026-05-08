/**
 * Targeted REVISION (not regeneration) of pillar 1 to apply the merchant
 * decision-page fixes:
 *
 *   1. Replace "Where Automation Fits and Where It Doesn't" with
 *      "What to check before you submit" or similar merchant-facing section.
 *   2. Add a checklist-in-prose covering the 7 pre-submission checks.
 *   3. Strengthen the intro: "you can lose before the issuer evaluates the evidence".
 *   4. Keep the $300 apparel scenario, ADD a 1–3 sentence decision lesson after it.
 *   5. Total length 800–1,100w.
 *
 * Approach: pull the existing article body_json from DB, send to Claude
 * Sonnet 4.6 with a focused REVISION prompt (not regeneration), parse the
 * response, write back to DB.
 *
 * Cost: ~$0.10 (one Claude call, no Pass 1).
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

const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

const PILLAR_1_ID = "b290ba8e-d5d7-4694-8dc1-4a637a754858";

const { data: loc, error } = await sb
  .from("content_localizations")
  .select("id, title, slug, excerpt, meta_title, meta_description, body_json")
  .eq("content_item_id", PILLAR_1_ID)
  .eq("locale", "en-US")
  .maybeSingle();

if (error || !loc) {
  console.error(`Pillar 1 localization not found: ${error?.message ?? "no row"}`);
  process.exit(1);
}

const REVISION_SYSTEM_PROMPT = `You are revising a published Shopify chargebacks article to make it a MERCHANT DECISION PAGE, not an internal operations memo. The current article is provided below. Apply the specific revisions listed in the user message. PRESERVE wording where it's already strong; only revise what the instructions require.

Voice: still operator-grade, sharp, opinionated. Still no SEO-blog phrases. Hard-banned: "Understanding [X]", "Importance of", "is crucial", "is the backbone of", "plays a vital role", "robust", "leveraging", "in conclusion", "comprehensive overview", "businesses should", "throughout this process", "various factors", "typically includes", "It's important to note".

A merchant should finish the revised article knowing exactly what to check inside Shopify before submitting a chargeback response. The article is for THEM — not for an analyst.

OUTPUT FORMAT — return valid JSON with this exact structure (you may keep the same title / excerpt / meta_title / meta_description if they still fit; revise them only if the article structure changes substantially):

{
  "title": "string",
  "excerpt": "string (max 300 chars)",
  "slug": "string (keep the existing slug unless it must change)",
  "meta_title": "string (max 60 chars)",
  "meta_description": "string (max 160 chars)",
  "body_json": {
    "mainHtml": "<h2>...</h2><p>...</p>...  (the revised article)",
    "keyTakeaways": ["3–5 sharp lines"],
    "faq": [{"q": "...", "a": "..."}],
    "disclaimer": "This content is for informational purposes only and does not constitute legal advice."
  }
}

Return ONLY the JSON. No surrounding prose.`;

const REVISION_USER_PROMPT = `Revise the article below. Apply ALL of the following changes:

CHANGE 1 — Strengthen the opening. The intro must immediately tell the merchant WHY THIS MATTERS in operational terms. Use a line like "you can lose this dispute before the issuer ever evaluates your evidence" — make the operational stakes vivid in the first paragraph. Don't just say "operational losses are a problem".

CHANGE 2 — Replace the final section "Where Automation Fits and Where It Doesn't" entirely. Replace it with a merchant-facing section called "What to check before you submit" (or similar — your call on phrasing). This section MUST function as a checklist-in-prose covering:
  - Verify the dispute status and exact deadline inside Shopify Admin (Settings → Payments → Manage → Disputes)
  - Check the Shopify Protect status (PROTECTED / ACTIVE / NONE) — coverage changes whether you even need to respond
  - Confirm the dispute reason code and what evidence it actually requires
  - Match the evidence package to the dispute reason (delivery proof for INR; authentication signals for fraud; etc.)
  - Verify whether your delivery proof actually proves cardholder receipt, not just package arrival
  - Confirm the processor's exact response deadline (Shopify Payments default 10 days; varies by processor)
  - Decide whether to fight or accept — the math changes for low-AOV disputes vs high-AOV cases

Write this as flowing prose, not a bulleted list. Keep it sharp. Sequence matters — these are pre-flight checks the merchant runs in order.

CHANGE 3 — Keep the $300 apparel / $500 / electronics scenario in section 3 (whichever scenario is currently there). After the scenario walkthrough, ADD a 1–3 sentence DECISION LESSON: what would have made this case fightable vs what made it weak. Don't just describe the loss — extract the rule the merchant should take away.

CHANGE 4 — DisputeDesk fold-in. The current article ends on a product/automation section. Remove that framing entirely. Instead, fold ONE OR TWO sentences about DisputeDesk's role naturally into the prose somewhere it earns its place — for example, "DisputeDesk surfaces Shopify Protect status during evidence assembly, but the merchant verifies it before deciding response strategy". Honest, useful, not promotional. Never as its own section.

CHANGE 5 — Total length: 800–1,100 words. Don't pad with generic filler. The new "What to check before you submit" section will add roughly 200–300 words of real merchant value; if other sections need to tighten to keep total length reasonable, tighten them.

PRESERVE everything else: the operator voice, the topic-led headings, the asymmetric pacing, the inline variance constraints, the developed scenario itself.

CURRENT ARTICLE:
${JSON.stringify(
  {
    title: loc.title,
    excerpt: loc.excerpt,
    slug: loc.slug,
    meta_title: loc.meta_title,
    meta_description: loc.meta_description,
    body_json: loc.body_json,
  },
  null,
  2
)}

Return ONLY the revised JSON. No surrounding prose.`;

console.log("Sending pillar 1 revision request to Claude Sonnet 4.6...");
const start = Date.now();

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    system: REVISION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: REVISION_USER_PROMPT }],
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

console.log(`  Done — tokens: ${tokensUsed}, latency: ${elapsed}ms\n`);

const cleaned = raw
  .replace(/^\s*```(?:json)?\s*/i, "")
  .replace(/\s*```\s*$/i, "")
  .trim();

let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch {
  console.error("Revision returned non-JSON. First 500 chars:");
  console.log(cleaned.slice(0, 500));
  process.exit(1);
}

// Diagnostics on the revision
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

const html = parsed.body_json?.mainHtml ?? "";
const wc = wordCount(htmlToText(html));
const h2s = extractH2s(html);

console.log("══════════════════════════════════════════════════════════════════");
console.log("REVISED ARTICLE:");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  Title:    ${parsed.title}`);
console.log(`  Words:    ${wc}`);
console.log(`  H2 count: ${h2s.length}`);
console.log(`  Sections:`);
h2s.forEach((h, i) => console.log(`    ${i + 1}. ${h}`));
console.log("\n  Full body:\n");
console.log(html);

// Save back to DB
console.log("\n══════════════════════════════════════════════════════════════════");
console.log("Saving revised article to DB...");
const { error: updateErr } = await sb
  .from("content_localizations")
  .update({
    title: parsed.title,
    slug: parsed.slug ?? loc.slug,
    excerpt: parsed.excerpt,
    meta_title: parsed.meta_title,
    meta_description: parsed.meta_description,
    body_json: parsed.body_json,
    last_updated_at: new Date().toISOString(),
  })
  .eq("id", loc.id);

if (updateErr) {
  console.error(`  ✗ DB update failed: ${updateErr.message}`);
  process.exit(1);
}
console.log(`  ✓ Saved revision to localization ${loc.id}`);
console.log(`\nReview at: https://disputedesk.app/admin/resources/content/${PILLAR_1_ID}`);
