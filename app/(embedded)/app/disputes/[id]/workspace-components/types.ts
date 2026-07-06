/**
 * Workspace-specific types.
 * Maps the API response to typed structures for components.
 */

import type { ChecklistItemV2, SubmissionReadiness, WaivedItemRecord, WaiveReason } from "@/lib/types/evidenceItem";
import type { CaseStrengthResult, WhyWinsResult, RiskResult, ImprovementSignal, NextAction, MissingItemWithContext } from "@/lib/argument/types";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";

export type { ChecklistItemV2, SubmissionReadiness, WaivedItemRecord, WaiveReason };
export type { CaseStrengthResult, WhyWinsResult, RiskResult, ImprovementSignal, NextAction, MissingItemWithContext };

/** Merchant-facing dispute submission state. Derived server-side by
 *  the workspace API from the underlying DB enums + Shopify forwarding
 *  signal. Card-network wording is only permitted in SUBMITTED_TO_NETWORK
 *  and CLOSED_*. */
export type PresentationStatus =
  | "DRAFT"
  | "SAVED_TO_SHOPIFY"
  | "AWAITING_SHOPIFY_AUTO_SUBMISSION"
  | "SUBMITTED_TO_NETWORK"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "CLOSED_UNKNOWN";

export interface SubmissionSummary {
  pdfFileName: string | null;
  shopifyStructuredFields: Array<{
    field: "customer_first_name" | "customer_last_name" | "customer_email";
    value: string | null;
  }>;
  factsInPdf: Array<{ field: string; label: string; categoryLabel: string }>;
  counts: {
    usedAsPositiveBankArgument: number;
    contextOnly: number;
    internalOnly: number;
    excluded: number;
    notSupported: number;
    failedUpload: number;
    waived: number;
  };
}

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
  shopId?: string;
  shopDomain: string;
  disputeGid: string;
  disputeEvidenceGid: string;
  dueAt: string | null;
  openedAt: string;
  normalizedStatus: string;
  submissionState: string;
  /** Set by `syncDisputes` from Shopify's `evidenceSentOn`. Only
   *  meaningful when `submissionState === "submitted_confirmed"`.
   *  Drives the date in the Evidence-tab window-closed banner. */
  submittedAt: string | null;
  finalOutcome: string | null;
  /** Order-context fields extracted from `pack_json.sections` by
   *  `deriveOrderContext`. Populates the Case Details table on the
   *  embedded Review & Submit tab so it matches the PDF rendering.
   *  Each field can still be null when the pack lacks the data. */
  cardNetwork?: string | null;
  cardLast4?: string | null;
  transactionDate?: string | null;
  paymentGateway?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  cardholderName?: string | null;
  /** Full event timeline from the pack's access_log section — the SAME
   *  array the PDF builder threads through `meta.timelineEvents`. The
   *  embedded HTML view's Chronology of Events bullets render from
   *  this, NOT from a parallel synthetic-2-event implementation. */
  timelineEvents?: Array<{ at: string; text: string }>;
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
  /** Last successful build timestamp (`evidence_packs.updated_at`).
   *  Used by the rebuild-outcome banner to detect stale outcomes —
   *  buildPack clears the outcome columns on success, but if a write
   *  is missed or a race lands the wrong row, the banner falls back
   *  to a timestamp comparison: when `lastRebuildAt < updatedAt`, the
   *  outcome describes a save attempt against a previous build, so
   *  the banner suppresses itself. */
  updatedAt: string | null;
  /** Resubmission Window: true when a merchant regenerate request is
   *  pending. Set by the regenerate endpoint and cleared by
   *  `buildPackJob` at start. Used to drive the "Regenerating defence
   *  package" banner during the gap between request and worker pickup. */
  rebuildPending: boolean;
  /** Resubmission Window: user-facing outcome of the most recent
   *  regenerate attempt. NOT authoritative submission state — see
   *  `lib/automation/rebuildOutcome.ts`. Drives the Evidence-tab outcome
   *  banner that explains "we rebuilt, here's what happened". `null`
   *  on first-time packs that have never been regenerated. */
  lastRebuildOutcome:
    | "saved"
    | "improved"
    | "blocked_weak"
    | "blocked_fatal_loss"
    | "blocked_covered"
    | "blocked_no_material_change"
    | "failed"
    | null;
  lastRebuildAt: string | null;
  lastRebuildReason: string | null;
  activeBuildJob: { id: string; status: string } | null;
  /** Machine-readable failure code, set when status === "failed". */
  failureCode: string | null;
  /** Internal full error text. Never render directly to merchants. */
  failureReason: string | null;
  /** Coverage Gate (PRD §4) — when `state === "covered_shopify"` the
   *  hero swaps to the "Covered by Shopify" state and no merchant
   *  workflow is required. Surfaced from `pack_json.coverage`. */
  coverage: {
    state: "covered_shopify" | "not_covered";
    shopifyProtectStatus:
      | "ACTIVE"
      | "INACTIVE"
      | "NOT_PROTECTED"
      | "PENDING"
      | "PROTECTED"
      | null;
  } | null;
  /** File evidence layer record. One entry per native attachment that
   *  was uploaded to Shopify and assigned to a `*File` slot. Empty
   *  when the file evidence flag is off or no native attachments
   *  landed. Surfaces in the Evidence tab as a clip-icon badge and
   *  in Review & Submit as a per-file routing row. */
  attachmentUploads?: Array<{
    evidenceItemId: string;
    evidenceFieldKey: string;
    targetField: string;
    fileGid: string;
    uploadedAt: string;
  }>;
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
  /** Merchant-facing submission state for the dispute. Drives the
   *  Overview hero copy, the timeline active step, and the Submission
   *  Summary panel's tense. Plan v2. */
  presentationStatus: PresentationStatus;
  /** Per-row dispute-detail view-model from `deriveEvidenceLineItems`.
   *  Single source of truth for every UI surface; never duplicated. */
  evidenceLineItems: EvidenceLineItem[];
  /** What was (or will be) sent to Shopify. Counts derive from
   *  `evidenceLineItems` so the panel cannot disagree with the rows. */
  submissionSummary: SubmissionSummary;
  /** @deprecated 2026-05-16 — structured field routing was retired.
   *  Always an empty array. Kept on the type for legacy consumers. */
  submissionFields?: SubmissionField[];
  /** First-class file inventory derived from
   *  `pack.evidenceItems[*].payload.fileId`. Plan v3 §3.A.4. Always
   *  an array; empty array is the explicit empty state for the
   *  Review tab's "Supporting documents" section. */
  attachments?: WorkspaceAttachment[];
  /** The rule decision for this dispute (from the latest rule_applied event). */
  appliedRule: AppliedRule | null;
  caseTypeInfo: CaseTypeInfo;
  /** File evidence layer status (Phase 7b). Drives the reinstall
   *  consent banner: when `flagEnabled === true && scopesGranted ===
   *  false`, the merchant is on a pre-f61176c session and must
   *  reinstall to grant the new dispute file upload scopes. */
  fileEvidence?: {
    flagEnabled: boolean;
    scopesGranted: boolean;
    missingScopes: string[];
  };
  /** Defence package rows for the embedded ReviewSubmitTab. Folded
   *  into the workspace endpoint (2026-05-25) so
   *  `CompleteDefencePackageCard` no longer pays a separate fetch
   *  round-trip every time the merchant switches to Review & Submit.
   *  Both rows are kept fresh by the workspace's existing 4s poll.
   *
   *  Rows are typed as `unknown` here so this shared module doesn't
   *  need to import the defence narrative / facts types; the card
   *  narrows to its local `DefencePackageRow` at the consumption
   *  site. */
  defencePackage?: {
    latest: unknown | null;
    bankFacing: unknown | null;
    currentPromptVersion: number | null;
  };
}

