/**
 * `decideFileAttachments` — single policy brain for the conditional
 * file evidence layer (Phase 2 of `docs/plans/conditional_file_evidence_layer.plan.md`).
 *
 * Pure function. No I/O. No DB, no Shopify, no fs. Given the case
 * strength, the dispute reason, the gate flags, and a list of
 * file-eligible candidates, it returns an ordered plan of how each
 * candidate should land — natively in a Shopify `*File` slot, or
 * fall back to a labelled link in `uncategorizedText`.
 *
 * Hard rules (kept verbatim from the plan):
 *
 *  1. **Strength is read-only.** This function does not change
 *     `calculateCaseStrength`. It only consumes its output.
 *  2. **Gates are non-bypass.** Coverage gate active → empty plan.
 *     Fatal-loss gate active → empty plan. The file plan does not
 *     change auto-save eligibility.
 *  3. **Strength rules:**
 *     - `strong`       → empty plan (already winning; don't add noise).
 *     - `moderate`     → up to 2 file-eligible candidates allowed.
 *     - `weak`         → only when ≥1 candidate has `priority === "strong"`;
 *                        max 2.
 *     - `insufficient` → empty plan.
 *  4. **No supporting-only attachments.** Candidates whose effective
 *     category is `supporting` or `invalid` are filtered out at the
 *     boundary by the `categorizeEvidenceField` call — they never
 *     enter the plan.
 *  5. **Reason-aware UI rendering** (Phase 0c, 2026-05-03): Shopify's
 *     chargeback-response card hides `*File` rows that aren't relevant
 *     to the dispute reason. A candidate whose `targetField` is
 *     hidden is **dropped from the plan entirely** — it would consume
 *     a native attachment but produce no merchant- or issuer-visible
 *     benefit.
 *  6. **Same-`targetField` overflow rule:** when two candidates
 *     resolve to the same primary slot, higher priority wins; the
 *     loser is reassigned to `uncategorizedFile` if free, otherwise
 *     drops to a link with `fallbackReason: "no_slot_available"`.
 *  7. **Pack PDF stays as a link.** The pack PDF is not a candidate
 *     here — it ships unconditionally as a labelled link in
 *     `uncategorizedText`, regardless of the plan output (Q3=B in the
 *     v2 plan).
 *  8. **Max 2.** After all resolution, only the top 2 candidates by
 *     priority survive. Excess candidates are not represented in the
 *     plan at all (they continue to ship as labelled links via the
 *     existing manual-attachments path; from `decide`'s perspective
 *     they are simply not selected).
 */

import {
  CANONICAL_EVIDENCE,
  categorizeEvidenceField,
  isFileEligible,
  type EvidenceCategory,
} from "@/lib/argument/canonicalEvidence";

/**
 * Manual-upload effective category.
 *
 * `categorizeEvidenceField` is built for **structured pack sections** —
 * delivery_proof needs `payload.proofType`, customer_communication
 * needs `payload.customerConfirmsOrder`, refund_policy needs
 * `payload.acceptedAtCheckout`, etc. Without those discriminators it
 * returns `invalid` (e.g. `proofType` defaults to `"label_created"`).
 *
 * Manual uploads from `evidence_items` carry only `{ fileName,
 * fileType, fileSize, storagePath, checklistField }` — no
 * discriminator. Categorising them via the same path would always
 * return `invalid`, which would empty every plan and make the file
 * evidence layer a no-op for the most common input (a merchant
 * uploading a file from the Evidence tab).
 *
 * Heuristic: when the candidate's payload looks like a manual upload
 * (has `fileName`, no discriminator) AND the registry says the field
 * is `fileEligible`, treat the merchant's act of assigning the file
 * to that checklist row as a **moderate** claim. The categorizer
 * still wins when it can produce a verdict (a structured section
 * with `proofType: "signature_confirmed"` stays `strong`).
 */
function categorizeForFilePlan(
  fieldKey: string,
  payload: Record<string, unknown> | null | undefined,
): EvidenceCategory {
  const fromRegistry = categorizeEvidenceField(fieldKey, payload);
  if (fromRegistry === "strong" || fromRegistry === "moderate") {
    return fromRegistry;
  }

  const p = (payload ?? {}) as Record<string, unknown>;
  const looksLikeManualUpload =
    typeof p.fileName === "string" && (p.fileName as string).length > 0;
  if (!looksLikeManualUpload) return fromRegistry;

  // The discriminators `categorizeEvidenceField` consults — if any of
  // these is present, defer to its verdict (don't mask a legitimate
  // `invalid` / `supporting` classification).
  const hasDiscriminator =
    p.proofType !== undefined ||
    p.customerConfirmsOrder !== undefined ||
    p.signedContract === true ||
    p.acceptedAtCheckout === true ||
    p.decisiveSessionProof === true ||
    p.digitalAccessUsed === true ||
    p.tdsVerified === true ||
    p.tdsAuthenticated === true ||
    p.match === true;
  if (hasDiscriminator) return fromRegistry;

  return "moderate";
}
import {
  resolveReasonFamily,
  type ReasonFamily,
} from "@/lib/argument/reasonFamily";
import type { CaseStrengthLevel } from "@/lib/argument/types";

