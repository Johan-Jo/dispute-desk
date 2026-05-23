/**
 * Centralized healthy-merchant fixtures for demo mode.
 *
 * Used by `lib/demo/demoFetch.ts` to short-circuit known API endpoints
 * when demo mode is active. Every fixture is typed against the same
 * response shape the real endpoint returns, so `tsc` catches drift.
 *
 * Editing notes:
 *   - All counts/percentages must agree with the App Store screenshot
 *     spec (see PR description / docs/demo-mode.md if written).
 *   - The "demo dispute" referenced from the dashboard preview is
 *     `DEMO_DISPUTE_ID`. The workspace endpoint matches on prefix so any
 *     `/app/disputes/{anything-starting-with-demo}` link resolves.
 */

import type { DashboardStats, ActivityItem, PeriodKey } from "@/app/(embedded)/app/dashboardHelpers";
import type { Dispute } from "@/app/(embedded)/app/disputes/disputeListHelpers";
import type {
  WorkspaceData,
  WorkspaceDispute,
  WorkspacePack,
  PresentationStatus,
  SubmissionSummary,
  AppliedRule,
  CaseTypeInfo,
  EvidenceItemFull,
} from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";
import type { SetupStateResponse } from "@/lib/setup/types";
import type { PackHandlingUiMode } from "@/lib/rules/packHandlingAutomation";

export const DEMO_DISPUTE_ID = "demo-7f8247d3-0000-0000-0000-000000000001";
export const DEMO_PACK_ID = "demo-pack-7f8247d3";
export const DEMO_SHOP_DOMAIN = "demo-store.myshopify.com";

/* ─── Dashboard stats ──────────────────────────────────────────────── */

const DEMO_ACTIVITY: ActivityItem[] = [
  {
    id: "demo-act-01",
    disputeId: DEMO_DISPUTE_ID,
    orderName: "#1091",
    eventType: "evidence_saved_to_shopify",
    description: "8 evidence fields sent to Shopify",
    eventAt: "2026-05-22T14:12:00Z",
    actorType: "automation",
  },
  {
    id: "demo-act-02",
    disputeId: DEMO_DISPUTE_ID,
    orderName: "#1091",
    eventType: "pack_created",
    description: "Score: 92%, 8 evidence items collected",
    eventAt: "2026-05-22T14:08:00Z",
    actorType: "automation",
  },
  {
    id: "demo-act-03",
    disputeId: "demo-1090",
    orderName: "#1090",
    eventType: "submission_confirmed",
    description: null,
    eventAt: "2026-05-22T09:48:00Z",
    actorType: "system",
  },
  {
    id: "demo-act-04",
    disputeId: "demo-1090",
    orderName: "#1090",
    eventType: "evidence_saved_to_shopify",
    description: "7 evidence fields sent to Shopify",
    eventAt: "2026-05-22T09:46:00Z",
    actorType: "automation",
  },
  {
    id: "demo-act-05",
    disputeId: "demo-1089",
    orderName: "#1089",
    eventType: "won",
    description: null,
    eventAt: "2026-05-21T17:02:00Z",
    actorType: "system",
  },
  {
    id: "demo-act-06",
    disputeId: "demo-1088",
    orderName: "#1088",
    eventType: "submitted",
    description: null,
    eventAt: "2026-05-21T11:24:00Z",
    actorType: "automation",
  },
  {
    id: "demo-act-07",
    disputeId: "demo-1088",
    orderName: "#1088",
    eventType: "pack_created",
    description: "Score: 88%, 6 evidence items collected",
    eventAt: "2026-05-21T11:18:00Z",
    actorType: "automation",
  },
  {
    id: "demo-act-08",
    disputeId: "demo-1087",
    orderName: "#1087",
    eventType: "won",
    description: null,
    eventAt: "2026-05-20T08:50:00Z",
    actorType: "system",
  },
];

