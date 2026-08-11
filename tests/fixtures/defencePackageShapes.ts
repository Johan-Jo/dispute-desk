/**
 * The EXACT persisted shapes of `defence_packages.facts_json` and
 * `defence_packages.narrative_json`, as one shared fixture builder.
 *
 * WHY THIS EXISTS. The PR-C1 safety parser is only as good as what it is
 * tested against, and the second review found the tests were the weak half:
 * they blessed narratives with a single section and no `usedFactIds` as
 * "readable", so a parser that accepted shapes production has never held
 * looked correct. Fixtures scattered across five files also drifted from each
 * other and from the database.
 *
 * These builders emit the shape measured read-only in production at
 * 2026-08-07T17:55:11Z over all 280 candidates (241 non-null): every narrative
 * carries all nine sections plus `omittedSections` and `warnings`; every
 * section is exactly `{ text, usedFactIds }`; every fact object carries
 * exactly the thirteen `EvidenceFact` keys. Any test that needs a DIFFERENT
 * shape is testing a rejection, and should build it by mutating one of these.
 */

export const NARRATIVE_SECTION_KEYS = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
] as const;

export type NarrativeSectionKeyFixture = (typeof NARRATIVE_SECTION_KEYS)[number];

export interface NarrativeFixture {
  [key: string]: unknown;
  omittedSections: Array<{ sectionKey: string; reason: string }>;
  warnings: string[];
}

/**
 * A complete, structurally valid narrative. Pass prose for the sections you
 * care about; the rest render as the empty strings production also holds.
 */
export function narrativeJson(
  sections: Partial<Record<NarrativeSectionKeyFixture, string>> = {},
  extra: { omittedSections?: Array<{ sectionKey: string; reason: string }>; warnings?: string[] } = {},
): NarrativeFixture {
  const out: Record<string, unknown> = {};
  for (const key of NARRATIVE_SECTION_KEYS) {
    out[key] = { text: sections[key] ?? "", usedFactIds: [] };
  }
  out.omittedSections = extra.omittedSections ?? [];
  out.warnings = extra.warnings ?? [];
  return out as NarrativeFixture;
}

/** Ordinary carrier prose with no destination named — the safe baseline. */
export const CLEAN_NARRATIVE = narrativeJson({
  executiveSummary:
    "The carrier confirmed delivery of the shipment on 12 May 2026 (PostNord, tracking 1234567890).",
  fulfillmentArgument: "The carrier recorded a signature on delivery.",
});

/** An affirmative delivered-to-the-verified-address assertion. */
export const UNSAFE_NARRATIVE = narrativeJson({
  fulfillmentArgument:
    "The parcel was delivered to the cardholder's verified address on 12 May 2026.",
});

/** Address-delivery language the detector cannot resolve. Blocks. */
export const AMBIGUOUS_NARRATIVE = narrativeJson({
  fulfillmentArgument: "Delivery to the customer's address.",
});

/** The full 13-key persisted fact object. */
export function factJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "f1",
    category: "delivery_proof",
    label: "Delivery confirmation",
    source: "shopify_fulfillments",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    value: { proofType: "delivered_confirmed", carrier: "PostNord", trackingNumber: "1" },
    ...over,
  };
}

export const CLEAN_FACTS = [factJson()];

/** Carries the retired `deliveredToVerifiedAddress` boolean PR-C1 removes. */
export const RETIRED_FACTS = [
  factJson({ value: { proofType: "delivered_confirmed", deliveredToVerifiedAddress: true } }),
];


/* ── Pack sections that actually produce a bank-eligible fact ──────────
 *
 * The deadline-cron suites used to hand the route a `pack_json` with no
 * `sections` at all, because the placeholder selector never looked at one. The
 * REAL selector derives the current argument plan from exactly these rows, and
 * a pack with no sections yields no evidence records, no plan candidates and
 * therefore `no_safe_argument` — which would make every "IS filed" case fail
 * for a reason that has nothing to do with what it is testing.
 *
 * One delivery-proof section, carrier-confirmed. Enough for one included,
 * bank-citable fact and nothing more; a fixture that maximises evidence hides
 * which fact a rung actually turned on.
 */
export const DELIVERY_SECTION = {
  type: "fulfillment",
  label: "Delivery confirmation",
  source: "shopify_fulfillments",
  fieldsProvided: ["delivery_proof"],
  data: {
    proofType: "delivered_confirmed",
    carrier: "PostNord",
    trackingNumber: "1",
    deliveredAt: "2026-05-12T10:00:00.000Z",
    fulfillmentId: "gid://shopify/Fulfillment/1",
  },
};

/** `pack_json` for a healthy, strong, uncovered case with real evidence. */
export function healthyPackJson(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    case_strength: { overall: "strong" },
    coverage: { state: "not_covered" },
    fatal_loss: { triggered: false },
    sections: [DELIVERY_SECTION],
    ...over,
  };
}