/* ── Types ────────────────────────────────────────────────────────────── */

/** The six readable + writable file fields on
 *  `ShopifyPaymentsDisputeEvidenceUpdateInput`. Locked enum (Phase 0b). */
export type NamedFileField =
  | "cancellationPolicyFile"
  | "customerCommunicationFile"
  | "refundPolicyFile"
  | "shippingDocumentationFile"
  | "uncategorizedFile"
  | "serviceDocumentationFile";

/** PDF layout key consumed by the `generateEvidenceAttachmentPdf` facade
 *  (Phase 4). Layout branches on this; content selection branches on
 *  `evidenceFieldKey`. */
export type AttachmentType =
  | "delivery"
  | "communication"
  | "service"
  | "policy"
  | "other";

/** A candidate evidence item the merchant has uploaded that is
 *  file-eligible per the canonical registry. */
export interface FileAttachmentCandidate {
  /** Stable id of the `evidence_items` row. Phase 3 uses this to
   *  fetch the bytes and to suppress the corresponding link in
   *  `uncategorizedText` when the candidate lands natively. */
  evidenceItemId: string;
  /** Canonical field key (`delivery_proof`, `customer_communication`,
   *  …). Drives priority via `categorizeEvidenceField` and slot
   *  selection via `TARGET_FIELD_BY_EVIDENCE_KEY`. */
  evidenceFieldKey: string;
  /** Payload used for category derivation. */
  payload: Record<string, unknown> | null | undefined;
  /** Optional merchant-facing label (used to enrich `reason` strings). */
  label?: string | null;
  /** Filename hint (Phase 3 uses this when constructing the upload
   *  filename Shopify shows in Admin). Not used by the planner. */
  fileName?: string | null;
}

export interface DecideFileAttachmentsInput {
  /** Output of `calculateCaseStrength().overall`. Read-only here. */
  caseStrength: CaseStrengthLevel;
  /** Dispute reason (uppercase Shopify enum, e.g. `FRAUDULENT`).
   *  Drives reason-aware slot filtering. Null when unknown. */
  disputeReason: string | null | undefined;
  /** Coverage gate (Shopify Protect) is active. When true, plan is
   *  empty — coverage beats everything. */
  coverageActive: boolean;
  /** Fatal-loss gate is active. When true, plan is empty — adding
   *  attachments to a structurally unwinnable case is wasted effort. */
  fatalLossActive: boolean;
  /** Candidates the merchant has uploaded that pass `isFileEligible`.
   *  Caller is responsible for the eligibility filter — `decide`
   *  re-asserts it defensively but does not enumerate the registry
   *  itself. */
  candidates: FileAttachmentCandidate[];
}

export type FileAttachmentPlanEntry = {
  evidenceItemId: string;
  evidenceFieldKey: string;
  attachmentType: AttachmentType;
  priority: "strong" | "moderate";
  /** Human-readable string for the Review & Submit UI + audit trail. */
  reason: string;
  resolvedSlot:
    | { kind: "native"; targetField: NamedFileField; origin: "primary" | "overflow" }
    | {
        kind: "link";
        fallbackReason:
          | "no_slot_available"
          | "reason_hidden_for_dispute";
      };
};

/* ── Static maps ─────────────────────────────────────────────────────── */

/** Preferred `*File` slot per `evidenceFieldKey`. When the slot is
 *  hidden by Shopify's reason-aware UI (see `VISIBLE_SLOTS_BY_FAMILY`)
 *  the candidate is dropped from the plan, NOT silently retargeted to
 *  `uncategorizedFile` — the underlying evidence type is no longer
 *  relevant to the dispute reason. */
const TARGET_FIELD_BY_EVIDENCE_KEY: Record<string, NamedFileField> = {
  delivery_proof: "shippingDocumentationFile",
  shipping_tracking: "shippingDocumentationFile",
  customer_communication: "customerCommunicationFile",
  activity_log: "serviceDocumentationFile",
  supporting_documents: "uncategorizedFile",
  refund_policy: "refundPolicyFile",
  // No `shippingPolicyFile` exists in Shopify's six file fields, so
  // shipping policy piggybacks on `uncategorizedFile` when surfaced.
  shipping_policy: "uncategorizedFile",
  cancellation_policy: "cancellationPolicyFile",
};

