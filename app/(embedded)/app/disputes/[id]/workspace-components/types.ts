/**
 * Workspace-specific types.
 * Maps the API response to typed structures for components.
 */

import type { ChecklistItemV2, SubmissionReadiness, WaivedItemRecord, WaiveReason } from "@/lib/types/evidenceItem";
import type { ArgumentMap, RebuttalDraft, RebuttalSection, CounterclaimNode, CaseStrengthResult, WhyWinsResult, RiskResult, ImprovementSignal, NextAction, MissingItemWithContext } from "@/lib/argument/types";

export type { ChecklistItemV2, SubmissionReadiness, WaivedItemRecord, WaiveReason };
export type { ArgumentMap, RebuttalDraft, RebuttalSection, CounterclaimNode, CaseStrengthResult, WhyWinsResult, RiskResult, ImprovementSignal, NextAction, MissingItemWithContext };

export interface EvidenceItemFull {
  id: string;
  type: string;
  label: string;
  source: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  actor_type: string;
  created_at: string;
}

export interface WorkspaceDispute {
  id: string;
  reason: string;
  reasonFamily?: string;
  phase: "inquiry" | "chargeback";
  amount: number;
  currency: string;
  orderName: string;
  orderGid: string;
  customerName: string;
  shopDomain: string;
  disputeGid: string;
  disputeEvidenceGid: string;
  dueAt: string | null;
  openedAt: string;
  normalizedStatus: string;
  submissionState: string;
  finalOutcome: string | null;
}

export interface WorkspacePack {
  id: string;
  status: string;
  completenessScore: number;
  submissionReadiness: SubmissionReadiness;
  checklistV2: ChecklistItemV2[];
  waivedItems: WaivedItemRecord[];
  evidenceItems: EvidenceItemFull[];
  auditEvents: AuditEvent[];
  pdfPath: string | null;
  savedToShopifyAt: string | null;
  activeBuildJob: { id: string; status: string } | null;
  /** Machine-readable failure code, set when status === "failed". */
  failureCode: string | null;
  /** Internal full error text. Never render directly to merchants. */
  failureReason: string | null;
}

export interface CaseTypeInfo {
  disputeType: string;
  toWin: string[];
  strongestEvidence: string[];
}

export interface SubmissionField {
  shopifyFieldName: string;
  shopifyFieldLabel: string;
  content: string;
  contentPreview: string;
  source: string;
  included: boolean;
}

/**
 * Normalized applied-rule mode as surfaced by the workspace API. Matches the
 * canonical AutomationMode — legacy values from historical audit rows are
 * collapsed at the API boundary before they reach the UI.
 */
export type AppliedRuleMode = "auto" | "review";

export interface AppliedRule {
  mode: AppliedRuleMode;
}

export interface WorkspaceData {
  dispute: WorkspaceDispute;
  pack: WorkspacePack | null;
  argumentMap: ArgumentMap | null;
  rebuttalDraft: RebuttalDraft | null;
  submissionFields: SubmissionField[];
  /** The rule decision for this dispute (from the latest rule_applied event). */
  appliedRule: AppliedRule | null;
  caseTypeInfo: CaseTypeInfo;
}

export interface EvidenceCategory {
  key: string;
  label: string;
  fields: string[];
}

export interface EvidenceItemWithStrength extends ChecklistItemV2 {
  strength: "strong" | "moderate" | "weak" | "none";
  impact: "critical" | "significant" | "minor" | "negligible";
  content: Record<string, unknown> | null;
}

export const EVIDENCE_CATEGORIES: EvidenceCategory[] = [
  { key: "order", label: "Order Facts", fields: ["order_confirmation", "billing_address_match"] },
  { key: "payment", label: "Payment Verification", fields: ["avs_cvv_match"] },
  { key: "fulfillment", label: "Fulfillment & Delivery", fields: ["shipping_tracking", "delivery_proof"] },
  { key: "communication", label: "Customer Communication", fields: ["customer_communication"] },
  { key: "policy", label: "Policies & Disclosures", fields: ["refund_policy", "shipping_policy", "cancellation_policy"] },
  { key: "identity", label: "Customer Identity & History", fields: ["activity_log"] },
  { key: "merchant", label: "Merchant Evidence", fields: ["supporting_documents", "product_description", "duplicate_explanation"] },
];

export const CATEGORY_RELEVANCE: Record<string, Record<string, "high" | "medium" | "low">> = {
  FRAUDULENT: { order: "high", payment: "high", fulfillment: "medium", communication: "medium", policy: "low", identity: "high", merchant: "medium" },
  PRODUCT_NOT_RECEIVED: { order: "high", payment: "low", fulfillment: "high", communication: "medium", policy: "medium", identity: "low", merchant: "medium" },
  PRODUCT_UNACCEPTABLE: { order: "high", payment: "low", fulfillment: "medium", communication: "high", policy: "high", identity: "low", merchant: "high" },
  SUBSCRIPTION_CANCELED: { order: "high", payment: "low", fulfillment: "low", communication: "high", policy: "high", identity: "low", merchant: "medium" },
  DUPLICATE: { order: "high", payment: "low", fulfillment: "low", communication: "low", policy: "low", identity: "low", merchant: "high" },
  GENERAL: { order: "high", payment: "low", fulfillment: "medium", communication: "medium", policy: "medium", identity: "low", merchant: "medium" },
};
