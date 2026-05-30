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

/** Rebase a fixture ISO string relative to today so urgency math + due
 *  countdowns look natural whenever the demo is viewed. */
const FIXTURE_ANCHOR = new Date("2026-01-15T10:00:00Z").getTime();
function rebase(iso: string): string {
  return new Date(Date.now() + (new Date(iso).getTime() - FIXTURE_ANCHOR)).toISOString();
}

// ── Per-dispute checklist + line items derived from fixture evidence ────────

const FIELD_ORDER = [
  "order_confirmation",
  "billing_address_match",
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
  billing_address_match: { label: "Billing address match", category: "order", priority: "critical" },
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
  "dp-2401": ["order_confirmation", "billing_address_match", "avs_cvv_match", "activity_log", "refund_policy", "shipping_policy", "shipping_tracking", "delivery_proof"],
  "dp-2402": ["order_confirmation", "billing_address_match", "shipping_tracking", "delivery_proof", "shipping_policy"],
  "dp-2403": ["order_confirmation", "billing_address_match", "avs_cvv_match", "activity_log", "refund_policy", "cancellation_policy"],
  "dp-2404": ["order_confirmation", "billing_address_match"], // Covered — minimal
  "dp-2405": ["order_confirmation", "refund_policy"], // Fatal loss — refund issued
  "dp-2406": ["order_confirmation", "billing_address_match", "avs_cvv_match"],
};

// ── Builders ────────────────────────────────────────────────────────────────

function buildChecklist(disputeId: string) {
  const present = new Set(FIELDS_PRESENT_BY_DISPUTE[disputeId] ?? []);
  return FIELD_ORDER.map((field) => {
    const meta = FIELD_META[field];
    const isPresent = present.has(field);
    return {
      field,
      label: meta.label,
      status: isPresent ? "available" : "missing",
      priority: meta.priority,
      blocking: false,
      source: isPresent ? "auto_shopify" : "manual_upload",
      collectionType: isPresent ? "auto" : "manual",
    };
  });
}

function buildEvidenceItems(disputeId: string) {
  const present = FIELDS_PRESENT_BY_DISPUTE[disputeId] ?? [];
  return present.map((field, idx) => ({
    id: `ev-${disputeId}-${idx}`,
    type: field,
    label: FIELD_META[field].label,
    source: "auto_shopify",
    payload: { fieldsProvided: [field] },
    created_at: rebase("2026-01-13T10:00:00Z"),
  }));
}

function buildEvidenceLineItems(disputeId: string) {
  return FIELD_ORDER.map((field) => {
    const meta = FIELD_META[field];
    const present = (FIELDS_PRESENT_BY_DISPUTE[disputeId] ?? []).includes(field);
    const isStrong = present && (field === "avs_cvv_match" || field === "delivery_proof" || field === "shipping_tracking");
    const isModerate = present && !isStrong;
    return {
      id: `li-${disputeId}-${field}`,
      field,
      label: meta.label,
      source: present ? "shopify" : "merchant_upload",
      hasEvidence: present,
      strengthContribution: isStrong ? "strong" : isModerate ? "moderate" : "none",
      bankEligible: present,
      merchantVisible: true,
      includedInDefencePackage: present,
      includedInBankArgument: present && (isStrong || isModerate),
      usedAsPositiveBankEvidence: present && (isStrong || isModerate),
      submittedToShopify: false,
      submissionMethod: present ? "bank_argument" : "not_included",
      isNegativeOrAmbiguous: false,
      reason: present ? `Captured from Shopify on ${new Date(rebase("2026-01-13T10:00:00Z")).toLocaleDateString("en-US")}` : "Not captured",
      reasonToken: { key: present ? "auto_captured" : "not_captured", params: {} },
      canBeForceIncluded: !present,
    };
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
    attachmentUploads: [],
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
    attachmentUploads: [],
  } : null;

  return {
    dispute,
    pack: coveredPack ?? pack,
    presentationStatus,
    evidenceLineItems: buildEvidenceLineItems(fixture.id),
    submissionSummary: buildSubmissionSummary(fixture.id, fixture.customerName),
    attachments: [],
    appliedRule: { mode: fixture.strength === "weak" ? "review" : "auto" },
    caseTypeInfo: {
      disputeType: reasonUpper,
      toWin: ["Show the cardholder authorised the transaction", "Demonstrate delivery to the registered address"],
      strongestEvidence: ["AVS/CVV verification", "Tracked delivery + signature", "3-D Secure authentication"],
    },
    fileEvidence: {
      flagEnabled: false,
      scopesGranted: true,
      missingScopes: [],
    },
    defencePackage: {
      latest: null,
      bankFacing: null,
      currentPromptVersion: 1,
    },
  };
}