/** Layout key for the PDF generator facade (Phase 4). */
const ATTACHMENT_TYPE_BY_FIELD: Record<string, AttachmentType> = {
  delivery_proof: "delivery",
  shipping_tracking: "delivery",
  customer_communication: "communication",
  activity_log: "service",
  supporting_documents: "other",
  refund_policy: "policy",
  shipping_policy: "policy",
  cancellation_policy: "policy",
};

/**
 * Visible `*File` rows per dispute-reason family.
 *
 * **Conservative policy: the fraud-verified shape is applied to every
 * family until empirically verified otherwise.**
 *
 * Phase 0c (2026-05-03) confirmed visually that for `FRAUDULENT`
 * exactly four `*File` rows render in Shopify Admin's chargeback
 * response screen: `customerCommunicationFile`,
 * `shippingDocumentationFile`, `serviceDocumentationFile`,
 * `uncategorizedFile`. The policy slots (`refundPolicyFile`,
 * `cancellationPolicyFile`) are accepted by the API but **hidden**
 * from the merchant UI on fraud disputes.
 *
 * Per-family verification of the other six families (refund,
 * subscription, delivery, product, billing, digital) requires real
 * disputes of those reason types — currently unavailable on the
 * `surasvenne` dev store, where every dispute is `FRAUDULENT`. Until
 * a real-world non-fraud dispute is observed in Shopify Admin to
 * confirm the policy slots actually render, we **do not widen** the
 * visible set.
 *
 * Effect on policy attachments: `refund_policy` / `cancellation_policy`
 * candidates currently fall to the `reason_hidden_for_dispute` link
 * fallback for every family — they ship as labelled links inside
 * `uncategorizedText`, never as native attachments. This is by design:
 * shipping a hidden native slot would consume an attachment slot
 * without producing any merchant- or issuer-visible benefit, so links
 * are strictly better.
 *
 * **Widening this table requires a captured screenshot from Shopify
 * Admin showing the new slot rendered on the relevant reason family.**
 * Add a comment citing the screenshot before widening; never widen
 * speculatively.
 */
const FRAUD_VERIFIED_SLOTS: ReadonlySet<NamedFileField> = new Set<NamedFileField>([
  "customerCommunicationFile",
  "shippingDocumentationFile",
  "serviceDocumentationFile",
  "uncategorizedFile",
]);

const VISIBLE_SLOTS_BY_FAMILY: Record<ReasonFamily, ReadonlySet<NamedFileField>> = {
  // Verified 2026-05-03 against `surasvenne` dev store.
  fraud: FRAUD_VERIFIED_SLOTS,
  // Conservative: not yet verified for these families. Use the
  // fraud-verified shape until a real dispute of each type is observed
  // in Admin. See `docs/.shopify-evidence/phase-0-results/` for the
  // verification protocol.
  delivery: FRAUD_VERIFIED_SLOTS,
  product: FRAUD_VERIFIED_SLOTS,
  refund: FRAUD_VERIFIED_SLOTS,
  subscription: FRAUD_VERIFIED_SLOTS,
  billing: FRAUD_VERIFIED_SLOTS,
  digital: FRAUD_VERIFIED_SLOTS,
  general: FRAUD_VERIFIED_SLOTS,
};

const MAX_NATIVE_ATTACHMENTS = 2;

/* ── Reason builder ──────────────────────────────────────────────────── */

function buildReason(
  candidate: FileAttachmentCandidate,
  category: EvidenceCategory,
): string {
  const spec = CANONICAL_EVIDENCE[candidate.evidenceFieldKey];
  const label = candidate.label?.trim() || spec?.label || candidate.evidenceFieldKey;
  const strength = category === "strong" ? "strong" : "moderate";
  return `${label} — ${strength} signal; attached natively to amplify visibility in the bank's review.`;
}

/* ── Main planner ────────────────────────────────────────────────────── */

