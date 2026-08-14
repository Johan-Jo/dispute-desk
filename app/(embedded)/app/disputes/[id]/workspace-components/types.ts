/**
 * Workspace-specific types.
 * Maps the API response to typed structures for components.
 */

import type { ChecklistItemV2, SubmissionReadiness, WaivedItemRecord, WaiveReason } from "@/lib/types/evidenceItem";
import type { CaseStrengthResult, WhyWinsResult, RiskResult, ImprovementSignal, NextAction, MissingItemWithContext } from "@/lib/argument/types";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";
import type { DisputePresentation } from "@/lib/disputes/presentation/types";
import type { HeldState } from "@/lib/disputes/heldState";
import type { WorkspaceAssessmentPayload } from "@/lib/disputes/workspaceAssessmentTypes";

/** Canonical tab indices for the dispute-detail workspace. Order per
 *  reviewer direction 2026-07-24 (supersedes plan §6.0): Overview →
 *  Evidence → Review and Forward (the review/forward step sits
 *  rightmost, as the last step of the flow). ALWAYS use these
 *  constants — never raw numbers — so a future reorder is a one-line
 *  change. */
export const TAB_INDEX = {
  overview: 0,
  evidence: 1,
  reviewForward: 2,
} as const;

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
  /** Review-lifecycle state (2026-07-23). Gates + reflects the
   *  Hold/Approve/Concede action row on a parked/weak dispute. */
  needsReview?: boolean;
  needsAttention?: boolean;
  attentionReason?: string | null;
  reviewState?: "in_review" | "approved" | "conceded" | null;
  reviewDueAt?: string | null;
  /** Set by `syncDisputes` from Shopify's `evidenceSentOn`. Only
   *  meaningful when `submissionState === "submitted_confirmed"`.
   *  Drives the date in the Evidence-tab window-closed banner. */
  submittedAt: string | null;
  finalOutcome: string | null;
  /** Outcome card (plan §6.2): decision date + amounts for the
   *  dedicated won/lost Outcome block on the Overview tab. */
  closedAt?: string | null;
  outcomeAmountRecovered?: number | null;
  outcomeAmountLost?: number | null;
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
  /** ISO timestamp when the order was cancelled, or null. Read off the pack's
   *  order section — `deriveOrderContext` does not carry it. */
  cancelledAt?: string | null;
  /** Amount refunded, as the decimal string the pack persists ("0.0", "220.0").
   *  Null when the pack predates the field. */
  refundedAmount?: string | null;
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
  /** Credit-already-issued floor from `pack_json`. The client recomputes
   *  case strength live; without this it disagrees with the server and
   *  with what was actually submitted — blume-box 162042cd rendered
   *  "Weak case" for a dispute the system scored strong and had filed. */
  creditAlreadyIssued?: { triggered: boolean; coversDisputedAmount: boolean } | null;
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
  /** Gorgias evidence core: a review action happened after this pack
   *  was generated — the snapshot no longer reflects the curated
   *  communication evidence. Set atomically by the review RPCs; clears
   *  on regenerate. */
  gorgiasEvidenceStale?: boolean;
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

/** Gorgias evidence core — summaries only (client-safe mirror of
 *  lib/integrations/gorgias/workspaceBlock.ts, which is server-only).
 *  Full transcripts are lazily fetched per ticket. */
export interface GorgiasCommsMessageSummary {
  id: string;
  senderType: "customer" | "merchant";
  sentAt: string | null;
  reviewStatus: string;
  evidenceCategory: string | null;
  confidenceScore: number | null;
  relevanceExplanation: string | null;
  explanationEdited: boolean;
  approvedExcerptPreview: string | null;
  needsReapproval: boolean;
}

export interface GorgiasCommsTicketSummary {
  id: string;
  gorgiasTicketId: number;
  subject: string | null;
  channel: string | null;
  ticketCreatedAt: string | null;
  matchScore: number;
  confidence: "high" | "medium" | "low";
  matchStatus: "proposed_match" | "confirmed_match" | "rejected_match";
  matchReasons: Array<{ signal: string; points: number; detail?: string }>;
  analyzedAt: string | null;
  counts: { total: number; proposed: number; approved: number; excluded: number };
  reviewableMessages: GorgiasCommsMessageSummary[];
}

