/**
 * Template recommendation engine.
 *
 * Pure function — no DB or network calls.
 * Maps store profile + Shopify evidence config → recommended templates + evidence confidence.
 */

// ── Template IDs (deterministic UUIDs from migration 019) ──────────────

export const TEMPLATE_IDS = {
  fraud_standard: "a0000000-0000-0000-0000-000000000001",
  pnr_with_tracking: "a0000000-0000-0000-0000-000000000002",
  pnr_weak_proof: "a0000000-0000-0000-0000-000000000003",
  not_as_described_quality: "a0000000-0000-0000-0000-000000000004",
  subscription_canceled: "a0000000-0000-0000-0000-000000000005",
  credit_not_processed: "a0000000-0000-0000-0000-000000000006",
  duplicate_incorrect: "a0000000-0000-0000-0000-000000000007",
  digital_goods: "a0000000-0000-0000-0000-000000000008",
  policy_forward: "a0000000-0000-0000-0000-000000000009",
  general_catchall: "a0000000-0000-0000-0000-000000000010",
} as const;

export type TemplateSlug = keyof typeof TEMPLATE_IDS;

/**
 * Inquiry-phase template variants from migration 20260411150000.
 * These are installed silently alongside their chargeback siblings — merchants
 * never see them in the wizard UI. The runtime rules engine routes inquiry-
 * phase disputes to these via phase-aware rules written in
 * `replacePackBasedAutomationRules`.
 */
export const INQUIRY_TEMPLATE_IDS = {
  fraud_inquiry: "a0000000-0000-0000-0000-000000000011",
  pnr_inquiry: "a0000000-0000-0000-0000-000000000012",
  not_as_described_inquiry: "a0000000-0000-0000-0000-000000000013",
  subscription_inquiry: "a0000000-0000-0000-0000-000000000014",
  refund_inquiry: "a0000000-0000-0000-0000-000000000015",
  duplicate_inquiry: "a0000000-0000-0000-0000-000000000016",
  policy_forward_inquiry: "a0000000-0000-0000-0000-000000000017",
  general_inquiry: "a0000000-0000-0000-0000-000000000018",
} as const;

export const INQUIRY_TEMPLATE_ID_SET: ReadonlySet<string> = new Set(
  Object.values(INQUIRY_TEMPLATE_IDS)
);

/**
 * Map a chargeback template id to its paired inquiry template id.
 * `digital_goods` deliberately has no entry — there's no inquiry sibling for
 * digital goods (per migration 20260411150000); inquiries on digital products
 * fall back to `general_inquiry` via `reason_template_mappings`.
 */
export const CHARGEBACK_TO_INQUIRY_TEMPLATE: Readonly<Record<string, string>> = {
  [TEMPLATE_IDS.fraud_standard]: INQUIRY_TEMPLATE_IDS.fraud_inquiry,
  [TEMPLATE_IDS.pnr_with_tracking]: INQUIRY_TEMPLATE_IDS.pnr_inquiry,
  [TEMPLATE_IDS.pnr_weak_proof]: INQUIRY_TEMPLATE_IDS.pnr_inquiry,
  [TEMPLATE_IDS.not_as_described_quality]:
    INQUIRY_TEMPLATE_IDS.not_as_described_inquiry,
  [TEMPLATE_IDS.subscription_canceled]: INQUIRY_TEMPLATE_IDS.subscription_inquiry,
  [TEMPLATE_IDS.credit_not_processed]: INQUIRY_TEMPLATE_IDS.refund_inquiry,
  [TEMPLATE_IDS.duplicate_incorrect]: INQUIRY_TEMPLATE_IDS.duplicate_inquiry,
  [TEMPLATE_IDS.policy_forward]: INQUIRY_TEMPLATE_IDS.policy_forward_inquiry,
  [TEMPLATE_IDS.general_catchall]: INQUIRY_TEMPLATE_IDS.general_inquiry,
};

/**
 * Given a list of chargeback template ids the merchant has selected, return
 * the silent inquiry pairs that should be installed alongside them.
 */
export function inquiryPairsFor(
  chargebackTemplateIds: readonly string[]
): string[] {
  const pairs = new Set<string>();
  for (const id of chargebackTemplateIds) {
    const paired = CHARGEBACK_TO_INQUIRY_TEMPLATE[id];
    if (paired) pairs.add(paired);
  }
  return [...pairs];
}

const SLUG_TO_FAMILY: Record<TemplateSlug, string> = {
  fraud_standard: "fraud",
  pnr_with_tracking: "pnr",
  pnr_weak_proof: "pnr",
  not_as_described_quality: "not_as_described",
  subscription_canceled: "subscription",
  credit_not_processed: "refund",
  duplicate_incorrect: "duplicate",
  digital_goods: "digital",
  policy_forward: "general",
  general_catchall: "general",
};

// ── Evidence config types ──────────────────────────────────────────────

export type EvidenceBehavior = "always" | "when_present" | "review" | "off";