export function decideFileAttachments(
  input: DecideFileAttachmentsInput,
): FileAttachmentPlanEntry[] {
  const { caseStrength, disputeReason, coverageActive, fatalLossActive, candidates } = input;

  // Rules 1–2: gates are non-bypass.
  if (coverageActive || fatalLossActive) return [];

  // Rule 3: strength gate.
  if (caseStrength === "strong" || caseStrength === "insufficient") return [];

  // 1. Categorise + filter to file-eligible, non-supporting candidates.
  type Scored = {
    cand: FileAttachmentCandidate;
    priority: "strong" | "moderate";
    targetField: NamedFileField;
    attachmentType: AttachmentType;
    order: number;
  };

  const scored: Scored[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (!isFileEligible(cand.evidenceFieldKey)) continue;

    const category = categorizeForFilePlan(cand.evidenceFieldKey, cand.payload);
    if (category !== "strong" && category !== "moderate") continue;

    const targetField = TARGET_FIELD_BY_EVIDENCE_KEY[cand.evidenceFieldKey];
    const attachmentType = ATTACHMENT_TYPE_BY_FIELD[cand.evidenceFieldKey];
    if (!targetField || !attachmentType) continue;

    scored.push({
      cand,
      priority: category,
      targetField,
      attachmentType,
      order: i,
    });
  }

  if (scored.length === 0) return [];

  // 2. Weak-case rule: require ≥1 strong-priority candidate.
  if (caseStrength === "weak") {
    const hasStrong = scored.some(s => s.priority === "strong");
    if (!hasStrong) return [];
  }

  // 3. Reason-aware slot filtering — drop candidates whose targetField
  //    is hidden by Shopify on this dispute reason.
  const family = resolveReasonFamily(disputeReason);
  const visibleSlots = VISIBLE_SLOTS_BY_FAMILY[family];
  const visible: Scored[] = [];
  const reasonHidden: Scored[] = [];
  for (const s of scored) {
    if (visibleSlots.has(s.targetField)) {
      visible.push(s);
    } else {
      reasonHidden.push(s);
    }
  }

  // 4. Sort visible by priority desc, then by candidate order.
  const PRIORITY_ORDER = { strong: 0, moderate: 1 } as const;
  visible.sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return a.order - b.order;
  });

  // 5. Slot resolution: each visible slot holds one file. Conflicts
  //    resolve to overflow (uncategorizedFile if free + visible) else
  //    to link.
  const usedSlots = new Set<NamedFileField>();
  const plan: FileAttachmentPlanEntry[] = [];

  for (const s of visible) {
    if (plan.filter(p => p.resolvedSlot.kind === "native").length >= MAX_NATIVE_ATTACHMENTS) {
      // Already at the native cap — this candidate cannot get a slot
      // (per plan rule 8, excess just doesn't enter the plan).
      break;
    }

    const cat = categorizeForFilePlan(s.cand.evidenceFieldKey, s.cand.payload);
    const reason = buildReason(s.cand, cat);

    if (!usedSlots.has(s.targetField)) {
      usedSlots.add(s.targetField);
      plan.push({
        evidenceItemId: s.cand.evidenceItemId,
        evidenceFieldKey: s.cand.evidenceFieldKey,
        attachmentType: s.attachmentType,
        priority: s.priority,
        reason,
        resolvedSlot: { kind: "native", targetField: s.targetField, origin: "primary" },
      });
      continue;
    }

    // Slot conflict — try overflow into uncategorizedFile if it's free
    // AND visible for this reason.
    if (
      !usedSlots.has("uncategorizedFile") &&
      visibleSlots.has("uncategorizedFile")
    ) {
      usedSlots.add("uncategorizedFile");
      plan.push({
        evidenceItemId: s.cand.evidenceItemId,
        evidenceFieldKey: s.cand.evidenceFieldKey,
        attachmentType: s.attachmentType,
        priority: s.priority,
        reason,
        resolvedSlot: { kind: "native", targetField: "uncategorizedFile", origin: "overflow" },
      });
      continue;
    }

    // Overflow exhausted — fall to link.
    plan.push({
      evidenceItemId: s.cand.evidenceItemId,
      evidenceFieldKey: s.cand.evidenceFieldKey,
      attachmentType: s.attachmentType,
      priority: s.priority,
      reason,
      resolvedSlot: { kind: "link", fallbackReason: "no_slot_available" },
    });
  }

  // 6. Surface reason-hidden candidates as link entries IF we still
  //    have room under the max-2 (output) cap. They cannot become
  //    native (slot is hidden), but the Review & Submit UI may still
  //    want to show "we wanted to attach this; here's why we couldn't".
  //    Skip if we already have 2 entries — keeps the plan compact.
  for (const s of reasonHidden) {
    if (plan.length >= MAX_NATIVE_ATTACHMENTS) break;
    const cat = categorizeForFilePlan(s.cand.evidenceFieldKey, s.cand.payload);
    plan.push({
      evidenceItemId: s.cand.evidenceItemId,
      evidenceFieldKey: s.cand.evidenceFieldKey,
      attachmentType: s.attachmentType,
      priority: s.priority,
      reason: buildReason(s.cand, cat),
      resolvedSlot: { kind: "link", fallbackReason: "reason_hidden_for_dispute" },
    });
  }

  return plan;
}