export function getDemoDashboardStats(_period: PeriodKey): DashboardStats {
  return {
    activeDisputes: 6,
    winRate: 78,
    packCount: 30,
    amountAtRisk: 412,
    amountRecovered: 1240,
    amountLost: 0,
    currencyCode: "USD",
    otherCurrencyCounts: {},
    disputesWon: 18,
    disputesLost: 5,
    totalClosed: 24,
    avgTimeToSubmit: 1.4,
    avgTimeToClose: 12,
    activeDisputesChange: -12,
    winRateChange: 4,
    amountAtRiskChange: -18,
    amountRecoveredChange: 9,
    disputesWonChange: 12,
    inquiryCount: 2,
    chargebackCount: 4,
    needsAttentionCount: 0,
    statusBreakdown: { won: 18, lost: 5, accepted_not_contested: 1 },
    outcomeBreakdown: { won: 18, lost: 5, accepted: 1 },
    operationalBreakdown: {
      ready_to_submit: 1,
      submitted_to_bank: 3,
      submitted_to_shopify: 1,
      waiting_on_issuer: 1,
    },
    operationalClosedCount: 24,
    actionNeededDisputeId: null,
    submissionBreakdown: { saved_to_shopify: 5, not_saved: 1 },
    winRateTrend: [62, 68, 72, 74, 76, 78],
    disputeCategories: [
      { label: "FRAUDULENT", value: 45 },
      { label: "PRODUCT_NOT_RECEIVED", value: 20 },
      { label: "DUPLICATE", value: 15 },
      { label: "CREDIT_NOT_PROCESSED", value: 12 },
      { label: "PRODUCT_UNACCEPTABLE", value: 8 },
    ],
    recentActivity: DEMO_ACTIVITY,
    chargebackRate: 0.27,
    chargebackRateChange: -0.03,
    chargebackRateNumerator: 17,
    chargebackRateDenominator: 6314,
    chargebackRateAvailable: true,
    chargebackRateLowVolume: false,
    chargebackRateLastSyncedAt: "2026-05-23T00:00:00Z",
  };
}

/* ─── Recent disputes preview / disputes list ──────────────────────── */

function demoDispute(opts: {
  id: string;
  orderName: string;
  amount: number;
  reason: string;
  normalizedStatus: string;
  initiatedAt: string;
  dueAt: string | null;
  finalOutcome?: string | null;
  closedAt?: string | null;
}): Dispute {
  return {
    id: opts.id,
    dispute_gid: `gid://demo/Dispute/${opts.id}`,
    order_gid: `gid://demo/Order/${opts.orderName.replace("#", "")}`,
    order_name: opts.orderName,
    customer_display_name: null,
    status: opts.normalizedStatus,
    reason: opts.reason,
    phase: "chargeback",
    amount: opts.amount,
    currency_code: "USD",
    due_at: opts.dueAt,
    initiated_at: opts.initiatedAt,
    needs_review: false,
    last_synced_at: opts.initiatedAt,
    normalized_status: opts.normalizedStatus,
    submission_state: opts.closedAt
      ? "submitted_confirmed"
      : opts.normalizedStatus.startsWith("submitted")
        ? "submitted_confirmed"
        : "saved_to_shopify",
    final_outcome: opts.finalOutcome ?? null,
    closed_at: opts.closedAt ?? null,
    submitted_at: opts.initiatedAt,
    outcome_amount_recovered: opts.finalOutcome === "won" ? opts.amount : null,
    outcome_amount_lost: null,
    last_event_at: opts.initiatedAt,
    caseStrength: {
      overall: "strong",
      strongCount: 3,
      moderateCount: 2,
      supportingCount: 4,
    },
  };
}

export function getDemoDisputes(): { disputes: Dispute[]; total: number } {
  const disputes: Dispute[] = [
    demoDispute({
      id: DEMO_DISPUTE_ID,
      orderName: "#1091",
      amount: 154.18,
      reason: "FRAUDULENT",
      normalizedStatus: "submitted_to_bank",
      initiatedAt: "2026-05-20T10:00:00Z",
      dueAt: "2026-05-28T23:59:59Z",
    }),
    demoDispute({
      id: "demo-1090",
      orderName: "#1090",
      amount: 25.93,
      reason: "FRAUDULENT",
      normalizedStatus: "submitted_to_shopify",
      initiatedAt: "2026-05-20T08:00:00Z",
      dueAt: "2026-05-29T23:59:59Z",
    }),
    demoDispute({
      id: "demo-1089",
      orderName: "#1089",
      amount: 32.5,
      reason: "FRAUDULENT",
      normalizedStatus: "won",
      initiatedAt: "2026-05-19T08:00:00Z",
      dueAt: "2026-05-28T23:59:59Z",
      finalOutcome: "won",
      closedAt: "2026-05-22T16:00:00Z",
    }),
    demoDispute({
      id: "demo-1088",
      orderName: "#1088",
      amount: 68.2,
      reason: "PRODUCT_NOT_RECEIVED",
      normalizedStatus: "submitted_to_bank",
      initiatedAt: "2026-05-18T08:00:00Z",
      dueAt: "2026-05-27T23:59:59Z",
    }),
    demoDispute({
      id: "demo-1087",
      orderName: "#1087",
      amount: 25.93,
      reason: "DUPLICATE",
      normalizedStatus: "won",
      initiatedAt: "2026-05-17T08:00:00Z",
      dueAt: "2026-05-26T23:59:59Z",
      finalOutcome: "won",
      closedAt: "2026-05-21T12:00:00Z",
    }),
    demoDispute({
      id: "demo-1086",
      orderName: "#1086",
      amount: 15.4,
      reason: "CREDIT_NOT_PROCESSED",
      normalizedStatus: "won",
      initiatedAt: "2026-05-16T08:00:00Z",
      dueAt: "2026-05-25T23:59:59Z",
      finalOutcome: "won",
      closedAt: "2026-05-20T12:00:00Z",
    }),
  ];
  return { disputes, total: disputes.length };
}

