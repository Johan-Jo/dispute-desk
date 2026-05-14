/**
 * Targeted depth-expansion for the 7 articles flagged in the user's punch list.
 * Each article gets an article-specific brief with explicit sections to add,
 * target word count, and (where applicable) classification fix.
 *
 * Pipeline:
 *   1. Pull current en-US article body
 *   2. Send to Claude with an EXPANSION prompt (preserve good parts, add the
 *      specified missing depth — do NOT rewrite from scratch)
 *   3. Save expanded body back to en-US row (preserve slug)
 *   4. Translate the new en-US to all 5 non-English locales (delimited format)
 *   5. Recalc reading_time_minutes for all updated rows
 *
 * Usage: npx tsx scripts/expand-verified-articles.mts [--slug=<slug>] [--dry-run]
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

const args = process.argv.slice(2);
const slugFilter = args.find((a) => a.startsWith("--slug="))?.slice(7);
const dryRun = args.includes("--dry-run");

interface ExpansionBrief {
  slug: string;
  targetWords: string;
  reclassifyTo?: "cluster_article" | "pillar_page";
  instructions: string;
}

const BRIEFS: ExpansionBrief[] = [
  {
    slug: "automated-evidence-packs-shopify-check",
    targetWords: "1,500–1,800 words",
    instructions: `This article currently reads as old generic-generator output. Rewrite in the operator-decision style we're now using across the hub. Required sections (use topic-led headings, not these labels):
- Open with a concrete dispute scenario where automated evidence packs WORKED, then a scenario where they MISSED something
- The evidence hierarchy automation handles well (AVS, CVV, tracking pulls, order metadata) vs evidence it can't generate (signed delivery PDFs sourced from carrier portals, screenshots of customer comms, signed contracts)
- Shopify-specific limitations: what automation reads from Shopify Admin/OrderTransaction vs what requires manual upload from Shippo/Gorgias/etc.
- Buyer's checklist: when automated packs are sufficient (low-AOV, simple INR), when manual review is required (fraud disputes, high-AOV, repeat buyers, mixed-evidence cases)
- A line on Shopify Protect interaction: automated pack does nothing for PROTECTED disputes — verify status before assembly
Fold DisputeDesk into 1-2 sentences max, no dedicated automation/product section.`,
  },
  {
    slug: "crafting-shopify-refund-policies-minimize-chargebacks",
    targetWords: "1,500–1,800 words",
    instructions: `Article is currently generic ecommerce-blog tone. Rewrite as a dispute-decision article. Required content:
- How refund policy text actually appears in Shopify representment evidence (the Order page, the policy URL, screenshot evidence the merchant submits)
- What issuers actually care about reading in policy text: refund timeline, return shipping responsibility, restocking fees, dispute escalation steps
- Refund timeline evidence: dated email confirmations of refund status, Shopify order timeline screenshots, payment processor refund records
- Customer acknowledgement evidence: order-page checkbox capture, terms acceptance timestamps, post-purchase email open/click data
- Screenshots: which Shopify Admin views to capture, what to redact (PII), which views the issuer expects vs what's irrelevant noise
- Order-page policy visibility: the Shopify checkout settings that surface policy at point of sale, which actually moves issuers vs which are SEO-only
- A messy real example: refund policy was clear, customer disputed anyway — what evidence needed alongside the policy text
Fold DisputeDesk into 1-2 sentences in the closing prose.`,
  },
  {
    slug: "understanding-chargeback-software-pricing-models",
    targetWords: "1,800–2,500 words",
    instructions: `Article is good direction but needs commercial-comparison depth for buyer-intent traffic. Add:
- Pricing model breakdown table (in HTML <table>): subscription / success-fee / hybrid / pay-per-dispute, with typical price ranges, who each fits, hidden cost categories
- Worked pricing examples for 3 merchant scenarios: (a) low-volume Shopify store ($500/mo dispute volume), (b) mid-market ($5K/mo), (c) enterprise ($50K/mo) — what each model would cost
- Calculator-style logic: per-dispute economics — at what dispute volume does subscription beat success-fee, with the formula
- Hidden costs to watch: integration fees, setup charges, evidence-pack overage, premium support tiers, volume commitments
- Volume scenarios: what happens to your bill at 2x dispute volume under each model — which model has predictable cost vs variable
- Honest "when paying nothing extra is the right call": Shopify Protect coverage absorbs the dispute; some merchants don't need third-party tools at low volume
- A buyer's filter: 3-question test before evaluating any vendor (current dispute volume, evidence assembly bottleneck, processor mix)
Fold DisputeDesk in honestly: not as the answer to all scenarios, but as one option for merchants whose bottleneck is evidence consolidation.`,
  },
  {
    slug: "optimizing-chargeback-automation-tasks",
    targetWords: "2,000–2,500 words",
    instructions: `Core DisputeDesk positioning topic — needs flagship depth, not just a good 1,200-word piece. Add:
- A taxonomy of dispute-handling tasks split into AUTOMATABLE / SEMI-AUTOMATABLE / NEVER AUTOMATE (with examples of each)
- Evidence mapping: which Shopify-Admin / OrderTransaction / Fulfillment / Customer fields each automated task reads, and which require manual carrier-portal or support-tool retrieval
- Failed-automation examples: what happens when you over-automate — automated packs missing signatures on high-AOV orders, automation routing fraud disputes through the same flow as INR
- Shopify-specific automation flow: notification → status check → Protect coverage gate → reason-code lookup → evidence assembly → human-review trigger → submit
- The human-review trigger criteria: AOV > X, fraud reason code, second-presentment, evidence inconsistency
- A merchant decision rule: when to trust full automation vs when to set everything to "review-before-send"
- What you give up by automating: nuance, context-specific narrative, the chance to negotiate via support pre-dispute
Fold DisputeDesk into 1-2 sentences max — this article is about automation in general, not the product.`,
  },
  {
    slug: "chargeback-monitoring-programs-ecommerce-merchants",
    targetWords: "2,500–3,500 words",
    reclassifyTo: "pillar_page",
    instructions: `Article is classified as PILLAR PAGE but currently reads as a 1,000-word cluster article. Expand to true pillar depth covering:
- Visa Dispute Monitoring Program (VDMP) and Mastercard Excessive Chargeback Merchant (ECM) program — exact thresholds (chargeback ratio, count thresholds), how they're measured (count vs $-volume), which transactions count
- Ratio math worked through: example merchant at 0.65% threshold, what dispute counts trigger entry, what counts toward exit
- Shopify-specific workflow: where merchants see their own chargeback count in Shopify Admin (or where they don't), how to back-calculate ratio from Shopify Payments dashboard data
- Stage-by-stage program escalation: standard monitoring → high-risk → excessive — what changes at each stage (fees, hold periods, response requirements)
- Prevention plan that actually moves the ratio: focus on the dispute reasons driving entry, not blanket reduction tactics. Friendly fraud vs true fraud distinction matters here.
- A worked example: merchant entered VDMP at 1.2%, what they did month-by-month to drop below 0.65%
- What happens if you don't exit: program fees, processor termination, MATCH-list landing
- Honest section on Shopify Protect's effect on monitoring: which dispute types Shopify absorbs liability for, and whether they still count toward processor monitoring (varies by acquirer — confirm)
- A pre-program checklist: 7 things to fix before your ratio becomes someone else's problem
Fold DisputeDesk into 1-2 sentences max in the closing prose.`,
  },
  {
    slug: "shopify-merchant-playbook-unauthorized-purchase-chargebacks",
    targetWords: "1,800–2,200 words",
    instructions: `Article is already operator-toned but only 5 min read for a core unauthorized-purchase topic. Add:
- More depth on Visa reason 10.4 / Mastercard 4837 (Card Not Authorized) — what each network actually requires
- The authorization-evidence stack in detail: AVS, CVV, 3DS, IP, device fingerprint, behavioral signals — what each proves and where each fails
- A second messy scenario alongside the existing one (different vertical, different signal mix, different outcome)
- The friendly-fraud vs true-fraud split for unauthorized claims: how to spot which you're dealing with from the evidence pattern
- When to concede: low-AOV unauthorized claims, repeat-customer unauthorized claims (probably account-takeover), specific signal combinations
- The retrieval-window trap: data that disappears (carrier signature scans expire, customer service messages get archived) — what to capture proactively
- Pre-fulfillment risk controls that prevent the dispute from landing in the first place</p>
Fold DisputeDesk into 1-2 sentences in closing.`,
  },
  {
    slug: "mastercard-chargeback-reason-codes-shopify",
    targetWords: "2,000–2,500 words",
    instructions: `Reason-code reference page — must be precise and operationally deep, not a list with brief blurbs. Required:
- Brief framing on Mastercard's dispute resolution initiative timeline (what changed, when, what it means for Shopify merchants — confirm details with your processor)
- The major Mastercard reason codes Shopify merchants actually see, with for EACH:
  - Numeric code + name (4837, 4853, 4855, 4863, etc.)
  - What the cardholder is claiming
  - What evidence the issuer needs to see to rule for the merchant
  - The exact Shopify Admin paths/fields that produce that evidence
  - The trap: what merchants typically submit that doesn't address the actual reason
  - When to fight vs concede for this code
- A code-to-evidence mapping table (HTML <table>) covering the top 6-8 codes
- Pre-arbitration / second-presentment caveats: which codes commonly escalate, what additional evidence the issuer demands at second presentment
- Shopify-Payments-vs-other-gateways differences in how reason codes surface
Fold DisputeDesk into 1-2 sentences in closing.`,
  },
];

function htmlToText(html: string): string {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function wordCount(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

const EXPANSION_SYSTEM_PROMPT = `You are expanding an existing Shopify chargebacks article to add specific depth. PRESERVE the parts that work. ADD the sections specified by the user. The output must remain a MERCHANT DECISION PAGE — sharp, operator-voiced, no SEO-blog tone.

Voice rules: operator-grade, opinionated, sharp. Hard-banned phrases (in any language): "is crucial", "leveraging", "robust", "comprehensive overview", "in conclusion", "businesses should", "the importance of", "is the backbone of", "plays a vital role", "throughout this process", "various factors", "typically includes", "It's important to note", "is key", "key to", "helps streamline", "enhances efficiency", "seamlessly", "Consider a", "This example underscores", "This highlights", "This demonstrates".

Section heading rules: NEVER use "Understanding [X]", "What is [X]", "Importance of", "Backbone of", "Failure Modes", "Evidence Hierarchy", "Messy Examples", "Operational Notes", "Workflow Notes", "Processor Caveats", "DisputeDesk's Role", "Where Automation Fits", "Where DisputeDesk Helps", "Role of Automation", "Variance Constraints" or close variants. Section headings must be topic-led, claim-based, or scenario-based.

DisputeDesk fold-in: ONE OR TWO SENTENCES MAX inside relevant prose. NEVER as its own section.

OUTPUT FORMAT — return valid JSON:
{
  "title": "string (revise only if expansion changes the article focus)",
  "excerpt": "string (revise to reflect new depth, max 300 chars)",
  "slug": "string (KEEP existing slug)",
  "meta_title": "string (max 60 chars)",
  "meta_description": "string (revise to reflect new depth, max 160 chars)",
  "body_json": {
    "mainHtml": "string (the EXPANDED article — preserve good parts of input, add the user-specified sections)",
    "keyTakeaways": ["3–5 sharp lines reflecting the expanded content"],
    "faq": [{"q": "...", "a": "..."}],
    "disclaimer": "This content is for informational purposes only and does not constitute legal advice."
  }
}

Return ONLY valid JSON. No surrounding prose, no code fences.`;

const TRANSLATION_SYSTEM_PROMPT = `You translate Shopify chargebacks articles between languages. Output a structured TEXT format (NOT JSON) so quote characters do not break parsing.

Voice: operator-grade, sharp, opinionated. Same banned phrases as English apply in target-language equivalent.

Preserve: HTML tags, section structure, Shopify product names verbatim, AVS/CVV/3-D Secure verbatim. Adapt currency to local idioms.

Locale conventions: de-DE formal Sie | fr-FR formal vous | es-ES neutral professional | pt-BR Brazilian professional | sv-SE Nordic concise.

OUTPUT FORMAT — return EXACTLY this delimited structure (no JSON, no fences):

<<<TITLE>>>
[translated title]
<<<END>>>
<<<EXCERPT>>>
[translated excerpt, max 300 chars]
<<<END>>>
<<<SLUG>>>
[locale-language slug, ASCII, never English words for non-en-US]
<<<END>>>
<<<META_TITLE>>>
[max 60 chars]
<<<END>>>
<<<META_DESCRIPTION>>>
[max 160 chars]
<<<END>>>
<<<MAIN_HTML>>>
[translated body HTML, preserve all tags, use any quote characters freely]
<<<END>>>
<<<KEY_TAKEAWAY>>>
[one takeaway]
<<<END>>>
<<<KEY_TAKEAWAY>>>
[another]
<<<END>>>
<<<FAQ_Q>>>
[question]
<<<END>>>
<<<FAQ_A>>>
[answer]
<<<END>>>
<<<DISCLAIMER>>>
[translated disclaimer]
<<<END>>>

Return ONLY the delimited output.`;

const LOCALE_NAMES: Record<string, string> = {
  "de-DE": "German",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "pt-BR": "Brazilian Portuguese",
  "sv-SE": "Swedish",
};

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
  const re = /<<<([A-Z_]+)>>>\s*([\s\S]*?)\s*<<<END>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ tag: m[1], content: m[2].trim() });
  }
  if (blocks.length === 0) return null;
  const single = (tag: string) => blocks.find((b) => b.tag === tag)?.content ?? "";
  const all = (tag: string) => blocks.filter((b) => b.tag === tag).map((b) => b.content);
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
    body_json: { mainHtml, keyTakeaways: all("KEY_TAKEAWAY"), faq, disclaimer: single("DISCLAIMER") },
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
          max_tokens: 16000,
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
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  return { error: "Claude failed after 3 attempts" };
}

function readingTime(words: number): number { return Math.max(1, Math.round(words / 200)); }

const briefs = slugFilter ? BRIEFS.filter((b) => b.slug === slugFilter) : BRIEFS;
console.log(`Expanding ${briefs.length} article(s)${dryRun ? " (DRY RUN)" : ""}\n`);

let totalTokens = 0;
let succeeded = 0;
let failed = 0;

for (const brief of briefs) {
  console.log(`\n══ ${brief.slug} ══`);
  const { data: enUs } = await sb
    .from("content_localizations")
    .select("id, content_item_id, title, excerpt, meta_title, meta_description, slug, body_json")
    .eq("slug", brief.slug)
    .eq("locale", "en-US")
    .maybeSingle();
  if (!enUs) { console.log(`  ✗ slug not found`); failed++; continue; }

  const currentWords = wordCount(htmlToText((enUs.body_json as Record<string, unknown>)?.mainHtml as string ?? ""));
  console.log(`  current: ${currentWords}w → target ${brief.targetWords}`);
  if (dryRun) continue;

  // Step 1 — expand en-US
  const expansionUserPrompt = `Expand the article below to ${brief.targetWords}.

CURRENT ARTICLE (preserve good parts, add the specified sections):
${JSON.stringify({
  title: enUs.title,
  slug: enUs.slug,
  excerpt: enUs.excerpt,
  meta_title: enUs.meta_title,
  meta_description: enUs.meta_description,
  body_json: enUs.body_json,
}, null, 2)}

EXPANSION INSTRUCTIONS:
${brief.instructions}

Return ONLY the expanded JSON. KEEP the existing slug.`;

  const ex = await callClaude(EXPANSION_SYSTEM_PROMPT, expansionUserPrompt);
  if ("error" in ex) {
    console.log(`  ✗ expansion failed: ${ex.error}`);
    failed++;
    continue;
  }
  totalTokens += ex.tokensUsed;
  let parsed;
  try { parsed = JSON.parse(ex.raw); } catch {
    console.log(`  ✗ expansion returned non-JSON`);
    failed++;
    continue;
  }
  const newWords = wordCount(htmlToText(parsed.body_json?.mainHtml ?? ""));
  console.log(`  ✓ expanded en-US: ${currentWords}w → ${newWords}w (${ex.tokensUsed} tokens)`);

  // Step 2 — save en-US (preserve slug, possibly reclassify)
  const updates: Record<string, unknown> = {
    title: parsed.title ?? enUs.title,
    excerpt: parsed.excerpt,
    meta_title: parsed.meta_title,
    meta_description: parsed.meta_description,
    body_json: parsed.body_json,
    reading_time_minutes: readingTime(newWords),
    last_updated_at: new Date().toISOString(),
  };
  await sb.from("content_localizations").update(updates).eq("id", enUs.id);

  // Reclassification on the parent content_item
  if (brief.reclassifyTo) {
    await sb.from("content_items").update({ content_type: brief.reclassifyTo, updated_at: new Date().toISOString() }).eq("id", enUs.content_item_id);
    console.log(`  ✓ reclassified content_item to ${brief.reclassifyTo}`);
  }

  // Step 3 — translate to all 5 other locales (delimited format)
  const newEnUs = parsed;
  const TARGET_LOCALES = ["de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];
  for (const targetLocale of TARGET_LOCALES) {
    const targetLang = LOCALE_NAMES[targetLocale];
    const trUserPrompt = `Translate the article below from English to ${targetLang} (locale ${targetLocale}). Use the delimited TEXT format from your system prompt.

ENGLISH ARTICLE (input — your output must be the delimited format):
${JSON.stringify(newEnUs, null, 2)}`;

    let tr = await callClaude(TRANSLATION_SYSTEM_PROMPT, trUserPrompt);
    let parsedTrans = "error" in tr ? null : parseDelimited(tr.raw);
    if (!parsedTrans) {
      tr = await callClaude(TRANSLATION_SYSTEM_PROMPT, trUserPrompt);
      parsedTrans = "error" in tr ? null : parseDelimited(tr.raw);
    }
    if (!parsedTrans) {
      console.log(`  ✗ ${targetLocale} translation failed (after retry)`);
      continue;
    }
    if (!("error" in tr)) totalTokens += tr.tokensUsed;
    const trWords = wordCount(htmlToText(parsedTrans.body_json.mainHtml));

    const { data: existing } = await sb
      .from("content_localizations")
      .select("id, slug, route_kind")
      .eq("content_item_id", enUs.content_item_id)
      .eq("locale", targetLocale)
      .maybeSingle();

    if (existing) {
      await sb.from("content_localizations").update({
        title: parsedTrans.title,
        excerpt: parsedTrans.excerpt,
        meta_title: parsedTrans.meta_title,
        meta_description: parsedTrans.meta_description,
        body_json: parsedTrans.body_json,
        reading_time_minutes: readingTime(trWords),
        last_updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
      console.log(`  ✓ ${targetLocale} updated (${trWords}w)`);
    } else {
      const { data: routeRow } = await sb.from("content_localizations").select("route_kind").eq("id", enUs.id).maybeSingle();
      await sb.from("content_localizations").insert({
        content_item_id: enUs.content_item_id,
        locale: targetLocale,
        route_kind: routeRow?.route_kind ?? "resources",
        title: parsedTrans.title,
        slug: parsedTrans.slug,
        excerpt: parsedTrans.excerpt,
        body_json: parsedTrans.body_json,
        meta_title: parsedTrans.meta_title,
        meta_description: parsedTrans.meta_description,
        reading_time_minutes: readingTime(trWords),
        translation_status: "complete",
        is_published: true,
      });
      console.log(`  + ${targetLocale} inserted (${trWords}w, slug ${parsedTrans.slug})`);
    }
  }

  succeeded++;
  console.log(`  Running totals: ${succeeded} done, ${failed} failed, ${totalTokens.toLocaleString()} tokens, ~$${((totalTokens / 1_000_000) * 9).toFixed(2)}`);
}

console.log(`\n══ SUMMARY ══`);
console.log(`Succeeded: ${succeeded}/${briefs.length}`);
console.log(`Failed:    ${failed}`);
console.log(`Total tokens: ${totalTokens.toLocaleString()}`);
console.log(`Estimated cost: $${((totalTokens / 1_000_000) * 9).toFixed(2)}`);