export interface ShopifyEvidenceConfig {
  orderDetails: EvidenceBehavior;
  customerAddress: EvidenceBehavior;
  fulfillmentRecords: EvidenceBehavior;
  trackingDetails: EvidenceBehavior;
  orderTimeline: EvidenceBehavior;
  refundHistory: EvidenceBehavior;
  notesMetadata: EvidenceBehavior;
}

export type EvidenceGroupId = keyof ShopifyEvidenceConfig;

export const EVIDENCE_GROUP_IDS: EvidenceGroupId[] = [
  "orderDetails",
  "customerAddress",
  "fulfillmentRecords",
  "trackingDetails",
  "orderTimeline",
  "refundHistory",
  "notesMetadata",
];

// ── Store profile input ────────────────────────────────────────────────

export type StoreType = "physical" | "digital" | "services" | "subscriptions";
export type ProofLevel = "always" | "sometimes" | "rarely";

export interface StoreProfileForRecommendation {
  storeTypes: StoreType[];
  deliveryProof: ProofLevel;
  digitalProof: string;
  shopifyEvidenceConfig: ShopifyEvidenceConfig;
}

// ── Recommendation output ──────────────────────────────────────────────

export interface TemplateRecommendation {
  slug: TemplateSlug;
  templateId: string;
  disputeFamily: string;
  reason: string;
  isDefault: boolean;
}

export type EvidenceConfidence = "high" | "medium" | "low";

// ── Default evidence config ────────────────────────────────────────────

export function getDefaultEvidenceConfig(
  storeTypes: StoreType[],
  deliveryProof: ProofLevel
): ShopifyEvidenceConfig {
  const hasPhysical = storeTypes.includes("physical");
  const hasStrongTracking = hasPhysical && deliveryProof !== "rarely";

  return {
    orderDetails: "always",
    customerAddress: "always",
    fulfillmentRecords: hasPhysical ? "when_present" : "off",
    trackingDetails: hasStrongTracking ? "when_present" : "off",
    orderTimeline: "when_present",
    refundHistory: "always",
    notesMetadata: "when_present",
  };
}

// ── Recommendation algorithm ───────────────────────────────────────────

export function recommendTemplates(
  profile: StoreProfileForRecommendation
): TemplateRecommendation[] {
  const selected = new Set<TemplateSlug>();
  const reasons = new Map<TemplateSlug, string>();

  function add(slug: TemplateSlug, reason: string) {
    if (!selected.has(slug)) {
      selected.add(slug);
      reasons.set(slug, reason);
    }
  }

  const { storeTypes, deliveryProof, shopifyEvidenceConfig: ec } = profile;

  // Always recommend fraud (universal)
  add("fraud_standard", "Fraud protection is essential for all stores");

  // Physical goods
  if (storeTypes.includes("physical")) {
    const trackingActive =
      ec.trackingDetails === "when_present" || ec.trackingDetails === "always";
    const hasTracking = trackingActive && deliveryProof !== "rarely";

    if (hasTracking) {
      add("pnr_with_tracking", "Strong shipping evidence from Shopify fulfillments");
    } else {
      add("pnr_weak_proof", "Limited tracking — uses available shipping records");
    }
    add("not_as_described_quality", "Covers product quality disputes for physical goods");
  }

  // Digital goods
  if (storeTypes.includes("digital")) {
    add("digital_goods", "Structures evidence for digital product disputes");
    add("not_as_described_quality", "Covers product description disputes");
    add("credit_not_processed", "Handles refund-related disputes for digital sales");
  }

  // Services
  if (storeTypes.includes("services")) {
    add("digital_goods", "Structures evidence for service delivery disputes");
    add("credit_not_processed", "Handles refund disputes for services");
  }

  // Subscriptions
  if (storeTypes.includes("subscriptions")) {
    add("subscription_canceled", "Covers subscription cancellation disputes");
  }

  // Always include catch-all
  add("general_catchall", "Fallback coverage for uncategorized dispute types");

  // Build full list: selected as isDefault:true, rest as isDefault:false
  const allSlugs = Object.keys(TEMPLATE_IDS) as TemplateSlug[];

  return allSlugs.map((slug) => ({
    slug,
    templateId: TEMPLATE_IDS[slug],
    disputeFamily: SLUG_TO_FAMILY[slug],
    reason: reasons.get(slug) ?? "",
    isDefault: selected.has(slug),
  }));
}

// ── Evidence confidence derivation ─────────────────────────────────────

export function deriveEvidenceConfidence(
  config: ShopifyEvidenceConfig
): EvidenceConfidence {
  const orderOk = config.orderDetails === "always";
  const refundOk = config.refundHistory === "always";
  const fulfillmentActive =
    config.fulfillmentRecords === "when_present" ||
    config.fulfillmentRecords === "always";
  const trackingActive =
    config.trackingDetails === "when_present" ||
    config.trackingDetails === "always";

  if (orderOk && refundOk && (fulfillmentActive || trackingActive)) {
    return "high";
  }

  if (orderOk) {
    return "medium";
  }

  return "low";
}
