/**
 * Generic merchant-decision-page revision pass for any article.
 *
 * Pulls the existing localization, sends to Claude Sonnet 4.6 with the
 * merchant-decision-page revision contract, writes the revised article
 * back to the SAME row (preserves slug + content_item link).
 *
 * Usage:
 *   npx tsx scripts/revise-article-merchant-decision.mts <content_item_id> [locale]
 *   locale defaults to en-US
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
  console.error("Missing ANTHROPIC_API_KEY in .env.local");
  process.exit(1);
}

const contentItemId = process.argv[2];
const locale = process.argv[3] || "en-US";
if (!contentItemId) {
  console.error("Usage: npx tsx scripts/revise-article-merchant-decision.mts <content_item_id> [locale]");
  process.exit(1);
}

const { data: loc, error } = await sb
  .from("content_localizations")
  .select("id, title, slug, excerpt, meta_title, meta_description, body_json")
  .eq("content_item_id", contentItemId)
  .eq("locale", locale)
  .maybeSingle();

if (error || !loc) {
  console.error(`Localization not found for ${contentItemId}/${locale}: ${error?.message ?? "no row"}`);
  process.exit(1);
}

const REVISION_SYSTEM_PROMPT = `You are revising a Shopify chargebacks article into a MERCHANT DECISION PAGE.

A merchant should finish the revised article knowing exactly what to check inside Shopify before submitting a chargeback response. The article is for THEM — not for an analyst.

Voice: operator-grade, sharp, opinionated. Hard-banned phrases: "Understanding [X]", "Importance of", "is crucial", "is the backbone of", "plays a vital role", "robust", "leveraging", "in conclusion", "comprehensive overview", "businesses should", "throughout this process", "various factors", "typically includes", "It's important to note", "is key", "key to", "helps streamline", "enhances efficiency", "seamlessly", "allows you to" (mid-sentence), "Consider a [scenario]", "This example underscores", "This highlights", "This demonstrates".

REQUIRED REVISIONS — make all of these changes while PRESERVING anything else that's already strong (voice, headings that work, asymmetric pacing, inline variance):

1. INTRO STRENGTH: First paragraph must immediately tell the merchant why this matters operationally — e.g. "you can lose this dispute before the issuer ever evaluates your evidence" or similar topic-specific stakes. Cut generic framing.

2. CHECKLIST-IN-PROSE SECTION: At least one section must function as a sequenced "what to verify before you submit" walkthrough covering as many of these as fit the topic:
   - Verify dispute status and exact deadline inside Shopify Admin (Settings → Payments → Manage → Disputes)
   - Check Shopify Protect status (PROTECTED / ACTIVE / NONE) — coverage changes whether you respond at all
   - Confirm the dispute reason code and what evidence it actually requires
   - Match evidence package to the dispute reason
   - Verify whether delivery proof actually proves cardholder receipt
   - Confirm processor's exact response deadline
   - Decide whether to fight or accept (the math)
   Write as flowing prose, not bullets. If the article already has a section that does this, strengthen it. If not, add one.

3. DECISION LESSON AFTER ANY SCENARIO: When the article walks through a specific case, follow it with 1–3 sentences extracting the rule — what would have made this case fightable vs what made it weak. Don't just describe the loss; give the merchant the takeaway.

4. NO PRODUCT-CENTERED SECTION: Remove any final section about "Where Automation Fits", "Where DisputeDesk Helps", "Role of Automation", or similar. DisputeDesk gets ONE OR TWO SENTENCES folded naturally into prose somewhere it earns its place — never as its own section.

5. END ON MERCHANT ACTION: The final paragraph should leave the merchant with a clear next step, decision rule, or operational takeaway — not a summary of what was discussed.

6. LENGTH: target 800–1,100 words. If the current article is already in range, keep it; if dramatically over, tighten.

7. ANSWERS THE 6 MERCHANT QUESTIONS implicitly through the body:
   - What happened? (the dispute and why it lands)
   - What should the merchant check in Shopify Admin?
   - What evidence actually changes the outcome?
   - When is the case weak even if evidence looks good?
   - What should the merchant DO before submitting?
   - How does DisputeDesk help (folded in, never a section)?

OUTPUT FORMAT — return valid JSON with this exact structure (keep title/excerpt/meta_title/meta_description if they still fit; revise only if structure changes substantially):

{
  "title": "string",
  "excerpt": "string (max 300 chars)",
  "slug": "string (keep existing slug unless it must change)",
  "meta_title": "string (max 60 chars)",
  "meta_description": "string (max 160 chars)",
  "body_json": {
    "mainHtml": "<h2>...</h2><p>...</p>...",
    "keyTakeaways": ["3–5 sharp lines"],
    "faq": [{"q": "...", "a": "..."}],
    "disclaimer": "This content is for informational purposes only and does not constitute legal advice."
  }
}

Return ONLY the JSON. No surrounding prose.`;

const REVISION_USER_PROMPT = `Revise the article below per the merchant-decision-page contract in your system prompt. Apply ALL 7 required revisions. Preserve voice and any headings that already work.

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

Return ONLY the revised JSON.`;

console.log(`Revising ${contentItemId} (${locale}): "${loc.title}"`);
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
  console.error(`Claude API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
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

const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch {
  console.error("Revision returned non-JSON. First 500 chars:");
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

const html = parsed.body_json?.mainHtml ?? "";
const wc = wordCount(htmlToText(html));
const h2s = extractH2s(html);

console.log(`  Done — tokens: ${tokensUsed}, latency: ${elapsed}ms`);
console.log(`  Words: ${wc} | H2: ${h2s.length}`);
console.log(`  Title: ${parsed.title}`);
console.log(`  Sections:`);
h2s.forEach((h, i) => console.log(`    ${i + 1}. ${h}`));

// Save back to DB
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
console.log(`\nReview at: https://disputedesk.app/admin/resources/content/${contentItemId}`);
