/**
 * Inserts 8 Shopify-focused chargeback cluster briefs into content_archive_items.
 * Idempotent: skips rows where proposed_slug already exists.
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/seed-shopify-chargeback-cluster.mjs
 *
 * After seeding, run one autopilot tick (pillar first via priority_score):
 *   node scripts/run-autopilot-once.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

const LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

function briefNotes(b) {
  return JSON.stringify(
    {
      brief_version: 1,
      cluster: "shopify_chargebacks_launch",
      page_title: b.page_title,
      seo_title: b.seo_title,
      suggested_slug: b.suggested_slug,
      secondary_keywords: b.secondary_keywords,
      funnel_stage: b.funnel_stage,
      audience: b.audience,
      article_angle: b.article_angle,
      overlap_to_avoid: b.overlap_to_avoid,
      outline: b.outline,
      cta_type: b.cta_type,
      internal_links_out: b.internal_links_out,
      internal_links_in: b.internal_links_in ?? [],
      cluster_rationale: b.cluster_rationale,
    },
    null,
    2
  );
}

/** Priority: pillar first (highest). Autopilot orders by priority_score DESC. */
const PAGES = [
  {
    priority_score: 1000,
    page_role: "pillar",
    complexity: "high",
    proposed_title: "Shopify Chargebacks: The Practical Merchant Guide",
    proposed_slug: "shopify-chargebacks-practical-merchant-guide",
    content_type: "pillar_page",
    target_keyword: "Shopify chargebacks",
    search_intent: "informational",
    summary:
      "Flagship Shopify-first hub: Admin dispute lifecycle (inquiry → claim → response), practical deadlines, evidence overview, links to seven support articles. Operational, not generic chargeback 101.",
    brief: {
      page_title: "Shopify Chargebacks: The Practical Merchant Guide",
      seo_title: "Shopify Chargebacks: Practical Merchant Guide | DisputeDesk",
      suggested_slug: "shopify-chargebacks-practical-merchant-guide",
      secondary_keywords: [
        "Shopify Payments chargeback",
        "Shopify Admin dispute",
        "Shopify chargeback response",
        "Shopify seller chargebacks",
      ],
      funnel_stage: "awareness",
      audience: "Shopify merchants using Shopify Payments or integrated processors",
      article_angle:
        "Shopify-native walkthrough: where disputes live in Admin, what each phase means for workload, how to prioritize evidence, and a clear hub to deep articles—without rewriting generic chargeback definitions.",
      overlap_to_avoid:
        "Do not mirror Chargebacks FAQ body (generic lifecycle/fees). Do not duplicate Prevention Checklist steps. Link out for prevention and long-form evidence-pack narrative; keep this page Shopify routing + lifecycle + hub links.",
      outline: [
        "What Shopify merchants see first (inquiry vs chargeback labels in context)",
        "Shopify dispute lifecycle in plain terms (merchant-operational)",
        "Deadlines and evidence: what “good enough” means at a high level",
        "Shopify Protect in one section (pointer to deep page)",
        "When to fight vs refund (operator decision frame, not legal advice)",
        "Hub: links to inquiry vs chargeback, issuer claim, issuer response, Protect, delivery proof limits, Visa CE 3.0, evidence checklist",
      ],
      cta_type: "free_trial",
      internal_links_out: [
        { target_slug: "shopify-chargeback-inquiry-vs-chargeback", anchor_suggestion: "chargeback inquiry vs chargeback in Shopify" },
        { target_slug: "shopify-issuer-claim-what-to-check", anchor_suggestion: "issuer claim in Shopify Admin" },
        { target_slug: "shopify-issuer-response-won-or-lost", anchor_suggestion: "issuer response outcomes in Shopify" },
        { target_slug: "shopify-protect-coverage-limits", anchor_suggestion: "what Shopify Protect covers" },
        { target_slug: "shopify-chargeback-proof-delivery-not-enough", anchor_suggestion: "when proof of delivery is not enough" },
        { target_slug: "visa-compelling-evidence-3-shopify-merchants", anchor_suggestion: "Visa Compelling Evidence 3.0 for Shopify merchants" },
        { target_slug: "shopify-chargeback-evidence-checklist", anchor_suggestion: "Shopify chargeback evidence checklist" },
      ],
      internal_links_in: [],
      cluster_rationale:
        "Anchor article for SEO and product fit: Shopify chargebacks as the focused topic cluster entry point.",
    },
  },
  {
    priority_score: 999,
    page_role: "support",
    complexity: "medium",
    proposed_title: "Chargeback Inquiry vs Chargeback on Shopify",
    proposed_slug: "shopify-chargeback-inquiry-vs-chargeback",
    content_type: "cluster_article",
    target_keyword: "Shopify chargeback inquiry",
    search_intent: "informational",
    summary:
      "Clarify Shopify’s inquiry phase vs a full chargeback; merchant actions, timelines, and Admin cues—distinct from the pillar overview and FAQ.",
    brief: {
      page_title: "Chargeback Inquiry vs Chargeback on Shopify",
      seo_title: "Chargeback Inquiry vs Chargeback on Shopify | DisputeDesk",
      suggested_slug: "shopify-chargeback-inquiry-vs-chargeback",
      secondary_keywords: ["Shopify dispute inquiry", "Shopify chargeback notification", "Shopify Payments inquiry"],
      funnel_stage: "consideration",
      audience: "Shopify merchants responding to dispute notifications",
      article_angle:
        "Side-by-side comparison focused on Shopify UI and emails: what each status implies for evidence and refunds.",
      overlap_to_avoid:
        "Avoid repeating full lifecycle chapter from pillar or FAQ; stay in comparison + actions.",
      outline: [
        "Definitions in Shopify context (not abstract card-network only)",
        "Table: inquiry vs chargeback — signals, urgency, typical merchant steps",
        "What to upload early vs wait",
        "Link to issuer claim and issuer response pages",
        "Link back to practical merchant guide pillar",
      ],
      cta_type: "demo_request",
      internal_links_out: [
        { target_slug: "shopify-chargebacks-practical-merchant-guide", anchor_suggestion: "Shopify chargebacks practical guide" },
        { target_slug: "shopify-issuer-claim-what-to-check", anchor_suggestion: "issuer claim checklist" },
        { target_slug: "shopify-issuer-response-won-or-lost", anchor_suggestion: "understanding issuer response" },
      ],
      internal_links_in: [{ from_slug: "shopify-chargebacks-practical-merchant-guide" }],
      cluster_rationale: "Resolves high-intent confusion specific to Shopify labeling.",
    },
  },
  {
    priority_score: 998,
    page_role: "support",
    complexity: "medium",
    proposed_title: "Issuer Claim in Shopify: What It Means and What to Check",
    proposed_slug: "shopify-issuer-claim-what-to-check",
    content_type: "cluster_article",
    target_keyword: "Shopify issuer claim",
    search_intent: "informational",
    summary:
      "Explain issuer claim as merchants see it in Shopify; verification checklist before submitting evidence.",
    brief: {
      page_title: "Issuer Claim in Shopify: What It Means and What to Check",
      seo_title: "Issuer Claim in Shopify: What to Check | DisputeDesk",
      suggested_slug: "shopify-issuer-claim-what-to-check",
      secondary_keywords: ["Shopify dispute issuer claim", "chargeback claim Shopify Admin"],
      funnel_stage: "consideration",
      audience: "Shopify merchants in claim phase",
      article_angle: "Operational checklist: amount, reason, customer history, fulfillment proof readiness.",
      overlap_to_avoid: "Do not duplicate inquiry-vs-chargeback framing; focus claim-stage checks.",
      outline: [
        "What “issuer claim” means for Shopify merchants",
        "Checklist: order, fulfillment, comms, policy acceptance",
        "Common reason codes (high level) tied to evidence types",
        "Link to issuer response and evidence checklist",
        "Link to pillar",
      ],
      cta_type: "free_trial",
      internal_links_out: [
        { target_slug: "shopify-chargebacks-practical-merchant-guide", anchor_suggestion: "Shopify chargebacks guide" },
        { target_slug: "shopify-issuer-response-won-or-lost", anchor_suggestion: "issuer response outcomes" },
        { target_slug: "shopify-chargeback-evidence-checklist", anchor_suggestion: "evidence checklist" },
      ],
      internal_links_in: [],
      cluster_rationale: "Claim phase is a distinct decision point in the cluster.",
    },
  },
  {
    priority_score: 997,
    page_role: "support",
    complexity: "medium",
    proposed_title: "Issuer Response in Shopify: Why You Won or Lost",
    proposed_slug: "shopify-issuer-response-won-or-lost",
    content_type: "cluster_article",
    target_keyword: "Shopify chargeback issuer response",
    search_intent: "informational",
    summary:
      "Decode won/lost outcomes in Shopify; next operational steps—separate from rebuttal letter template content.",
    brief: {
      page_title: "Issuer Response in Shopify: Why You Won or Lost",
      seo_title: "Issuer Response in Shopify: Won or Lost | DisputeDesk",
      suggested_slug: "shopify-issuer-response-won-or-lost",
      secondary_keywords: ["Shopify chargeback won", "Shopify chargeback lost", "chargeback outcome Shopify"],
      funnel_stage: "decision",
      audience: "Shopify merchants post-decision",
      article_angle:
        "Outcome-focused: what merchants should log, when to adjust policies, and when follow-up disputes may appear.",
      overlap_to_avoid: "Avoid pasting rebuttal letter templates; link to template article if exists instead.",
      outline: [
        "How Shopify surfaces issuer response",
        "Won: what to archive and communicate internally",
        "Lost: operational postmortem (not legal advice)",
        "Cross-link inquiry vs chargeback and issuer claim",
        "Link to pillar",
      ],
      cta_type: "newsletter",
      internal_links_out: [
        { target_slug: "shopify-chargebacks-practical-merchant-guide", anchor_suggestion: "practical Shopify chargeback guide" },
        { target_slug: "shopify-chargeback-inquiry-vs-chargeback", anchor_suggestion: "inquiry vs chargeback" },
        { target_slug: "shopify-issuer-claim-what-to-check", anchor_suggestion: "issuer claim checks" },
      ],
      internal_links_in: [],
      cluster_rationale: "Closes the loop on outcomes for merchant operations.",
    },
  },
  {
    priority_score: 996,
    page_role: "support",
    complexity: "medium",
    proposed_title: "Shopify Protect: What It Covers and What It Doesn’t",
    proposed_slug: "shopify-protect-coverage-limits",
    content_type: "cluster_article",
    target_keyword: "Shopify Protect chargebacks",
    search_intent: "informational",
    summary:
      "Merchant-realistic boundaries: what Shopify Protect changes vs what evidence merchants still need.",
    brief: {
      page_title: "Shopify Protect: What It Covers and What It Doesn’t",
      seo_title: "Shopify Protect & Chargebacks: Coverage | DisputeDesk",
      suggested_slug: "shopify-protect-coverage-limits",
      secondary_keywords: ["Shopify Protect disputes", "Shopify Protect eligibility"],
      funnel_stage: "awareness",
      audience: "Shopify merchants evaluating risk and dispute workload",
      article_angle: "Clear ‘in / out’ framing with operational implications for evidence habits.",
      overlap_to_avoid: "Not a marketing landing page; cite need to verify current program terms in Help Center without inventing rules.",
      outline: [
        "What merchants should assume Protect helps with",
        "Gaps: scenarios where merchants still need strong evidence",
        "How Protect interacts with chargeback workflow mentally (handoffs)",
        "Links to proof-of-delivery and evidence checklist",
        "Link to pillar",
      ],
      cta_type: "free_trial",
      internal_links_out: [
        { target_slug: "shopify-chargebacks-practical-merchant-guide", anchor_suggestion: "Shopify chargebacks guide" },
        { target_slug: "shopify-chargeback-proof-delivery-not-enough", anchor_suggestion: "proof of delivery limitations" },
        { target_slug: "shopify-chargeback-evidence-checklist", anchor_suggestion: "chargeback evidence checklist" },
      ],
      internal_links_in: [],
      cluster_rationale: "Product-trust topic tightly coupled to Shopify stack.",
    },
  },
  {
    priority_score: 995,
    page_role: "support",
    complexity: "medium",
    proposed_title: "Proof of Delivery Isn’t Always Enough in a Chargeback",
    proposed_slug: "shopify-chargeback-proof-delivery-not-enough",
    content_type: "cluster_article",
    target_keyword: "Shopify chargeback proof of delivery",
    search_intent: "informational",
    summary:
      "Why tracking + POD fails for certain reason codes; what to add in Shopify evidence—distinct from long evidence-pack article.",
    brief: {
      page_title: "Proof of Delivery Isn’t Always Enough in a Chargeback",
      seo_title: "Proof of Delivery & Shopify Chargebacks | DisputeDesk",
      suggested_slug: "shopify-chargeback-proof-delivery-not-enough",
      secondary_keywords: ["chargeback evidence delivery proof", "Shopify dispute tracking"],
      funnel_stage: "consideration",
      audience: "Shopify merchants relying heavily on carrier tracking",
      article_angle:
        "Reason-code aware: INR vs fraud vs SNAD — what beyond POD strengthens the case in practice.",
      overlap_to_avoid:
        "Do not rewrite how-to-build-chargeback-evidence-pack; this is shorter, reason-code grounded.",
      outline: [
        "When POD wins vs when it loses",
        "Add-ons: customer comms, device/IP signals if applicable, service delivery proof",
        "Shopify submission framing tips (merchant-operational)",
        "Link Visa CE 3.0 page and evidence checklist",
        "Link to pillar",
      ],
      cta_type: "demo_request",
      internal_links_out: [
        { target_slug: "shopify-chargebacks-practical-merchant-guide", anchor_suggestion: "Shopify chargebacks hub" },
        { target_slug: "visa-compelling-evidence-3-shopify-merchants", anchor_suggestion: "Visa Compelling Evidence 3.0" },
        { target_slug: "shopify-chargeback-evidence-checklist", anchor_suggestion: "evidence checklist" },
      ],
      internal_links_in: [],
      cluster_rationale: "Fills a common merchant misconception gap in the cluster.",
    },
  },
  {
    priority_score: 994,
    page_role: "support",
    complexity: "medium",
    proposed_title: "Visa Compelling Evidence 3.0 for Shopify Merchants",
    proposed_slug: "visa-compelling-evidence-3-shopify-merchants",
    content_type: "cluster_article",
    target_keyword: "Visa Compelling Evidence 3.0 Shopify",
    search_intent: "informational",
    summary:
        "CE 3.0 operationalized for Shopify merchants: what to collect and how it maps to dispute evidence—not a legal treatise.",
    brief: {
      page_title: "Visa Compelling Evidence 3.0 for Shopify Merchants",
      seo_title: "Visa Compelling Evidence 3.0 for Shopify | DisputeDesk",
      suggested_slug: "visa-compelling-evidence-3-shopify-merchants",
      secondary_keywords: ["Visa CE 3.0", "compelling evidence chargeback"],
      funnel_stage: "consideration",
      audience: "Shopify merchants fighting fraud and friendly fraud disputes",
      article_angle:
        "Field-level mindset: prior undisputed history, device identity, delivery — tied to merchant data Shopify stores or integrations.",
      overlap_to_avoid:
        "Avoid duplicating generic Visa PDF; stay practical and cite public Visa materials only; no invented thresholds.",
      outline: [
        "What CE 3.0 aims to solve (short)",
        "Merchant data sources commonly available on Shopify stacks",
        "Mapping to evidence checklist",
        "Link proof-of-delivery page and pillar",
      ],
      cta_type: "free_trial",
      internal_links_out: [
        { target_slug: "shopify-chargebacks-practical-merchant-guide", anchor_suggestion: "Shopify chargebacks guide" },
        { target_slug: "shopify-chargeback-evidence-checklist", anchor_suggestion: "Shopify evidence checklist" },
        { target_slug: "shopify-chargeback-proof-delivery-not-enough", anchor_suggestion: "proof of delivery limits" },
      ],
      internal_links_in: [],
      cluster_rationale: "Network-specific depth without leaving Shopify merchant context.",
    },
  },
  {
    priority_score: 993,
    page_role: "checklist",
    complexity: "medium",
    proposed_title: "Shopify Chargeback Evidence Checklist",
    proposed_slug: "shopify-chargeback-evidence-checklist",
    content_type: "cluster_article",
    target_keyword: "Shopify chargeback evidence checklist",
    search_intent: "transactional",
    summary:
      "Scannable checklist mapped to Shopify dispute submission—different format and intent from narrative evidence-pack article.",
    brief: {
      page_title: "Shopify Chargeback Evidence Checklist",
      seo_title: "Shopify Chargeback Evidence Checklist | DisputeDesk",
      suggested_slug: "shopify-chargeback-evidence-checklist",
      secondary_keywords: ["Shopify dispute evidence", "chargeback documents Shopify"],
      funnel_stage: "decision",
      audience: "Shopify merchants assembling a response under time pressure",
      article_angle:
        "Checklist / table first; optional short notes per row; CE 3.0 and POD pages as deep links.",
      overlap_to_avoid:
        "Explicitly differentiate from how-to-build-a-chargeback-evidence-pack: checklist vs narrative playbook.",
      outline: [
        "Printable-style checklist (HTML table)",
        "Reason-code tabs or sections (INR, fraud, SNAD high level)",
        "Cross-links: CE 3.0, POD limitations, issuer claim",
        "Link to pillar",
      ],
      cta_type: "free_trial",
      internal_links_out: [
        { target_slug: "shopify-chargebacks-practical-merchant-guide", anchor_suggestion: "Shopify chargebacks practical guide" },
        { target_slug: "visa-compelling-evidence-3-shopify-merchants", anchor_suggestion: "Visa Compelling Evidence 3.0" },
        { target_slug: "shopify-chargeback-proof-delivery-not-enough", anchor_suggestion: "when delivery proof is not enough" },
        { target_slug: "shopify-issuer-claim-what-to-check", anchor_suggestion: "issuer claim checks" },
      ],
      internal_links_in: [],
      cluster_rationale: "High-intent transactional page for the same cluster.",
    },
  },
];