/* ─── Insights (Chargeback Exposure) ───────────────────────────────── */

interface DemoPeriodWindow {
  ordersTotal: number;
  acceptanceRatePct: number | null;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  fraudDisputeRatePct: number | null;
  shopifyProtectCoveragePct: number | null;
  chargebackRatePct: number | null;
  chargebackOrders: number;
  threeDsAuthRatePct: number | null;
  threeDsAuthOrders: number;
  threeDsAuthEligibleOrders: number;
  medianFulfillmentHours: number | null;
  fulfilledOrdersCount: number;
  confirmedDeliveryRatePct: number | null;
  confirmedDeliveryOrders: number;
  fulfilledForDeliveryCount: number;
  signedForRatePct: number | null;
  signedForOrders: number;
}

const DEMO_CURRENT_WINDOW: DemoPeriodWindow = {
  ordersTotal: 2104,
  acceptanceRatePct: 92,
  highRiskPct: 1.2,
  fulfilledHighRiskPct: 18,
  fraudDisputeRatePct: 0.3,
  shopifyProtectCoveragePct: 48,
  chargebackRatePct: 0.27,
  chargebackOrders: 6,
  threeDsAuthRatePct: 84,
  threeDsAuthOrders: 1432,
  threeDsAuthEligibleOrders: 1704,
  medianFulfillmentHours: 28.8, // 1.2 days
  fulfilledOrdersCount: 2061,
  confirmedDeliveryRatePct: 97,
  confirmedDeliveryOrders: 1999,
  fulfilledForDeliveryCount: 2061,
  signedForRatePct: 62,
  signedForOrders: 1239,
};

const DEMO_PRIOR_WINDOW: DemoPeriodWindow = {
  ...DEMO_CURRENT_WINDOW,
  ordersTotal: 2068,
  acceptanceRatePct: 90,
  highRiskPct: 1.4,
  fulfilledHighRiskPct: 22,
  fraudDisputeRatePct: 0.4,
  shopifyProtectCoveragePct: 44,
  chargebackRatePct: 0.31,
  chargebackOrders: 6,
  threeDsAuthRatePct: 79,
  signedForRatePct: 58,
};

