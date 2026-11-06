/**
 * A synthetic workspace payload (no real customer data) with the shape the
 * dispute record reads: one open dispute with a prepared defence package on
 * Auto-pilot. `workspaceVariant` derives every other state from it by changing
 * the fields that state is defined by.
 */
import type { WorkspaceWithPatterns } from "../../app/(embedded)/app/disputes/[id]/record/recordInputs";

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

const SHIP = {
  proofType: "delivered_confirmed",
  deliveredAt: "2026-10-25T19:33:59Z",
  signedByName: null,
  fulfillments: [
    {
      createdAt: "2026-10-16T14:42:47Z",
      deliveredAt: "2026-10-25T19:33:59Z",
      tracking: [{ number: "TRK12345", carrier: "Northwind Express", url: "https://example.test/t" }],
    },
  ],
};

function item(field: string, payload: Record<string, unknown>) {
  return { id: field, type: "other", label: field, source: "shopify", payload, confidence: null, created_at: "2026-11-06T04:32:42Z" };
}

export function openWorkspace(): WorkspaceWithPatterns {
  const facts: Record<string, Record<string, unknown>> = {
    order_confirmation: {
      createdAt: "2026-10-14T00:23:53Z",
      financialStatus: "PAID",
      fulfillmentStatus: "FULFILLED",
      totals: { total: "79.27", currency: "USD", refunded: "0.0", presentment: { total: "112.7", currency: "CAD" } },
      billingAddress: { city: "Springfield", zipPrefix: "123", countryCode: "CA", provinceCode: "NS" },
      shippingAddress: { city: "Springfield", zipPrefix: "123", countryCode: "CA", provinceCode: "NS" },
    },
    avs_cvv_match: { cardholderName: "Sam Roe", avsResultCode: "Y", cvvResultCode: "M", cardCompany: "Mastercard", lastFour: "7323", gateway: "shopify_payments" },
    fraud_risk_screening: { recommendation: "ACCEPT", riskLevel: "LOW" },
    ip_location_check: { locationMatch: "same_country", ipinfo: { privacy: { vpn: false, proxy: false, hosting: false } } },
    shipping_tracking: SHIP,
    delivery_proof: SHIP,
    customer_account_info: { priorUndisputedOrders: 0, totalOrders: 1 },
  };
  const line = (field: string, method: string, strength: string, hasEvidence = true) => ({
    id: `line:${field}`,
    field,
    label: field,
    hasEvidence,
    strengthContribution: strength,
    submissionMethod: method,
  });
  const evidenceItemsByField: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(facts)) evidenceItemsByField[k] = item(k, v);

  const pkg = {
    id: "pkg-1",
    version: 1,
    status: "final",
    generated_at: "2026-11-06T04:32:48Z",
    validation_status: "ok",
    pdf_path: "x/y.pdf",
    narrative_json: null,
    facts_json: [],
  };

  const data = {
    dispute: {
      id: "11111111-1111-1111-1111-111111111111",
      reason: "FRAUDULENT",
      phase: "chargeback",
      amount: 112.67,
      currency: "CAD",
      orderName: "#1001",
      orderGid: "gid://shopify/Order/1",
      customerName: "Alex Doe",
      shopDomain: "example.myshopify.com",
      disputeGid: "gid://shopify/ShopifyPaymentsDispute/1",
      disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/1",
      dueAt: "2026-12-14T23:00:00+00:00",
      openedAt: "2026-11-06T03:08:15+00:00",
      normalizedStatus: "new",
      submissionState: "not_saved",
      submittedAt: null,
      finalOutcome: null,
      closedAt: null,
      cardNetwork: "Mastercard",
      cardLast4: "7323",
      cardholderName: "Sam Roe",
      paymentGateway: "Shopify Payments",
      responseCycle: 1,
      orderSituation: { returns: "none", refund: "none", returnOpenedAt: null, asOf: "2026-11-06T04:32:45Z" },
      timelineEvents: [{ at: "2026-11-06T04:31:52Z", text: "The customer opened a chargeback totaling $112.67 CAD + $15.00 USD." }],
    },
    pack: {
      id: "pack-1",
      status: "ready",
      evidenceItems: [],
      evidenceItemsByField,
      savedToShopifyAt: null,
      rebuildPending: false,
      activeBuildJob: null,
      failureCode: null,
      coverage: { state: "not_covered", isCovered: false, shopifyProtectStatus: "INACTIVE" },
    },
    presentation: {
      lifecycle: "pack_prepared",
      attention: "none",
      strength: "strong",
      editable: true,
      terminal: false,
      outcome: "pending",
      automationMode: "auto",
    },
    appliedRule: { mode: "auto" },
    held: { held: false },
    gorgiasComms: { integrationStatus: "connected", latestRun: { status: "no_matches" } },
    workspaceAssessment: { caseStrength: { fatalLoss: { triggered: false, reason: null } } },
    decidedView: null,
    evidenceLineItems: [
      line("avs_cvv_match", "context_only", "strong"),
      line("tds_authentication", "not_included", "none", false),
      line("fraud_risk_screening", "bank_argument", "moderate"),
      line("order_confirmation", "context_only", "supporting"),
      line("ip_location_check", "bank_argument", "moderate"),
      line("customer_communication", "not_included", "none", false),
      line("shipping_tracking", "bank_argument", "moderate"),
      line("no_return_initiated", "bank_argument", "moderate"),
      line("activity_log", "context_only", "supporting"),
      line("shipping_policy", "context_only", "supporting"),
      line("refund_policy", "context_only", "supporting"),
      line("cancellation_policy", "context_only", "supporting"),
    ],
    defencePackage: { latest: pkg, bankFacing: null, currentPromptVersion: 1, building: false, safety: { blocked: false, reasons: [], message: "" } },
    recordStorePatterns: { baseRate: { won: 49, decided: 354 }, patterns: {} },
  };
  return data as unknown as WorkspaceWithPatterns;
}

