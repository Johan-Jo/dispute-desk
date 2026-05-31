/**
 * Shared types for demo fixtures. Demo-only — do not import in production code paths.
 * Shapes mirror just enough of the embedded models to render the UI; they are NOT
 * structurally identical to the real `Dispute` / `EvidencePack` types.
 */

export type DemoDisputeStrength = "strong" | "moderate" | "weak" | "covered" | "fatal_loss";

export type DemoDisputeReasonFamily = "fraudulent" | "product_not_received" | "subscription_canceled" | "duplicate" | "credit_not_processed" | "general";

export interface DemoEvidenceItem {
  id: string;
  label: string;
  /** Group heading in the evidence panel. */
  group: "strong" | "moderate" | "supplemental";
  /** One-line description of what was collected. */
  detail: string;
  /** Source label shown as a small tag, e.g. "Shopify Payments", "AfterShip". */
  source: string;
}

export interface DemoTimelineEvent {
  id: string;
  at: string; // ISO
  label: string;
  detail?: string;
  tone?: "default" | "success" | "warning" | "info" | "danger";
}

export interface DemoDispute {
  id: string; // e.g. "dp-2401"
  orderName: string; // e.g. "#1027"
  customerName: string;
  customerEmail: string;
  amount: number;
  currency: string;
  reasonFamily: DemoDisputeReasonFamily;
  reasonLabel: string; // pretty label, e.g. "Fraudulent"
  /** Hero descriptor shown on the detail page. */
  heroLine: string;
  /** Banner shown above the page (varies by gate). */
  banner?: {
    tone: "purple" | "amber" | "blue" | "red";
    title: string;
    body: string;
  };
  strength: DemoDisputeStrength;
  /** "Auto-built in 4 seconds. Ready to save to Shopify." */
  strengthCaption: string;
  /** Numeric score 0–100 shown on the strength meter. */
  strengthScore: number;
  /** Due date (ISO) for the urgency chip. */
  dueAt: string;
  openedAt: string;
  status: "ready_to_submit" | "needs_review" | "submitted" | "covered" | "blocked";
  statusLabel: string;
  evidence: DemoEvidenceItem[];
  timeline: DemoTimelineEvent[];
  /** Short narrative shown in the "View submission summary" drawer. */
  bankRebuttalNarrative: string;
  /** Mapping of Shopify evidence slots → which collected fields go in them. */
  shopifyFieldMap: Array<{ slot: string; sourceFields: string[] }>;
  /** Strength breakdown bullets for the "See why this case is strong" drawer. */
  strengthBreakdown: Array<{ label: string; tone: "positive" | "neutral" | "negative"; detail: string }>;
  /** Only set for weak disputes — the checklist shown in "Needs merchant input". */
  merchantInputChecklist?: Array<{ id: string; label: string; required: boolean; detail: string }>;
}

export interface DemoDashboardStats {
  needsActionCount: number;
  urgentCount: number;
  amountAtRisk: number;
  amountRecovered30d: number;
  strongCasesCount: number;
  awaitingResponseCount: number;
  winRate30d: number;
  outcomeBreakdown: {
    won: number;
    lost: number;
    accepted: number;
    refunded: number;
  };
}

export interface DemoActivityEvent {
  id: string;
  at: string;
  type: "pack_created" | "evidence_saved" | "dispute_opened" | "dispute_won" | "support_note";
  disputeId: string;
  orderName: string;
  description: string;
}

export interface DemoPackTemplate {
  id: string;
  name: string;
  reason: string;
  evidenceCount: number;
  /** "Tested on 1,247 cases · 87% win rate" */
  trackRecord: string;
}