export function getDemoInsights() {
  return {
    available: true,
    ordersAnalyzed: 6314,

    windowStart90d: "2026-02-22T00:00:00Z",
    highRiskPct: 1.0,
    fulfilledHighRiskPct: 18,
    acceptanceRatePct: 92,
    fraudDisputeRatePct: 0.3,
    shopifyProtectCoveragePct: 48,
    chargebackRate90d: 0.27,
    chargebackHealth: "good" as const,
    chargebackHealthAvailable: true,
    chargebackOrders90d: 17,

    windowStart30d: "2026-04-23T00:00:00Z",
    windowStart30dPrior: "2026-03-24T00:00:00Z",
    current30d: DEMO_CURRENT_WINDOW,
    prior30d: DEMO_PRIOR_WINDOW,
    chargebackRateSparklineWeekly: [
      { weekStart: "2026-03-30T00:00:00Z", rate: 0.31, orderCount: 612 },
      { weekStart: "2026-04-06T00:00:00Z", rate: 0.29, orderCount: 598 },
      { weekStart: "2026-04-13T00:00:00Z", rate: 0.3, orderCount: 624 },
      { weekStart: "2026-04-20T00:00:00Z", rate: 0.28, orderCount: 651 },
      { weekStart: "2026-04-27T00:00:00Z", rate: 0.27, orderCount: 619 },
      { weekStart: "2026-05-04T00:00:00Z", rate: 0.26, orderCount: 663 },
      { weekStart: "2026-05-11T00:00:00Z", rate: 0.27, orderCount: 645 },
      { weekStart: "2026-05-18T00:00:00Z", rate: 0.27, orderCount: 502 },
    ],

    riskBreakdown: { low: 947, medium: 189, high: 63, none: 5052, pending: 63 },
    riskToDisputeConversion: {
      high: { orders: 63, disputes: 3, conversionPct: 4.8 },
      medium: { orders: 189, disputes: 4, conversionPct: 2.1 },
      low: { orders: 947, disputes: 6, conversionPct: 0.6 },
      none: { orders: 5052, disputes: 4, conversionPct: 0.08 },
      pending: { orders: 63, disputes: 0, conversionPct: 0 },
    },

    historicalImportStatus: "complete" as const,
    historicalImportOrdersTotal: 6314,
    historicalImportSinceDate: "2025-08-22T00:00:00Z",
    historicalImportScopeGranted: "read_all_orders" as const,
    historicalImportCompletedAt: "2026-02-21T08:00:00Z",

    // Suppresses the dashboard's scope-upgrade nudge banner — the demo
    // merchant is already on the wider grant. The banner reads this exact
    // field name (see DashboardScopeUpgradeBanner.tsx).
    currentScopeGrant: "read_all_orders" as const,
    dismissedBanners: {} as Record<string, boolean>,
  };
}

/* ─── Dashboard operational insights strip ────────────────────────── */

export function getDemoOperationalInsightsStrip() {
  return {
    available: true,
    ordersAnalyzed: 6314,
    highRiskPct: 1.0,
    fulfilledHighRiskPct: 18,
    chargebackRate90d: 0.27,
    chargebackHealth: "good" as const,
    shopifyProtectCoveragePct: 48,
    threeDsAuthRatePct: 84,
    confirmedDeliveryRatePct: 97,
    signedForRatePct: 62,
    historicalImportStatus: "complete" as const,
  };
}

/* ─── Setup state ──────────────────────────────────────────────────── */

export function getDemoSetupState(): SetupStateResponse {
  const ts = "2026-05-01T00:00:00Z";
  const done = { status: "done" as const, completed_at: ts };
  return {
    steps: {
      connection: done,
      store_profile: done,
      coverage: done,
      automation: done,
      policies: done,
      activate: done,
    },
    progress: { doneCount: 6, total: 6 },
    nextStepId: null,
    allDone: true,
    shopId: "demo",
  };
}

/* ─── Billing usage (shop_domain only consumed by recent disputes preview) ─ */

export function getDemoBillingUsage() {
  return {
    shop_domain: DEMO_SHOP_DOMAIN,
    plan_tier: "growth",
    plan_label: "Growth",
    period_disputes: 4,
    period_limit: 100,
  };
}

/* ─── Automation rules ─────────────────────────────────────────────── */

type ActivePack = {
  id: string;
  name: string;
  dispute_type: string;
  template_id: string | null;
  status: string;
};

const DEMO_ACTIVE_PACKS: ActivePack[] = [
  { id: "demo-pack-fraud", name: "Fraud", dispute_type: "FRAUDULENT", template_id: null, status: "active" },
  { id: "demo-pack-pnr", name: "Product Not Received", dispute_type: "PRODUCT_NOT_RECEIVED", template_id: null, status: "active" },
  { id: "demo-pack-not-as-described", name: "Product Unacceptable", dispute_type: "PRODUCT_UNACCEPTABLE", template_id: null, status: "active" },
  { id: "demo-pack-subscription", name: "Subscription Canceled", dispute_type: "SUBSCRIPTION_CANCELED", template_id: null, status: "active" },
  { id: "demo-pack-refund", name: "Credit Not Processed", dispute_type: "CREDIT_NOT_PROCESSED", template_id: null, status: "active" },
  { id: "demo-pack-duplicate", name: "Duplicate Charge", dispute_type: "DUPLICATE", template_id: null, status: "active" },
  { id: "demo-pack-general", name: "General", dispute_type: "GENERAL", template_id: null, status: "active" },
];

