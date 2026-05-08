/**
 * Three Tier A authority pillar briefs (PR 6 of the Resource Hub overhaul).
 *
 * These briefs are inserted into `content_archive_items` so the new generation
 * pipeline (PRs 2–5) produces them at Tier A depth (3500–6000 words), with the
 * authority_pillar archetype, holding the result at `in-editorial-review` for
 * human approval before publish (PR 5 safeguard).
 *
 * Insertion is idempotent — calling `upsertTierAPillarBriefs` twice returns
 * the same row IDs without duplicating rows. The seed script
 * (scripts/seed-tier-a-pillar-briefs.mjs) wraps this helper for CLI use.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";

export interface TierAPillarBrief {
  proposed_title: string;
  proposed_slug: string;
  primary_pillar: string;
  target_keyword: string;
  search_intent: "informational" | "commercial" | "transactional";
  summary: string;
  notes: string;
  /** All Tier A pillars target the full multi-locale set. */
  target_locale_set: string[];
}

const ALL_LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

/**
 * Brief-notes JSON fed to the prompt as structured editorial guidance.
 * The pipeline parses this in `parseArchiveNotesBriefFields` for the
 * page_role / complexity / target_word_range overrides; the rest is
 * surfaced verbatim to the model as authoring context.
 */
function notes(extra: {
  outline: string[];
  cta_type: string;
  page_title: string;
  seo_title: string;
  audience: string;
  shopify_specifics: string[];
  must_cover: string[];
}): string {
  return JSON.stringify(
    {
      brief_version: 1,
      cluster: "tier_a_authority_pillars_2026_05",
      page_role: "pillar",
      complexity: "high",
      target_word_range: "3800–5200 words",
      page_title: extra.page_title,
      seo_title: extra.seo_title,
      audience: extra.audience,
      shopify_specifics: extra.shopify_specifics,
      must_cover: extra.must_cover,
      outline: extra.outline,
      cta_type: extra.cta_type,
    },
    null,
    2
  );
}

export const TIER_A_PILLAR_BRIEFS: TierAPillarBrief[] = [
  {
    proposed_title: "Shopify Chargebacks: Complete Merchant Guide",
    proposed_slug: "shopify-chargebacks-complete-merchant-guide",
    primary_pillar: "chargebacks",
    target_keyword: "Shopify chargebacks",
    search_intent: "informational",
    summary:
      "Authority pillar: end-to-end Shopify chargeback handling from inquiry → claim → response → outcome. Cites Admin paths, Shopify Payments behaviour, response windows, and where automation does vs does not help. Tier A flagship.",
    target_locale_set: ALL_LOCALES,
    notes: notes({
      page_title: "Shopify Chargebacks: Complete Merchant Guide",
      seo_title: "Shopify Chargebacks: The Complete Merchant Guide | DisputeDesk",
      audience: "Shopify merchants using Shopify Payments or third-party gateways",
      shopify_specifics: [
        "Disputes section in Shopify Admin (Settings → Payments → Manage)",
        "Inquiry vs. chargeback distinction inside Shopify Admin",
        "Shopify Payments forwards the dispute within 24 hours of issuer filing",
        "10-day default response window in Shopify Payments (verify per dispute — issuer can shorten)",
        "Shopify Protect coverage gate (PROTECTED / ACTIVE statuses) where applicable",
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
    target_locale_set: ALL_LOCALES,
    notes: notes({
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
    target_locale_set: ALL_LOCALES,
    notes: notes({
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

export interface UpsertResult {
  inserted: Array<{ id: string; slug: string }>;
  updated: Array<{ id: string; slug: string }>;
}

/**
 * Idempotent insert: matches existing rows by `proposed_slug`. New rows get
 * Tier A flags + autopilot_approved=true so the autopilot picker can take
 * them (per PR 5 — pillars are skipped without explicit approval). Existing
 * rows are *updated in place* with the same flags so re-running picks up
 * any flag drift.
 */
export async function upsertTierAPillarBriefs(
  briefs: TierAPillarBrief[] = TIER_A_PILLAR_BRIEFS,
  sb: SupabaseClient = getServiceClient()
): Promise<UpsertResult> {
  const inserted: Array<{ id: string; slug: string }> = [];
  const updated: Array<{ id: string; slug: string }> = [];

  for (const brief of briefs) {
    const { data: existing, error: lookupErr } = await sb
      .from("content_archive_items")
      .select("id")
      .eq("proposed_slug", brief.proposed_slug)
      .maybeSingle();

    if (lookupErr) {
      throw new Error(
        `Lookup failed for slug "${brief.proposed_slug}": ${lookupErr.message}`
      );
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
      target_locale_set: brief.target_locale_set,
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
      const { error: updErr } = await sb
        .from("content_archive_items")
        .update(payload)
        .eq("id", existing.id);
      if (updErr) {
        throw new Error(
          `Update failed for slug "${brief.proposed_slug}": ${updErr.message}`
        );
      }
      updated.push({ id: existing.id, slug: brief.proposed_slug });
    } else {
      const { data: newRow, error: insErr } = await sb
        .from("content_archive_items")
        .insert(payload)
        .select("id")
        .single();
      if (insErr || !newRow) {
        throw new Error(
          `Insert failed for slug "${brief.proposed_slug}": ${insErr?.message ?? "no row returned"}`
        );
      }
      inserted.push({ id: newRow.id, slug: brief.proposed_slug });
    }
  }

  return { inserted, updated };
}
