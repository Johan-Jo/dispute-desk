/**
 * Workspace fixtures — full WorkspaceData shape for each demo dispute.
 *
 * The embedded WorkspaceShell at `app/(embedded)/app/disputes/[id]/`
 * fetches `/api/disputes/[id]/workspace` and feeds the response through
 * `useDisputeWorkspace`. To render the real Polaris three-tab layout
 * (Overview, Evidence, Review & Submit) under /demo, we need to match
 * that exact response shape.
 *
 * Types are intentionally widened to `unknown` at the boundary because
 * importing the real WorkspaceData type pulls in a deep dependency tree.
 * Shapes are kept structurally accurate so the embedded code reads
 * them without crashing.
 */

import { DEMO_DISPUTES } from "./disputes";
import {
  computeContributions,
  calculateImprovement,
  type EvidencePayloadSource,
} from "@/lib/argument/caseStrength";
import { resolveReasonFamily } from "@/lib/argument/reasonFamily";
import { classifyEvidenceRow } from "@/lib/argument/categoryBadge";
import { CANONICAL_EVIDENCE, categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import { deriveEvidenceLineItems } from "@/lib/argument/evidenceLineItem";
import { deadlineFilingCopy, type DeadlineFilingState } from "@/lib/disputes/deadlineOnlyCopy";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import {
  emptyWorkspaceAssessment,
  type WorkspaceAssessmentPayload,
} from "@/lib/disputes/workspaceAssessmentTypes";
import type { CaseStrengthResult } from "@/lib/argument/types";

/** Rebase a fixture ISO string relative to today so urgency math + due
 *  countdowns look natural whenever the demo is viewed. */
const FIXTURE_ANCHOR = new Date("2026-01-15T10:00:00Z").getTime();
function rebase(iso: string): string {
  return new Date(Date.now() + (new Date(iso).getTime() - FIXTURE_ANCHOR)).toISOString();
}

// ── Per-dispute checklist + line items derived from fixture evidence ────────

const FIELD_ORDER = [
  "order_confirmation",
  "avs_cvv_match",
  "shipping_tracking",
  "delivery_proof",
  "customer_communication",
  "refund_policy",
  "shipping_policy",
  "cancellation_policy",
  "activity_log",
  "product_description",
  "supporting_documents",
  "duplicate_explanation",
] as const;

type FieldName = (typeof FIELD_ORDER)[number];

/** Per-field metadata: label + which evidence-category bucket it lives in. */
const FIELD_META: Record<FieldName, { label: string; category: string; priority: "critical" | "recommended" | "optional" }> = {
  order_confirmation: { label: "Order confirmation", category: "order", priority: "critical" },
  avs_cvv_match: { label: "AVS / CVV verification", category: "payment", priority: "critical" },
  shipping_tracking: { label: "Shipping tracking number", category: "fulfillment", priority: "critical" },
  delivery_proof: { label: "Delivery confirmation", category: "fulfillment", priority: "critical" },
  customer_communication: { label: "Customer communication", category: "communication", priority: "recommended" },
  refund_policy: { label: "Refund policy", category: "policy", priority: "recommended" },
  shipping_policy: { label: "Shipping policy", category: "policy", priority: "optional" },
  cancellation_policy: { label: "Cancellation policy", category: "policy", priority: "optional" },
  activity_log: { label: "Customer activity log", category: "identity", priority: "recommended" },
  product_description: { label: "Product description", category: "merchant", priority: "optional" },
  supporting_documents: { label: "Supporting documents", category: "merchant", priority: "optional" },
  duplicate_explanation: { label: "Duplicate explanation", category: "merchant", priority: "optional" },
};

/** Which fields each fixture dispute "has" evidence for. Drives both
 *  the checklist `status: "available"` flags and the per-row submission
 *  method. The rest render as `missing`. */
const FIELDS_PRESENT_BY_DISPUTE: Record<string, FieldName[]> = {
  "dp-2401": ["order_confirmation", "avs_cvv_match", "activity_log", "refund_policy", "shipping_policy", "shipping_tracking", "delivery_proof"],
  // Signed delivery + the logged-in-account/address-match signal its
  // narrative already cites ("Order placed by customer account").
  "dp-2402": ["order_confirmation", "shipping_tracking", "delivery_proof", "shipping_policy", "avs_cvv_match"],
  "dp-2403": ["order_confirmation", "avs_cvv_match", "activity_log", "refund_policy", "cancellation_policy"],
  "dp-2404": ["order_confirmation"], // Covered — minimal
  "dp-2405": ["order_confirmation", "refund_policy"], // Fatal loss — refund issued
  "dp-2406": ["order_confirmation", "avs_cvv_match"],
};

// ── Builders ────────────────────────────────────────────────────────────────

function buildChecklist(disputeId: string) {
  // Only emit `available` items — embedded UI's deriveMissingItems
  // helper calls `t("disputes.fieldAction.<field>.ctaLabel")` for any
  // `missing` row, but i18n only defines fieldAction for 4 fields
  // (supporting_documents, customer_communication, product_description,
  // duplicate_explanation). A `missing` row for any other field
  // crashes the page. Demo shows fully-built packs only — merchant
  // input flow lives on the weak dispute (dp-2406) which renders a
  // different surface.
  const present = FIELDS_PRESENT_BY_DISPUTE[disputeId] ?? [];
  return present.map((field) => {
    const meta = FIELD_META[field];
    return {
      field,
      label: meta.label,
      status: "available",
      priority: meta.priority,
      blocking: false,
      source: "auto_shopify",
      collectionType: "auto",
    };
  });
}

/** Per-field payload shapes fed to `categorizeEvidenceField`
 *  (lib/argument/canonicalEvidence.ts).
 *
 *  ── THESE DESCRIBE A CASE; THEY DO NOT TUNE AN OUTCOME ──────────────
 *
 *  An earlier version of this table set every promotable flag at once —
 *  `acceptedAtCheckout` on all three policies, `decisiveSessionProof` AND
 *  `digitalAccessUsed` on the activity log — because it was written to
 *  make the headline compute as Strong. The rubric duly promoted all of
 *  them, and "Evidence collected" rendered SIX Strong rows including two
 *  policy documents, which no real fraud case produces.
 *
 *  The rubric was right; the data was stacked. Payloads here describe
 *  what a plausible store would actually have, and the band is then
 *  whatever the production rubric says it is:
 *
 *    - Strong requires DECISIVE proof. For a physical-goods fraud case
 *      that is AVS/CVV match (rubric #1) and signature-confirmed delivery
 *      to the verified address (#2). Two decisive signals is what a strong
 *      fraud defence looks like.
 *    - A policy is Strong ONLY with `acceptedAtCheckout === true` plus an
 *      acceptance timestamp tying it to the order (#8). Publishing a
 *      refund policy is not the customer accepting one, so these carry
 *      policy text and land as `supporting`.
 *    - `activity_log` is Strong only on `decisiveSessionProof` (#4, login
 *      + consistent device/session/IP) or `digitalAccessUsed` (#7, a
 *      digital good). This is a shipped physical order, so neither holds
 *      and it lands as `supporting` — corroboration, not proof.
 *
 *  Do not add a flag here to move a band. Change the fixture's evidence
 *  list instead, and let the rubric answer.
 */
const STRONG_PAYLOADS: Record<string, Record<string, unknown>> = {
  // `network` matters: issuer CITATION is keyed on (network, code) per
  // register R-E (PR-C3), so an AVS "Y" with no network scores as a match
  // but is not citable — and the row lands `context_only`, never reaching
  // the bank argument. The demo dispute is a Visa (`cardNetwork` on the
  // dispute record), so the payload must say so too.
  avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M", network: "visa", fieldsProvided: ["avs_cvv_match"] },
  shipping_tracking: { proofType: "signature_confirmed", deliveredToVerifiedAddress: true, fieldsProvided: ["shipping_tracking"] },
  delivery_proof: { proofType: "signature_confirmed", deliveredToVerifiedAddress: true, fieldsProvided: ["delivery_proof"] },
  // Published policy text, not proof of acceptance → supporting (rubric #8).
  refund_policy: { policyText: "30-day returns on unworn items.", publishedAt: "2025-11-02T09:00:00Z", fieldsProvided: ["refund_policy"] },
  shipping_policy: { policyText: "Tracked delivery, 2-5 business days.", publishedAt: "2025-11-02T09:00:00Z", fieldsProvided: ["shipping_policy"] },
  cancellation_policy: { policyText: "Cancel before dispatch for a full refund.", publishedAt: "2025-11-02T09:00:00Z", fieldsProvided: ["cancellation_policy"] },
  // Account + session context on a PHYSICAL order: no decisive session
  // proof, no digital good → supporting (rubric #4 / #7).
  activity_log: { accountAgeDays: 412, priorOrders: 4, lastLoginAt: "2026-01-09T14:11:00Z", fieldsProvided: ["activity_log"] },
  customer_communication: { customerConfirmsOrder: true, fieldsProvided: ["customer_communication"] },
  customer_account_info: { priorUndisputedOrders: 4, totalOrders: 5, disputeFreeHistory: true, fieldsProvided: ["customer_account_info"] },
  order_confirmation: { fieldsProvided: ["order_confirmation"] },
  supporting_documents: { signedContract: true, fieldsProvided: ["supporting_documents"] },
  product_description: { fieldsProvided: ["product_description"] },
  duplicate_explanation: { fieldsProvided: ["duplicate_explanation"] },
};

/** Weak/ambiguous payload variants — used by dp-2406 (weak case demo)
 *  so the UI categorizes its evidence as `supporting`/`invalid`,
 *  driving `overall: "weak"` → heroVariant `hard_to_win`. */
const WEAK_PAYLOADS: Record<string, Record<string, unknown>> = {
  // No AVS code → invalid
  avs_cvv_match: { fieldsProvided: ["avs_cvv_match"] },
  // No proofType → invalid (label_created default)
  shipping_tracking: { fieldsProvided: ["shipping_tracking"] },
  delivery_proof: { fieldsProvided: ["delivery_proof"] },
  order_confirmation: { fieldsProvided: ["order_confirmation"] },
};

/**
 * Per-dispute payload overrides.
 *
 * The fixture narratives in `disputes.ts` already state facts the shared
 * default table cannot express — dp-2403's "Customer accepted terms on
 * Feb 14 2025" is a genuine `acceptedAtCheckout`, and its "January access
 * logs show 14 active sessions" is `digitalAccessUsed` on a subscription.
 * Encoding them here keeps the workspace checklist consistent with the
 * story the demo tells, instead of promoting policies on every case.
 */
const PAYLOAD_OVERRIDES: Record<string, Record<string, Record<string, unknown>>> = {
  // Subscription: terms genuinely accepted at signup (rubric #8), and a
  // digital service the customer kept using (rubric #7).
  "dp-2403": {
    cancellation_policy: {
      acceptedAtCheckout: true,
      acceptanceTimestamp: "2025-02-14T10:04:00Z",
      fieldsProvided: ["cancellation_policy"],
    },
    activity_log: {
      digitalAccessUsed: true,
      sessionsSinceLastCharge: 14,
      fieldsProvided: ["activity_log"],
    },
  },
};

function payloadFor(disputeId: string, field: string): Record<string, unknown> {
  const override = PAYLOAD_OVERRIDES[disputeId]?.[field];
  if (override) return override;
  const fixture = DEMO_DISPUTES.find((d) => d.id === disputeId);
  if (fixture?.strength === "weak") {
    return WEAK_PAYLOADS[field] ?? { fieldsProvided: [field] };
  }
  return STRONG_PAYLOADS[field] ?? { fieldsProvided: [field] };
}

function buildEvidenceItems(disputeId: string) {
  const present = FIELDS_PRESENT_BY_DISPUTE[disputeId] ?? [];
  return present.map((field, idx) => ({
    id: `ev-${disputeId}-${idx}`,
    type: field,
    label: FIELD_META[field].label,
    source: "auto_shopify",
    payload: payloadFor(disputeId, field),
    created_at: rebase("2026-01-13T10:00:00Z"),
  }));
}

/**
 * Evidence line items — built by the PRODUCTION derivation.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────
 *
 * `deriveEvidenceLineItems` is the single source of truth for per-row
 * state, and its own header names its consumers: the Overview tab's
 * "Evidence collected", the Evidence tab's package section, the Review
 * tab's "Inclusion review", and the Submission Summary panel.
 *
 * This fixture used to hand-roll the rows with a hardcoded
 * `isStrong = avs_cvv_match || delivery_proof || shipping_tracking`, and
 * every other row fell to `moderate`. Overview classifies from the payload
 * via `classifyEvidenceRow`, so the tabs disagreed on FOUR of dp-2401's
 * seven rows — Overview said `supporting` where Evidence and Review said
 * `moderate`. Three tabs, three answers, for the same evidence.
 *
 * That is precisely the class of defect the canonical-pipeline work exists
 * to prevent, reproduced inside the demo by a third hand-written
 * restatement of the rubric. Deriving the rows means the four surfaces
 * cannot disagree, because there is only one computation left.
 */
function buildEvidenceLineItems(disputeId: string): ReturnType<typeof deriveEvidenceLineItems> {
  const fixture = DEMO_DISPUTES.find((d) => d.id === disputeId);
  const present = FIELDS_PRESENT_BY_DISPUTE[disputeId] ?? [];
  const checklist = buildChecklist(disputeId) as unknown as ChecklistItemV2[];
  const reason = (fixture?.reasonFamily ?? "general").toUpperCase();

  // `facts` mirrors what the defence classifier would emit for these rows.
  // Strength comes from the canonical categorizer — never a second opinion.
  const facts = present.map((field) => {
    const payload = payloadFor(disputeId, field);
    const category = categorizeEvidenceField(field, payload);
    return {
      id: `fact-${disputeId}-${field}`,
      category: (CANONICAL_EVIDENCE[field]?.signalId ?? field) as never,
      label: FIELD_META[field].label,
      value: payload,
      source: "shopify_order",
      sourceRef: null,
      strength: category,
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: true,
      submissionRisk: false,
      confidence: null,
    };
  }) as never;

  return deriveEvidenceLineItems({
    checklist,
    facts,
    payloadByField: new Map(present.map((f) => [f, payloadFor(disputeId, f)])),
    contributions: computeContributions({
      checklist,
      payloadSource: {
        kind: "byField",
        map: Object.fromEntries(
          present.map((f) => [f, { payload: payloadFor(disputeId, f) }]),
        ),
      },
      reason,
    }),
    packSavedToShopify: false,
    excludedFields: new Set(),
    attachmentUploadFailures: new Map(),
    inclusionOverrides: new Map(),
    reasonFamily: resolveReasonFamily(reason),
  });
}

function buildSubmissionSummary(disputeId: string, customerName: string) {
  const lis = buildEvidenceLineItems(disputeId);
  const positiveCount = lis.filter((li) => li.usedAsPositiveBankEvidence).length;
  const contextCount = lis.filter((li) => li.includedInDefencePackage && !li.usedAsPositiveBankEvidence).length;
  const excludedCount = lis.filter((li) => !li.includedInDefencePackage).length;
  const [first, ...rest] = customerName.split(" ");
  return {
    pdfFileName: `dispute-${disputeId}-defence.pdf`,
    shopifyStructuredFields: [
      { field: "customer_first_name", value: first ?? null },
      { field: "customer_last_name", value: rest.join(" ") || null },
      { field: "customer_email", value: `${(first ?? "customer").toLowerCase()}@example.com` },
    ],
    factsInPdf: lis
      .filter((li) => li.includedInDefencePackage)
      .map((li) => ({ field: li.field, label: li.label, categoryLabel: FIELD_META[li.field as FieldName]?.category ?? "general" })),
    counts: {
      usedAsPositiveBankArgument: positiveCount,
      contextOnly: contextCount,
      internalOnly: 0,
      excluded: excludedCount,
      notSupported: 0,
      failedUpload: 0,
      waived: 0,
    },
  };
}

// ── CP-A workspace assessment ───────────────────────────────────────────────

/**
 * The `workspaceAssessment` payload (CP-A).
 *
 * ── WHY THE DEMO WENT BLANK WITHOUT THIS ──────────────────────────────
 *
 * CP-A moved assessment out of the browser and onto the server. The hook now
 * reads exactly one key — `data.workspaceAssessment` — and treats its absence
 * as `needsRecalculation` (useDisputeWorkspace.ts:1037). That is correct: a
 * response with no assessment is a case nothing has judged, and
 * `resolveAssessmentGate` then refuses to render a verdict, a recommendation
 * or a filing action (lib/disputes/assessmentPresence.ts).
 *
 * This fixture predated that change and emitted no such key, so every demo
 * dispute rendered as un-assessed: an empty Review & Submit tab with no
 * strength, no evidence summary and no CTA. Nothing was broken in the product
 * — the demo was simply speaking the pre-CP-A contract.
 *
 * ── WHAT IS DERIVED VS DECLARED ───────────────────────────────────────
 *
 * `contributions` and `improvement` are computed by the PRODUCTION helpers
 * over the same checklist the pack carries, so "what supports your case"
 * lists real signals with real i18n tokens rather than a hand-copied array
 * that would drift the moment a signal is renamed. Only the band and the
 * score are declared, because the demo's whole point is to show a chosen
 * case shape — and the real scorer's inputs (gates, snapshots, hashes) do not
 * exist for a fixture.
 */
function buildWorkspaceAssessmentFixture(
  disputeId: string,
  opts: {
    checklist: ChecklistItemV2[];
    /**
     * The per-field evidence payloads.
     *
     * REQUIRED, not optional. `categorizeEvidenceField` reads the payload to
     * decide strong/moderate — an AVS row with no `avsResultCode` is
     * `invalid`, not strong. Omitting this returned an EMPTY "what supports
     * your case" list while every other number looked right, which is the
     * quietest possible way for the demo to be wrong.
     */
    payloadSource: EvidencePayloadSource;
    reason: string;
    strength: (typeof DEMO_DISPUTES)[number]["strength"];
    strengthScore: number;
    readiness: string;
    isSubmitted: boolean;
  },
): WorkspaceAssessmentPayload {
  const { checklist, payloadSource, reason, strength, strengthScore, readiness, isSubmitted } = opts;

  /* ── Covered and fatal-loss are genuinely NOT ASSESSED ──────────────
   *
   * Both short-circuit before scoring in the real pipeline (Coverage Gate,
   * PRD §4; Fatal-loss Gate, §5) and neither has a pack, so no snapshot
   * exists to render. Declaring `needsRecalculation: false` with the
   * scorer's `insufficient` sentinel would state that we assessed these
   * cases and judged them unwinnable — which is precisely the defect
   * `assessmentPresence` was written to stop, reproduced in the demo.
   *
   * `emptyWorkspaceAssessment` is the production shape for this state, so
   * the demo shows the same "not assessed yet" surface a merchant would see.
   */
  if (strength === "covered" || strength === "fatal_loss") {
    return emptyWorkspaceAssessment(disputeId);
  }

  const family = resolveReasonFamily(reason);

  /* Counts come from the PRODUCTION classifier, deduped by `signalId` the
   * way the scorer dedupes — `shipping_tracking` and `delivery_proof` are
   * both the `delivery` signal and must count ONCE, not twice.
   *
   * The previous version hardcoded a three-field "strong" set, which is a
   * restatement of the rubric that cannot be kept in sync with it. That is
   * the same drift class as the missing keys this file was fixed for. */
  const byCategory = new Map<string, "strong" | "moderate">();
  for (const c of checklist) {
    const spec = CANONICAL_EVIDENCE[c.field];
    if (!spec) continue;
    const cls = classifyEvidenceRow({
      fieldKey: c.field,
      status: c.status,
      payload: payloadFor(disputeId, c.field),
    });
    if (cls.category !== "strong" && cls.category !== "moderate") continue;
    const prev = byCategory.get(spec.signalId);
    if (prev !== "strong") byCategory.set(spec.signalId, cls.category);
  }
  const counts = [...byCategory.values()];
  const strongCount = counts.filter((c) => c === "strong").length;
  const moderateCount = counts.filter((c) => c === "moderate").length;

  /* ── The band is DERIVED, and the fixture's own label is checked ────
   *
   * Applying the scorer's count rule (`caseStrength.ts` — 2 strong for
   * `strong`; the fraud and delivery families each reach `moderate` on one
   * decisive signal) means a fixture cannot advertise a band its evidence
   * does not support. dp-2403 previously declared "strong" on a single
   * strong signal purely because the fixture said so.
   *
   * The mismatch throws rather than silently correcting: a fixture whose
   * label and evidence disagree is an authoring mistake, and quietly
   * rendering the derived value would hide it exactly the way the missing
   * `workspaceAssessment` key was hidden.
   */
  const derived: CaseStrengthResult["overall"] =
    strongCount >= 2
      ? "strong"
      : strongCount === 1 && moderateCount >= 1
        ? "moderate"
        : strongCount === 1 && (family === "fraud" || family === "delivery")
          ? "moderate"
          : moderateCount >= 2
            ? "moderate"
            : "weak";

  if (derived !== strength) {
    throw new Error(
      `Demo fixture ${disputeId} declares strength "${strength}" but its evidence ` +
        `derives "${derived}" (${strongCount} strong / ${moderateCount} moderate signals). ` +
        `Fix the fixture's evidence list or its strength label — do not add payload ` +
        `flags to force a band.`,
    );
  }
  const band: CaseStrengthResult["overall"] = derived;

  const caseStrength: CaseStrengthResult = {
    overall: band,
    // Plan v3 §P2.1 weights — keep the demo consistent with the real formula
    // rather than inventing a number that the weights would not produce.
    score: strongCount * 3 + moderateCount * 2,
    coveragePercent: strengthScore,
    strongCount,
    moderateCount,
    supportingCount: 0,
    supportedClaims: strongCount + moderateCount,
    totalClaims: FIELD_ORDER.length,
    strengthReasonI18n: { key: `disputes.strengthReason.${family}.${band}` },
    improvementHintI18n: null,
    heroVariant:
      band === "strong" ? "likely_to_win" : band === "moderate" ? "could_win" : "hard_to_win",
  };

  // Nothing in the demo is held for the deadline — the fixtures are either
  // fileable now or already sent. `normal` is the state that says so.
  const filingState: DeadlineFilingState = { kind: "normal" };

  return {
    caseStrength,
    assessment: {
      caseId: disputeId,
      needsRecalculation: false,
      recalculationReason: null,
      strengthBand: band,
      completenessScore: strengthScore,
      readiness: readiness as WorkspaceAssessmentPayload["readiness"],
      reviewItems: [],
    },
    filing: { ...deadlineFilingCopy(filingState), state: filingState },
    readiness: (isSubmitted ? "submitted" : readiness) as WorkspaceAssessmentPayload["readiness"],
    blockerCount: 0,
    warningCount: 0,
    submitOverrideGaps: [],
    // Production helpers — see the header. Not hand-written arrays.
    contributions: computeContributions({ checklist, payloadSource, reason }),
    improvement: calculateImprovement(checklist, reason, payloadSource),
  };
}

// ── Workspace builder ───────────────────────────────────────────────────────

export function buildWorkspaceData(disputeId: string) {
  const fixture = DEMO_DISPUTES.find((d) => d.id === disputeId);
  if (!fixture) return null;

  const reasonUpper = fixture.reasonFamily.toUpperCase();
  const isCovered = fixture.status === "covered";
  const isBlocked = fixture.status === "blocked";

  // Map fixture strength → SubmissionReadiness for the pack
  const submissionReadiness =
    fixture.strength === "strong" ? "ready"
    : fixture.strength === "moderate" ? "ready_with_warnings"
    : fixture.strength === "weak" ? "blocked"
    : isCovered ? "ready"
    : "blocked";

  // Map dispute status → PresentationStatus
  const presentationStatus = isCovered ? "DRAFT" : isBlocked ? "DRAFT" : "DRAFT";

  const dispute = {
    id: fixture.id,
    reason: reasonUpper,
    reasonFamily: reasonUpper,
    phase: "chargeback",
    amount: fixture.amount,
    currency: fixture.currency,
    orderName: fixture.orderName,
    orderGid: `gid://shopify/Order/${fixture.orderName.replace("#", "")}`,
    customerName: fixture.customerName,
    shopId: "demo",
    shopDomain: "demo-store.myshopify.com",
    disputeGid: `gid://shopify/Dispute/${fixture.id}`,
    disputeEvidenceGid: `gid://shopify/DisputeEvidence/${fixture.id}`,
    dueAt: rebase(fixture.dueAt),
    openedAt: rebase(fixture.openedAt),
    normalizedStatus:
      fixture.status === "covered" ? "needs_review" :
      fixture.status === "blocked" ? "action_needed" :
      fixture.status,
    submissionState: "not_saved",
    submittedAt: null,
    finalOutcome: null,
    cardNetwork: "Visa",
    cardLast4: "4242",
    transactionDate: rebase("2026-01-09T14:23:00Z"),
    paymentGateway: "Shopify Payments",
    financialStatus: "paid",
    fulfillmentStatus: isCovered || isBlocked ? "unfulfilled" : "fulfilled",
    cardholderName: fixture.customerName,
    timelineEvents: fixture.timeline.map((t) => ({ at: rebase(t.at), text: t.label })),
  };

  const pack = isCovered || isBlocked ? null : {
    id: `pack-${fixture.id}`,
    status: "ready",
    completenessScore: fixture.strengthScore,
    submissionReadiness,
    checklistV2: buildChecklist(fixture.id),
    waivedItems: [],
    evidenceItems: buildEvidenceItems(fixture.id),
    evidenceItemsByField: Object.fromEntries(
      buildEvidenceItems(fixture.id).map((e) => [e.type, e]),
    ),
    auditEvents: fixture.timeline.map((t, i) => ({
      id: `audit-${fixture.id}-${i}`,
      event_type: "system_event",
      event_payload: { label: t.label },
      actor_type: "system",
      created_at: rebase(t.at),
    })),
    pdfPath: `/api/packs/pack-${fixture.id}/download`,
    savedToShopifyAt: null,
    updatedAt: rebase("2026-01-13T11:00:00Z"),
    rebuildPending: false,
    lastRebuildOutcome: null,
    lastRebuildAt: null,
    lastRebuildReason: null,
    activeBuildJob: null,
    failureCode: null,
    failureReason: null,
    coverage: {
      state: "not_covered",
      shopifyProtectStatus: "NOT_PROTECTED",
    },
  };

  // Coverage gate (PRD §4): override pack.coverage when fixture is covered
  const coveredPack = isCovered ? {
    id: `pack-${fixture.id}`,
    status: "ready",
    completenessScore: 100,
    submissionReadiness: "ready",
    checklistV2: [],
    waivedItems: [],
    evidenceItems: [],
    evidenceItemsByField: {},
    auditEvents: [],
    pdfPath: null,
    savedToShopifyAt: null,
    updatedAt: rebase("2026-01-13T11:00:00Z"),
    rebuildPending: false,
    lastRebuildOutcome: null,
    lastRebuildAt: null,
    lastRebuildReason: null,
    activeBuildJob: null,
    failureCode: null,
    failureReason: null,
    coverage: {
      state: "covered_shopify",
      shopifyProtectStatus: "PROTECTED",
    },
  } : null;

  const activePack = coveredPack ?? pack;

  return {
    dispute,
    pack: activePack,
    presentationStatus,
    // CP-A — without this key every tab renders `not_assessed`. See
    // buildWorkspaceAssessmentFixture above.
    workspaceAssessment: buildWorkspaceAssessmentFixture(fixture.id, {
      checklist: (activePack?.checklistV2 ?? []) as unknown as ChecklistItemV2[],
      payloadSource: {
        kind: "byField",
        map: (activePack?.evidenceItemsByField ?? {}) as EvidencePayloadSource extends {
          kind: "byField";
          map: infer M;
        }
          ? M
          : never,
      },
      reason: reasonUpper,
      strength: fixture.strength,
      strengthScore: fixture.strengthScore,
      readiness: submissionReadiness,
      isSubmitted: fixture.status === "submitted",
    }),
    evidenceLineItems: buildEvidenceLineItems(fixture.id),
    submissionSummary: buildSubmissionSummary(fixture.id, fixture.customerName),
    attachments: [],
    appliedRule: { mode: fixture.strength === "weak" ? "review" : "auto" },
    caseTypeInfo: {
      disputeType: reasonUpper,
      toWin: ["Show the cardholder authorised the transaction", "Demonstrate delivery to the registered address"],
      strongestEvidence: ["AVS/CVV verification", "Tracked delivery + signature", "3-D Secure authentication"],
    },
    defencePackage: {
      // Minimal but complete DefencePackageRow so CompleteDefencePackageCard
      // mounts. Shape mirrors the interface defined in
      // app/(embedded)/app/disputes/[id]/tabs/sections/CompleteDefencePackageCard.tsx.
      // Skip for covered/blocked disputes — card hides itself for those.
      latest: isCovered || isBlocked ? null : {
        id: `pkg-${fixture.id}`,
        version: 1,
        status: "draft",
        package_mode: "full",
        generated_at: rebase("2026-01-13T11:30:00Z"),
        generated_by: "system",
        // Static sample PDF under /public — regenerate with
        // `node scripts/generate-demo-defence-pdf.mjs`. The card's
        // "View PDF" is a real link navigation (not fetch), so it
        // bypasses the fetch shim; on shopId==="demo" the card links
        // straight to this path instead of the real preview route
        // (which 401s on demo shop context).
        pdf_path: "/demo/defence-package-sample.pdf",
        evidence_hash: `hash-${fixture.id}`,
        llm_model: "claude-opus-4-7",
        prompt_family: "fraud_v3",
        prompt_version: 1,
        reason_code_module: reasonUpper.toLowerCase(),
        validation_status: "ok",
        validation_errors: [],
        failure_code: null,
        failure_reason: null,
        submitted_at: null,
        narrative_json: null,
        facts_json: null,
      },
      bankFacing: null,
      currentPromptVersion: 1,
    },
  };
}