const DEMO_PACK_MODES: Record<string, PackHandlingUiMode> = {
  "demo-pack-fraud": "review",
  "demo-pack-pnr": "auto",
  "demo-pack-not-as-described": "review",
  "demo-pack-subscription": "auto",
  "demo-pack-refund": "auto",
  "demo-pack-duplicate": "auto",
  "demo-pack-general": "review",
};

export function getDemoAutomation() {
  return {
    activePacks: DEMO_ACTIVE_PACKS,
    pack_modes: DEMO_PACK_MODES,
  };
}

/* ─── Safeguard rule (high-value review) ───────────────────────────── */

export function getDemoRules() {
  return [
    {
      id: "demo-rule-safeguard",
      name: "__dd_safeguard__:high_value",
      enabled: true,
      match: { amount_range: { min: 500 } },
      action: { mode: "review" },
      priority: 10,
    },
  ];
}

/* ─── Workspace (dispute detail) ───────────────────────────────────── */

const DEMO_CHECKLIST: ChecklistItemV2[] = [
  { field: "avs_cvv_match", label: "Payment authentication", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
  { field: "billing_address_match", label: "Billing address match", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
  { field: "delivery_proof", label: "Delivery confirmation", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
  { field: "shipping_tracking", label: "Shipping tracking", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
  { field: "order_confirmation", label: "Order record", status: "available", priority: "recommended", blocking: false, source: "auto_shopify" },
  { field: "customer_communication", label: "Customer communication", status: "available", priority: "recommended", blocking: false, source: "manual_note" },
  { field: "activity_log", label: "Customer activity log", status: "available", priority: "recommended", blocking: false, source: "auto_shopify" },
  { field: "refund_policy", label: "Refund policy", status: "available", priority: "recommended", blocking: false, source: "auto_policy" },
  { field: "shipping_policy", label: "Shipping policy", status: "available", priority: "recommended", blocking: false, source: "auto_policy" },
  { field: "cancellation_policy", label: "Cancellation policy", status: "available", priority: "optional", blocking: false, source: "auto_policy" },
  { field: "ip_location_check", label: "IP & location consistency", status: "available", priority: "optional", blocking: false, source: "auto_ipinfo" },
  { field: "fraud_risk_screening", label: "Pre-authorization fraud screening", status: "available", priority: "optional", blocking: false, source: "auto_shopify" },
  { field: "supporting_documents", label: "Supplementary documents", status: "missing", priority: "optional", blocking: false, source: "manual_upload" },
];

const DEMO_EVIDENCE_ITEMS_BY_FIELD: Record<string, EvidenceItemFull> = {
  avs_cvv_match: {
    id: "demo-ei-avs",
    type: "payment_auth",
    label: "Payment authentication",
    source: "shopify",
    payload: { avsResultCode: "Y", cvvResultCode: "M", fieldsProvided: ["avsResultCode", "cvvResultCode"] },
    created_at: "2026-05-20T10:01:00Z",
  },
  billing_address_match: {
    id: "demo-ei-billing",
    type: "billing_match",
    label: "Billing address match",
    source: "shopify",
    payload: { match: true, fieldsProvided: ["match"] },
    created_at: "2026-05-20T10:01:00Z",
  },
  delivery_proof: {
    id: "demo-ei-delivery",
    type: "delivery",
    label: "Delivery confirmation",
    source: "carrier",
    payload: { proofType: "signature_confirmed", carrier: "UPS", trackingNumber: "1Z999AA10123456784", fieldsProvided: ["proofType", "carrier", "trackingNumber"] },
    created_at: "2026-05-20T10:02:00Z",
  },
  shipping_tracking: {
    id: "demo-ei-tracking",
    type: "delivery",
    label: "Shipping tracking",
    source: "carrier",
    payload: { proofType: "signature_confirmed", carrier: "UPS", trackingNumber: "1Z999AA10123456784", fieldsProvided: ["proofType"] },
    created_at: "2026-05-20T10:02:00Z",
  },
  order_confirmation: {
    id: "demo-ei-order",
    type: "order_record",
    label: "Order record",
    source: "shopify",
    payload: { orderName: "#1091", placedAt: "2026-05-15T14:22:00Z", fieldsProvided: ["orderName", "placedAt"] },
    created_at: "2026-05-20T10:01:00Z",
  },
  customer_communication: {
    id: "demo-ei-comm",
    type: "communication",
    label: "Customer communication",
    source: "helpdesk",
    payload: { messageCount: 2, fieldsProvided: ["messageCount"] },
    created_at: "2026-05-20T10:03:00Z",
  },
  activity_log: {
    id: "demo-ei-activity",
    type: "account_history",
    label: "Customer activity log",
    source: "shopify",
    payload: { sessionCount: 4, fieldsProvided: ["sessionCount"] },
    created_at: "2026-05-20T10:03:00Z",
  },
  refund_policy: {
    id: "demo-ei-refund",
    type: "policy_refund",
    label: "Refund policy",
    source: "shopify",
    payload: { acceptedAtCheckout: true, acceptanceTimestamp: "2026-05-15T14:21:50Z", fieldsProvided: ["acceptedAtCheckout"] },
    created_at: "2026-05-20T10:01:00Z",
  },
  shipping_policy: {
    id: "demo-ei-shipping",
    type: "policy_shipping",
    label: "Shipping policy",
    source: "shopify",
    payload: { acceptedAtCheckout: true, fieldsProvided: ["acceptedAtCheckout"] },
    created_at: "2026-05-20T10:01:00Z",
  },
  cancellation_policy: {
    id: "demo-ei-cancel",
    type: "policy_cancellation",
    label: "Cancellation policy",
    source: "shopify",
    payload: { acceptedAtCheckout: true, fieldsProvided: ["acceptedAtCheckout"] },
    created_at: "2026-05-20T10:01:00Z",
  },
  ip_location_check: {
    id: "demo-ei-ip",
    type: "ip_location",
    label: "IP & location consistency",
    source: "derived",
    payload: { ipCountry: "US", billingCountry: "US", proxyDetected: false, fieldsProvided: ["ipCountry"] },
    created_at: "2026-05-20T10:03:00Z",
  },
  fraud_risk_screening: {
    id: "demo-ei-fraud",
    type: "fraud_screening",
    label: "Pre-authorization fraud screening",
    source: "shopify",
    payload: {
      riskLevel: "LOW",
      recommendation: "ACCEPT",
      positiveFacts: [
        { description: "Billing country matches IP country", sentiment: "POSITIVE" },
        { description: "AVS address match", sentiment: "POSITIVE" },
      ],
      fieldsProvided: ["riskLevel"],
    },
    created_at: "2026-05-20T10:01:00Z",
  },
};

const DEMO_EVIDENCE_LINE_ITEMS: EvidenceLineItem[] = [
  {
    id: "demo-li-avs",
    field: "avs_cvv_match",
    label: "Payment authentication",
    source: "shopify",
    hasEvidence: true,
    strengthContribution: "strong",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: true,
    usedAsPositiveBankEvidence: true,
    submittedToShopify: false,
    submissionMethod: "bank_argument",
    isNegativeOrAmbiguous: false,
    reason: "AVS and CVV match (Y / M).",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-order",
    field: "order_confirmation",
    label: "Order record",
    source: "shopify",
    hasEvidence: true,
    strengthContribution: "supporting",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: true,
    usedAsPositiveBankEvidence: true,
    submittedToShopify: false,
    submissionMethod: "bank_argument",
    isNegativeOrAmbiguous: false,
    reason: "Order record present in pack.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-billing",
    field: "billing_address_match",
    label: "Billing address match",
    source: "shopify",
    hasEvidence: true,
    strengthContribution: "strong",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: true,
    usedAsPositiveBankEvidence: true,
    submittedToShopify: false,
    submissionMethod: "bank_argument",
    isNegativeOrAmbiguous: false,
    reason: "Billing address AVS-confirmed.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-activity",
    field: "activity_log",
    label: "Customer activity log",
    source: "shopify",
    hasEvidence: true,
    strengthContribution: "supporting",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: true,
    usedAsPositiveBankEvidence: true,
    submittedToShopify: false,
    submissionMethod: "bank_argument",
    isNegativeOrAmbiguous: false,
    reason: "Multiple authenticated sessions on file.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-refund",
    field: "refund_policy",
    label: "Refund policy",
    source: "derived",
    hasEvidence: true,
    strengthContribution: "supporting",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: true,
    usedAsPositiveBankEvidence: true,
    submittedToShopify: false,
    submissionMethod: "bank_argument",
    isNegativeOrAmbiguous: false,
    reason: "Refund policy accepted at checkout.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-shipping-policy",
    field: "shipping_policy",
    label: "Shipping policy",
    source: "derived",
    hasEvidence: true,
    strengthContribution: "supporting",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: true,
    usedAsPositiveBankEvidence: true,
    submittedToShopify: false,
    submissionMethod: "bank_argument",
    isNegativeOrAmbiguous: false,
    reason: "Shipping policy accepted at checkout.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-cancellation",
    field: "cancellation_policy",
    label: "Cancellation policy",
    source: "derived",
    hasEvidence: true,
    strengthContribution: "supporting",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: true,
    usedAsPositiveBankEvidence: true,
    submittedToShopify: false,
    submissionMethod: "bank_argument",
    isNegativeOrAmbiguous: false,
    reason: "Cancellation policy accepted at checkout.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-comm",
    field: "customer_communication",
    label: "Customer communication",
    source: "helpdesk",
    hasEvidence: true,
    strengthContribution: "supporting",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: false,
    usedAsPositiveBankEvidence: false,
    submittedToShopify: false,
    submissionMethod: "context_only",
    isNegativeOrAmbiguous: false,
    reason: "Logged correspondence with customer.",
    canBeForceIncluded: true,
  },
  {
    id: "demo-li-delivery",
    field: "delivery_proof",
    label: "Delivery confirmation",
    source: "carrier",
    hasEvidence: true,
    strengthContribution: "strong",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: true,
    includedInBankArgument: true,
    usedAsPositiveBankEvidence: true,
    submittedToShopify: false,
    submissionMethod: "bank_argument",
    isNegativeOrAmbiguous: false,
    reason: "Signature on delivery captured by carrier.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-ip",
    field: "ip_location_check",
    label: "IP & location consistency",
    source: "derived",
    hasEvidence: true,
    strengthContribution: "internal_only",
    bankEligible: false,
    merchantVisible: true,
    includedInDefencePackage: false,
    includedInBankArgument: false,
    usedAsPositiveBankEvidence: false,
    submittedToShopify: false,
    submissionMethod: "internal_only",
    isNegativeOrAmbiguous: false,
    reason: "IP geolocation matches billing country — kept internal as bank-facing context.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-fraud",
    field: "fraud_risk_screening",
    label: "Pre-authorization fraud screening",
    source: "shopify",
    hasEvidence: true,
    strengthContribution: "internal_only",
    bankEligible: false,
    merchantVisible: true,
    includedInDefencePackage: false,
    includedInBankArgument: false,
    usedAsPositiveBankEvidence: false,
    submittedToShopify: false,
    submissionMethod: "internal_only",
    isNegativeOrAmbiguous: false,
    reason: "Shopify pre-authorization assessment kept internal for context.",
    canBeForceIncluded: false,
  },
  {
    id: "demo-li-supporting",
    field: "supporting_documents",
    label: "Supplementary documents",
    source: "merchant_upload",
    hasEvidence: false,
    strengthContribution: "none",
    bankEligible: true,
    merchantVisible: true,
    includedInDefencePackage: false,
    includedInBankArgument: false,
    usedAsPositiveBankEvidence: false,
    submittedToShopify: false,
    submissionMethod: "not_included",
    isNegativeOrAmbiguous: false,
    reason: "Not collected for this case.",
    canBeForceIncluded: false,
  },
];

const DEMO_PACK: WorkspacePack = {
  id: DEMO_PACK_ID,
  status: "ready",
  completenessScore: 92,
  submissionReadiness: "ready",
  checklistV2: DEMO_CHECKLIST,
  waivedItems: [],
  evidenceItems: Object.values(DEMO_EVIDENCE_ITEMS_BY_FIELD),
  evidenceItemsByField: DEMO_EVIDENCE_ITEMS_BY_FIELD,
  auditEvents: [],
  pdfPath: "demo/defence_pack_1091.pdf",
  savedToShopifyAt: null,
  updatedAt: "2026-05-20T10:05:00Z",
  rebuildPending: false,
  lastRebuildOutcome: null,
  lastRebuildAt: null,
  lastRebuildReason: null,
  activeBuildJob: null,
  failureCode: null,
  failureReason: null,
  coverage: { state: "not_covered", shopifyProtectStatus: "INACTIVE" },
  attachmentUploads: [],
};

const DEMO_SUBMISSION_SUMMARY: SubmissionSummary = {
  pdfFileName: "defence_pack_1091.pdf",
  shopifyStructuredFields: [
    { field: "customer_first_name", value: "Johan" },
    { field: "customer_last_name", value: "Jonsson" },
    { field: "customer_email", value: "johan@example.com" },
  ],
  factsInPdf: [
    { field: "avs_cvv_match", label: "Payment authentication", categoryLabel: "Payment Verification" },
    { field: "order_confirmation", label: "Order record", categoryLabel: "Order Facts" },
    { field: "billing_address_match", label: "Billing address match", categoryLabel: "Order Facts" },
    { field: "activity_log", label: "Customer activity log", categoryLabel: "Customer Identity & History" },
    { field: "refund_policy", label: "Refund policy", categoryLabel: "Policies & Disclosures" },
    { field: "shipping_policy", label: "Shipping policy", categoryLabel: "Policies & Disclosures" },
    { field: "cancellation_policy", label: "Cancellation policy", categoryLabel: "Policies & Disclosures" },
    { field: "delivery_proof", label: "Delivery confirmation", categoryLabel: "Fulfillment & Delivery" },
  ],
  counts: {
    usedAsPositiveBankArgument: 8,
    contextOnly: 3,
    internalOnly: 1,
    excluded: 0,
    notSupported: 0,
    failedUpload: 0,
    waived: 0,
  },
};

const DEMO_WORKSPACE_DISPUTE: WorkspaceDispute = {
  id: DEMO_DISPUTE_ID,
  reason: "FRAUDULENT",
  reasonFamily: "fraud",
  phase: "chargeback",
  amount: 154.18,
  currency: "USD",
  orderName: "#1091",
  orderGid: "gid://demo/Order/1091",
  customerName: "Johan Jonsson",
  shopId: "demo",
  shopDomain: DEMO_SHOP_DOMAIN,
  disputeGid: `gid://demo/Dispute/${DEMO_DISPUTE_ID}`,
  disputeEvidenceGid: `gid://demo/DisputeEvidence/${DEMO_DISPUTE_ID}`,
  dueAt: "2026-05-28T23:59:59Z",
  openedAt: "2026-05-20T10:00:00Z",
  normalizedStatus: "ready_to_submit",
  submissionState: "not_saved",
  submittedAt: null,
  finalOutcome: null,
  cardNetwork: "Visa",
  cardLast4: "4242",
  transactionDate: "2026-05-15T14:22:00Z",
  paymentGateway: "shopify_payments",
  financialStatus: "paid",
  fulfillmentStatus: "fulfilled",
  cardholderName: "Johan Jonsson",
  timelineEvents: [
    { at: "2026-05-15T14:22:00Z", text: "Order #1091 placed" },
    { at: "2026-05-15T16:08:00Z", text: "Order fulfilled, tracking attached" },
    { at: "2026-05-18T10:14:00Z", text: "Carrier confirmed signature on delivery" },
    { at: "2026-05-20T10:00:00Z", text: "Chargeback opened by issuer" },
  ],
};

const DEMO_APPLIED_RULE: AppliedRule = { mode: "review" };

const DEMO_CASE_TYPE_INFO: CaseTypeInfo = {
  disputeType: "Fraudulent transaction",
  toWin: [
    "Show that payment authentication passed (AVS + CVV).",
    "Show delivery to the billing address with carrier signature.",
    "Show customer activity and order history consistent with a legitimate purchase.",
  ],
  strongestEvidence: [
    "Payment authentication (AVS + CVV match)",
    "Signed-for carrier delivery to the billing address",
    "Billing address AVS match",
  ],
};

const DEMO_PRESENTATION_STATUS: PresentationStatus = "DRAFT";

export function getDemoWorkspace(_disputeId: string): WorkspaceData {
  return {
    dispute: DEMO_WORKSPACE_DISPUTE,
    pack: DEMO_PACK,
    presentationStatus: DEMO_PRESENTATION_STATUS,
    evidenceLineItems: DEMO_EVIDENCE_LINE_ITEMS,
    submissionSummary: DEMO_SUBMISSION_SUMMARY,
    submissionFields: [],
    attachments: [],
    appliedRule: DEMO_APPLIED_RULE,
    caseTypeInfo: DEMO_CASE_TYPE_INFO,
    fileEvidence: { flagEnabled: false, scopesGranted: true, missingScopes: [] },
  };
}
