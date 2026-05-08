/**
 * Idempotently inserts the three Tier A authority pillar briefs into
 * content_archive_items so the new generation pipeline (PRs 2–5) can produce
 * them at Tier A depth, holding output at `in-editorial-review`.
 *
 * Source of truth for the brief content: lib/resources/seeding/tierAPillarBriefs.ts
 * (this script duplicates the DATA so it can run as plain Node — the lib module
 * uses "server-only" + supabase server helpers and cannot be imported here).
 *
 * Usage:
 *   node scripts/seed-tier-a-pillar-briefs.mjs
 *
 * After seeding, trigger one autopilot tick (the picker will pick these first
 * because priority_score=1000 + autopilot_approved=true):
 *   node scripts/run-autopilot-once.mjs
 *
 * Tier A safeguard: per PR 5, generated pillars land at workflow_status
 * `in-editorial-review`. They will NOT auto-publish — admin must review first.
 *
 * Environment:
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
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

const ALL_LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

function notesJson(extra) {
  return JSON.stringify(
    {
      brief_version: 1,
      cluster: "tier_a_authority_pillars_2026_05",
      page_role: "pillar",
      complexity: "high",
      target_word_range: "3800–5200 words",
      ...extra,
    },
    null,
    2
  );
}

const BRIEFS = [
  {
    proposed_title: "Shopify Chargebacks: Complete Merchant Guide",
    proposed_slug: "shopify-chargebacks-complete-merchant-guide",
    primary_pillar: "chargebacks",
    target_keyword: "Shopify chargebacks",
    search_intent: "informational",
    summary:
      "Authority pillar: end-to-end Shopify chargeback handling from inquiry → claim → response → outcome. Cites Admin paths, Shopify Payments behaviour, response windows, and where automation does vs does not help. Tier A flagship.",
    notes: notesJson({
      page_title: "Shopify Chargebacks: Complete Merchant Guide",
      seo_title: "Shopify Chargebacks: The Complete Merchant Guide | DisputeDesk",
      audience: "Shopify merchants using Shopify Payments or third-party gateways",
      shopify_specifics: [
        "Disputes section in Shopify Admin (Settings → Payments → Manage)",
        "Inquiry vs. chargeback distinction inside Shopify Admin",
        "Shopify Payments forwards the dispute within 24 hours of issuer filing",
        "10-day default response window in Shopify Payments",
        "Shopify Protect coverage gate (PROTECTED / ACTIVE statuses)",
        "AVS / CVV result codes shown on the Order's payment summary",
      ],
      must_cover: [
        "Where in Shopify Admin a merchant sees a new dispute",
        "What 'submit response' actually does (writes evidence into Shopify, NOT to the network directly)",
        "Strong vs Moderate vs Weak evidence with concrete examples",
        "When to fight vs concede with a decision rule a merchant can apply",
        "Common mistakes that lose disputes (≥ 3 concrete failure modes)",
        "Where the rules vary: Shopify Payments vs Stripe vs other gateways",
      ],
      outline: [
        "What is a Shopify chargeback (and how it differs from an inquiry)",
        "The Shopify Admin path: where the dispute appears and what happens next",
        "Response windows and who decides the outcome",
        "Evidence quality: what counts as Strong, Moderate, Weak — with sample values",
        "Walked example: $189 fraud chargeback, evidence assembled, outcome",
        "Decision rule: when to fight vs concede",
        "Common merchant mistakes that lose otherwise winnable cases",
        "Where Shopify Payments differs from third-party gateways",
        "What automation does (DisputeDesk pack assembly) vs what it does not (network submission)",
      ],
      cta_type: "install",
    }),
  },
  {
    proposed_title: "Chargeback Evidence Guide for Shopify Merchants",
    proposed_slug: "chargeback-evidence-guide-shopify-merchants",
    primary_pillar: "evidence",
    target_keyword: "Shopify chargeback evidence",
    search_intent: "informational",
    summary:
      "Authority pillar on what evidence wins Shopify chargebacks: AVS, CVV, tracking, IP, 3-D Secure, signed delivery, screenshots, and how each maps to dispute reason families. Specifies exact Shopify fields and sample values.",
    notes: notesJson({
      page_title: "Chargeback Evidence Guide for Shopify Merchants",
      seo_title: "Chargeback Evidence Guide for Shopify Merchants | DisputeDesk",
      audience:
        "Shopify merchants assembling representment evidence; ops leads building evidence playbooks",
      shopify_specifics: [
        "Shopify Order's payment summary fields (AVS result, CVV result, last4, brand)",
        "OrderTransaction.receiptJson 3-D Secure flag (Shopify Payments only — provider-specific)",
        "Fulfillments.tracking_company / tracking_number on the Order",
        "Shopify Admin notes vs internal notes vs evidence-pack notes",
        "Customer email + display_name as it appears on the Order",
      ],
      must_cover: [
        "What each evidence type proves AND fails to prove",
        "Strong / Moderate / Weak band per evidence type with concrete sample wording",
        "Reason-family mapping: which evidence fights fraud, which fights INR, which fights subscription disputes",
        "The 3-D Secure trap: 3DS authenticated≠true is NEVER a negative signal; only confirmed=true is Strong",
        "Signed-delivery vs delivered-only: when each clears the bar",
      ],
      outline: [
        "What 'evidence' means inside Shopify (it's a structured payload, not a PDF)",
        "AVS and CVV: the four match codes that matter, sample values, common gotchas",
        "Tracking + signed delivery: when delivery alone is enough vs when you need a signature",
        "IP geolocation: useful corroborator, never decisive on its own",
        "3-D Secure: when it's Strong, when it's Moderate, why absence is silent",
        "Customer communication screenshots: what to capture and what to redact",
        "Mapping evidence to reason family: fraud, INR, subscription, unrecognized",
        "How DisputeDesk assembles the pack and where merchants take over",
        "Common mistakes that downgrade evidence",
      ],
      cta_type: "install",
    }),
  },
  {
    proposed_title: "Shopify Fraud Chargebacks Explained",
    proposed_slug: "shopify-fraud-chargebacks-explained",
    primary_pillar: "fraud",
    target_keyword: "Shopify fraud chargeback",
    search_intent: "informational",
    summary:
      "Authority pillar specifically on fraud-coded chargebacks (10.4 / fraud / unauthorized): how Shopify surfaces them, what evidence works, when prevention beats response, and the difference between true fraud and friendly fraud.",
    notes: notesJson({
      page_title: "Shopify Fraud Chargebacks Explained",
      seo_title: "Shopify Fraud Chargebacks Explained | DisputeDesk",
      audience:
        "Shopify merchants seeing repeated fraud-coded chargebacks; risk + ops teams setting policy",
      shopify_specifics: [
        "Shopify Order risk_level (high / medium / low) and risk_recommendation",
        "Shopify Protect coverage on eligible fraud disputes (when active)",
        "Reason family normalization: 10.4 / unauthorized → DisputeDesk's fraud bucket",
        "Where prevention lives in Shopify (checkout settings, Bogus Gateway test, manual review queues)",
      ],
      must_cover: [
        "What 'true fraud' looks like vs friendly fraud and how to tell from evidence",
        "Why Shopify Protect-covered disputes are Coverage Gate (skip representment)",
        "Evidence that wins true-fraud cases vs evidence that wins friendly-fraud cases",
        "When to concede a true-fraud chargeback (the math sometimes says yes)",
        "Common mistakes: relying on AVS Y alone, missing signed delivery, citing 3DS without verifying",
      ],
      outline: [
        "How fraud-coded chargebacks surface in Shopify Admin",
        "True fraud vs friendly fraud — how the evidence pattern differs",
        "Shopify Protect: when it covers you and what you do (or don't) need to submit",
        "Evidence that actually wins fraud cases (with examples)",
        "Prevention: how to reduce fraud chargebacks at the checkout layer",
        "Decision rule: fight, concede, or escalate",
        "Common mistakes merchants make on fraud cases",
        "What automation can and cannot do for fraud disputes",
      ],
      cta_type: "install",
    }),
  },
];

async function main() {
  console.log(`Seeding ${BRIEFS.length} Tier A pillar briefs…\n`);

  const inserted = [];
  const updated = [];

  for (const brief of BRIEFS) {
    const { data: existing, error: lookupErr } = await sb
      .from("content_archive_items")
      .select("id")
      .eq("proposed_slug", brief.proposed_slug)
      .maybeSingle();

    if (lookupErr) {
      console.error(`Lookup failed for ${brief.proposed_slug}: ${lookupErr.message}`);
      process.exit(1);
    }

    const payload = {
      proposed_title: brief.proposed_title,
      proposed_slug: brief.proposed_slug,
      primary_pillar: brief.primary_pillar,
      content_type: "pillar_page",
      target_keyword: brief.target_keyword,
      search_intent: brief.search_intent,
      summary: brief.summary,
      notes: brief.notes,
      target_locale_set: ALL_LOCALES,
      priority_score: 1000,
      status: "brief_ready",
      tier_override: "A",
      archetype: "authority_pillar",
      is_hub_article: true,
      autopilot_approved: true,
      page_role: "pillar",
      complexity: "high",
      target_word_range: "3800–5200 words",
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await sb
        .from("content_archive_items")
        .update(payload)
        .eq("id", existing.id);
      if (error) {
        console.error(`Update failed for ${brief.proposed_slug}: ${error.message}`);
        process.exit(1);
      }
      updated.push({ id: existing.id, slug: brief.proposed_slug });
      console.log(`  ↻ updated  ${brief.proposed_slug}  (${existing.id})`);
    } else {
      const { data: row, error } = await sb
        .from("content_archive_items")
        .insert(payload)
        .select("id")
        .single();
      if (error || !row) {
        console.error(`Insert failed for ${brief.proposed_slug}: ${error?.message}`);
        process.exit(1);
      }
      inserted.push({ id: row.id, slug: brief.proposed_slug });
      console.log(`  + inserted ${brief.proposed_slug}  (${row.id})`);
    }
  }

  console.log(`\nDone. Inserted: ${inserted.length}, Updated: ${updated.length}.`);
  console.log(`\nNext step: trigger one autopilot tick to generate the pillars:`);
  console.log(`  node scripts/run-autopilot-once.mjs`);
  console.log(`\nThe pipeline will hold the generated content_items at`);
  console.log(`workflow_status='in-editorial-review' (PR 5 Tier A safeguard).`);
  console.log(`Admin reviews and promotes from there.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