export interface GorgiasCommsBlock {
  integrationStatus: string;
  evidenceMode: "legacy_auto_include" | "merchant_review_required";
  errorCode: string | null;
  latestRun: {
    id: string;
    status: string;
    triggerSource: string;
    proposalCount: number;
    errorCode: string | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
  tickets: GorgiasCommsTicketSummary[];
}

export interface WorkspaceData {
  dispute: WorkspaceDispute;
  pack: WorkspacePack | null;
  /** Gorgias evidence core (null when the shop has no Gorgias
   *  integration — the review section self-hides). */
  gorgiasComms?: GorgiasCommsBlock | null;
  /** Merchant-facing submission state for the dispute. Drives the
   *  Overview hero copy, the timeline active step, and the Submission
   *  Summary panel's tense. Plan v2. */
  presentationStatus: PresentationStatus;
  /** Shared presentation model (lib/disputes/presentation) — the same
   *  lifecycle/attention/strength interpretation the list and dashboard
   *  use. The detail page must never re-derive these dimensions. */
  presentation?: DisputePresentation | null;
  /**
   * CP-A — case strength, completeness, readiness and filing state, all
   * derived ONCE on the server by `buildWorkspaceAssessment`.
   *
   * Before this existed the browser ran `calculateCaseStrength` itself, with
   * a gate set it assembled locally, and reconstructed submission readiness
   * from the checklist. The route computed its own answer on the same
   * request; on a fraud case with a cardholder-name mismatch the two
   * disagreed on one screen (client Strong, server Moderate).
   *
   * Optional on the type so a response from a deploy that predates the
   * server change degrades to `needsRecalculation` rather than to a wrong
   * number. That is deliberate: absent is a state, not a zero.
   */
  workspaceAssessment?: WorkspaceAssessmentPayload | null;
  /** Auto-pilot hold (lib/disputes/heldState) — resolved server-side
   *  from the SAME guard verdict the pipeline acted on, and shared with
   *  the new-dispute email so the page and the email cannot describe
   *  one dispute two ways. */
  held?: HeldState | null;
  /** Per-row dispute-detail view-model from `deriveEvidenceLineItems`.
   *  Single source of truth for every UI surface; never duplicated. */
  evidenceLineItems: EvidenceLineItem[];
  /** What was (or will be) sent to Shopify. Counts derive from
   *  `evidenceLineItems` so the panel cannot disagree with the rows. */
  submissionSummary: SubmissionSummary;
  /** @deprecated 2026-05-16 — structured field routing was retired.
   *  Always an empty array. Kept on the type for legacy consumers. */
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
    /** PR-C1 candidate-safety verdict for `latest`, computed server-side by
     *  the same predicate every save / forward path uses. When `blocked`, the
     *  card must show review-required and disable Finalize / Submit /
     *  Resubmit — the endpoints return 422 for these. `reasons` are machine
     *  codes for support; `message` is the merchant-safe sentence. */
    safety?: {
      blocked: boolean;
      reasons: string[];
      message: string;
    };
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
  // `billing_address_match` sat in this bucket until 2026-08-09 (PR-C4 /
  // C-14). It is a retired field — see `lib/evidence/model/retiredKeys.ts`.
  { key: "order", fields: ["order_confirmation"] },
  { key: "payment", fields: ["avs_cvv_match"] },
  { key: "fulfillment", fields: ["shipping_tracking", "delivery_proof"] },
  { key: "communication", fields: ["customer_communication"] },
  { key: "policy", fields: ["refund_policy", "shipping_policy", "cancellation_policy"] },
  { key: "identity", fields: ["activity_log"] },
  { key: "merchant", fields: ["supporting_documents", "product_description", "duplicate_explanation"] },
];