async function main() {
  console.log("Shopify chargeback cluster — seeding content_archive_items\n");

  let inserted = 0;
  let skipped = 0;

  for (const p of PAGES) {
    const { data: existing, error: exErr } = await sb
      .from("content_archive_items")
      .select("id")
      .eq("proposed_slug", p.proposed_slug)
      .maybeSingle();

    if (exErr) {
      console.error("Lookup error", p.proposed_slug, exErr.message);
      process.exit(1);
    }

    if (existing) {
      console.log(`  skip (exists): ${p.proposed_slug}`);
      skipped += 1;
      continue;
    }

    const row = {
      proposed_title: p.proposed_title,
      proposed_slug: p.proposed_slug,
      target_locale_set: LOCALES,
      content_type: p.content_type,
      primary_pillar: "chargebacks",
      priority_score: p.priority_score,
      target_keyword: p.target_keyword,
      search_intent: p.search_intent,
      summary: p.summary,
      notes: briefNotes(p.brief),
      status: "backlog",
      page_role: p.page_role,
      complexity: p.complexity,
    };

    const { data, error } = await sb.from("content_archive_items").insert(row).select("id").single();

    if (error) {
      console.error("Insert failed", p.proposed_slug, error.message);
      process.exit(1);
    }

    console.log(`  inserted: ${p.proposed_slug}  id=${data.id}  priority=${p.priority_score}`);
    inserted += 1;
  }

  console.log(`\nDone. inserted=${inserted} skipped=${skipped}`);
  console.log("Next: enable Autopilot in Admin (or use run-autopilot-once.mjs) then:");
  console.log("  node scripts/run-autopilot-once.mjs");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