/** Every dispute state the page can show, derived from the open fixture. */
export function workspaceVariant(name: string): WorkspaceWithPatterns {
  const w = clone(openWorkspace()) as unknown as Record<string, any>;
  const decide = (outcome: "won" | "lost", responder: string) => {
    w.dispute.normalizedStatus = outcome;
    w.dispute.finalOutcome = outcome;
    w.dispute.closedAt = "2026-10-11T00:13:55+00:00";
    w.presentation = { ...w.presentation, lifecycle: outcome, outcome, terminal: true, editable: false };
    const facts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(w.pack.evidenceItemsByField)) facts[k] = (v as { payload: unknown }).payload;
    w.decidedView = {
      outcome,
      phase: w.dispute.phase,
      reason: w.dispute.reason,
      amount: w.dispute.amount,
      currency: w.dispute.currency,
      openedAt: w.dispute.openedAt,
      dueAt: w.dispute.dueAt,
      closedAt: w.dispute.closedAt,
      response: { filedAt: responder === "we" ? "2026-12-14T08:00:00Z" : null, sentAt: responder === "shopify" ? "2026-12-14T09:00:00Z" : null, closedAt: w.dispute.closedAt, decidedBeforeDeadline: false, holdReason: null, responder },
      order: { createdAt: "2026-10-14T00:23:53Z", fulfillmentStatus: "FULFILLED", fulfilledAt: "2026-10-16T14:42:47Z", cancelledAt: null, riskRecommendation: "ACCEPT" },
      lineItems: [],
      facts,
      fatalLossReason: null,
      firstPackAt: null,
      events: [],
      storePatterns: { baseRate: { won: 49, decided: 354 }, patterns: {} },
    };
    if (responder === "we") {
      w.defencePackage.bankFacing = { ...w.defencePackage.latest, status: "submitted", version: 3, facts_json: [] };
    }
  };
  switch (name) {
    case "prepared":
      break;
    case "no_pack":
      w.pack = null;
      w.defencePackage = { latest: null, bankFacing: null, currentPromptVersion: 1, building: false };
      w.evidenceLineItems = [];
      w.presentation.lifecycle = "building_evidence";
      break;
    case "building":
      w.pack.status = "building";
      w.pack.activeBuildJob = { id: "j", status: "running" };
      break;
    case "failed":
      w.pack.status = "failed";
      w.pack.failureCode = "build_failed";
      break;
    case "prepared_review":
      w.presentation.automationMode = "review";
      w.appliedRule = { mode: "review" };
      break;
    case "prepared_review_approved":
      w.presentation.automationMode = "review";
      w.appliedRule = { mode: "review" };
      w.dispute.reviewState = "approved";
      break;
    case "held":
      w.held = { held: true, reason: "thin_evidence" };
      w.presentation.strength = "weak";
      break;
    case "needs_attention":
      w.presentation.attention = "requested";
      break;
    case "covered":
      w.pack.coverage = { state: "covered_shopify", isCovered: true, shopifyProtectStatus: "PROTECTED" };
      break;
    case "fatal_refund":
      w.workspaceAssessment.caseStrength.fatalLoss = { triggered: true, reason: "refund_issued" };
      break;
    case "fatal_unfulfilled":
      w.workspaceAssessment.caseStrength.fatalLoss = { triggered: true, reason: "inr_no_fulfillment" };
      break;
    case "saved":
      w.presentation.lifecycle = "saved_to_shopify";
      w.pack.savedToShopifyAt = "2026-11-07T10:00:00Z";
      w.defencePackage.bankFacing = { ...w.defencePackage.latest, status: "submitted" };
      break;
    case "under_review":
      w.presentation.lifecycle = "under_review";
      w.pack.savedToShopifyAt = "2026-11-07T10:00:00Z";
      w.defencePackage.bankFacing = { ...w.defencePackage.latest, status: "submitted" };
      break;
    case "reopened":
      w.dispute.reopenedAt = "2026-11-05T09:00:00Z";
      w.dispute.responseCycle = 2;
      break;
    case "escalated":
      w.dispute.phase = "chargeback";
      w.dispute.escalatedFromInquiryAt = "2026-11-05T09:00:00Z";
      break;
    case "inquiry":
      w.dispute.phase = "inquiry";
      break;
    case "return_on_record":
      w.dispute.orderSituation = { returns: "returned", refund: "none", returnOpenedAt: null, asOf: null };
      break;
    case "won":
      decide("won", "we");
      break;
    case "lost":
      decide("lost", "we");
      break;
    case "won_inquiry":
      w.dispute.phase = "inquiry";
      decide("won", "we");
      break;
    case "lost_shopify":
      decide("lost", "shopify");
      break;
    case "lost_none":
      decide("lost", "none");
      break;
    case "lost_before_install":
      decide("lost", "before_install");
      break;
    case "closed":
      w.presentation = { ...w.presentation, lifecycle: "closed", outcome: "closed", terminal: true, editable: false };
      w.dispute.closedAt = "2026-10-11T00:13:55+00:00";
      break;
    case "not_product_received":
      w.dispute.reason = "PRODUCT_NOT_RECEIVED";
      break;
    default:
      throw new Error(`unknown variant ${name}`);
  }
  return w as unknown as WorkspaceWithPatterns;
}

export const ALL_VARIANTS = [
  "prepared",
  "no_pack",
  "building",
  "failed",
  "prepared_review",
  "prepared_review_approved",
  "held",
  "needs_attention",
  "covered",
  "fatal_refund",
  "fatal_unfulfilled",
  "saved",
  "under_review",
  "reopened",
  "escalated",
  "inquiry",
  "return_on_record",
  "won",
  "lost",
  "won_inquiry",
  "lost_shopify",
  "lost_none",
  "lost_before_install",
  "closed",
  "not_product_received",
] as const;