export interface EvidenceCategory {
  key: string;
  fields: string[];
}

export interface EvidenceItemWithStrength extends ChecklistItemV2 {
  strength: "strong" | "moderate" | "weak" | "none";
  impact: "critical" | "significant" | "minor" | "negligible";
  content: Record<string, unknown> | null;
  /** Raw payload from `pack.evidenceItemsByField[field]` — fed to
   *  `categoryFor()` so the per-row strength pill reflects the canonical
   *  registry rather than dispute-reason heuristics. Plan v3 §P2.7. */
  payload: Record<string, unknown> | null;
}

// Render sites translate via `t("disputes.evidenceCategoryLabel." + cat.key)`.
export const EVIDENCE_CATEGORIES: EvidenceCategory[] = [
  { key: "order", fields: ["order_confirmation", "billing_address_match"] },
  { key: "payment", fields: ["avs_cvv_match"] },
  { key: "fulfillment", fields: ["shipping_tracking", "delivery_proof"] },
  { key: "communication", fields: ["customer_communication"] },
  { key: "policy", fields: ["refund_policy", "shipping_policy", "cancellation_policy"] },
  { key: "identity", fields: ["activity_log"] },
  { key: "merchant", fields: ["supporting_documents", "product_description", "duplicate_explanation"] },
];

