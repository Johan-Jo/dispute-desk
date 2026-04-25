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
  /** Server-built ID-keyed lookup: `evidenceFieldKey` → first
   *  evidence item exposing that field via payload.fieldsProvided.
   *  Plan v3 §3.A.5. Optional — older API responses may omit it. */
  evidenceItemsByField?: Record<string, EvidenceItemFull>;
  auditEvents: AuditEvent[];
  pdfPath: string | null;
  savedToShopifyAt: string | null;
  activeBuildJob: { id: string; status: string } | null;
  /** Machine-readable failure code, set when status === "failed". */
  failureCode: string | null;
  /** Internal full error text. Never render directly to merchants. */
  failureReason: string | null;
}

export interface WorkspaceAttachment {
  id: string;
  /** Resolves through `counterclaim.supporting/missing/systemUnavailable[*].evidenceFieldKey`
   *  and `pack.evidenceItemsByField`. Null for attachments that
   *  weren't tagged to a checklist field. */
  evidenceFieldKey: string | null;
  label: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  source: string | null;
  fileId: string;
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
  /** First-class file inventory derived from
   *  `pack.evidenceItems[*].payload.fileId`. Plan v3 §3.A.4. Always
   *  an array; empty array is the explicit empty state for the
   *  Review tab's "Supporting documents" section. */
  attachments?: WorkspaceAttachment[];
  /** True when the pack was updated after the saved rebuttal draft — regenerate argument to refresh the letter. */
  rebuttalOutdated?: boolean;
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
