/**
 * Concrete-contribution predicate — the single-sourced gate for "the
 * merchant can actually add this specific item".
 *
 * Relocated from app/(embedded)/app/disputes/[id]/hooks/
 * useDisputeWorkspace.ts so the server-side presentation resolver, the
 * detail workspace, and the list route share ONE definition (plan
 * §12V item 4). The hook re-exports these for its existing consumers.
 *
 * This is what makes attention=`recommended`/`opportunity` concrete:
 * a specific checklist field the merchant can provide — NEVER generic
 * improvementHint/strength copy (plan §3.1 rung 4).
 */

import { getCanonicalSpec } from "@/lib/argument/canonicalEvidence";

export interface FieldAction {
  actionType: "upload" | "paste" | "note";
}

/** Per-field action metadata for merchant-addable items. CTA text comes
 *  from i18n (`disputes.fieldAction.*`); this carries only the type. */
export const FIELD_ACTIONS: Record<string, FieldAction> = {
  supporting_documents: { actionType: "upload" },
  customer_communication: { actionType: "paste" },
  product_description: { actionType: "upload" },
  duplicate_explanation: { actionType: "paste" },
};

export const DEFAULT_FIELD_ACTION: FieldAction = { actionType: "upload" };

/** Set of evidence fields the merchant can directly act on (upload or
 * paste). Derived from `FIELD_ACTIONS` so the allowlist stays in sync
 * with the per-field CTA config. Other fields (`avs_cvv_match`,
 * `ip_location_check`, etc.) are gateway/system signals where a manual
 * upload doesn't make semantic sense.
 *
 * Why this is the gate (and `collectionType !== "auto"` is not):
 * `customer_communication` is marked `collection_type=auto` in the
 * checklist generator because Shopify *attempts* to pull it from
 * order notes — but it only becomes Strong via
 * `payload.customerConfirmsOrder === true`, which requires the
 * merchant to provide a conversation. Auto-collection is a
 * best-effort fallback there; merchant upload is the actual path to
 * strength, and the UI must surface it. */
export const MERCHANT_ACTIONABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(FIELD_ACTIONS),
);

/** Fields that are UNAMBIGUOUSLY system-derived: the data comes from a
 *  source outside the merchant's control (payment gateway, carrier,
 *  Shopify's risk engine, IPinfo, etc.). The merchant cannot upload
 *  these by definition — surfacing Upload/Mark-not-applicable buttons
 *  for them is misleading.
 *
 *  This list is the inverse of MERCHANT_ACTIONABLE_FIELDS for the
 *  fields the canonical registry knows about. Kept as an explicit
 *  allowlist (not derived) so a future template/registry change that
 *  inadvertently nulls `collectionType` cannot accidentally promote
 *  a system signal back to a merchant task. Same set as
 *  SOURCE_OUTSIDE_MERCHANT_CONTROL in lib/argument/evidenceLineItem.ts.
 */
export const SYSTEM_DERIVED_FIELDS: ReadonlySet<string> = new Set([
  "avs_cvv_match",
  "tds_authentication",
  "fraud_risk_screening",
  "ip_location_check",
  "device_session_consistency",
  "shipping_tracking",
  "delivery_proof",
  "order_confirmation",
  "customer_account_info",
  "activity_log",
  // product_description is also a FIELD_ACTIONS key (upload CTA config),
  // so this denylist entry was previously DEAD — MERCHANT_ACTIONABLE_FIELDS
  // won the precedence check and it got the upload nag anyway. The
  // supportingOnly guard at the top of canMerchantUpload now refuses it
  // (and every other weight-0 field) before either list is consulted, so
  // this entry is belt-and-suspenders.
  "product_description",
]);

/** True when the merchant should see an upload affordance on a
 *  missing evidence row. Used by the Overview tab "Add this evidence"
 *  CTA, the Evidence tab inventory + per-row Upload button, AND the
 *  server-side attention resolver, so the policy is single-sourced.
 *
 *  Precedence:
 *   1. `MERCHANT_ACTIONABLE_FIELDS` allowlist → always allow upload.
 *   2. `SYSTEM_DERIVED_FIELDS` denylist → always refuse.
 *   3. Otherwise: only allow when `collectionType` is explicitly
 *      `manual` or `conditional_auto`. Absent → no upload (strict).
 *
 *  The `supportingOnly` guard refuses weight-0 fields before either
 *  list is consulted — uploading one provably cannot change case
 *  strength, so nagging for it is dishonest (prod dispute 8f90a8f0,
 *  2026-07-23). */
export function canMerchantUpload(item: {
  field: string;
  collectionType?: string;
}): boolean {
  if (NEVER_MERCHANT_UPLOADABLE.has(item.field)) return false;
  return canMerchantUploadAtBuild(item);
}

/**
 * The pre-F-1a rule, kept ONLY for the three call sites in
 * `lib/automation/completeness.ts` that write `recommended_actions` into a
 * persisted pack. Those outputs are stored and printed (PDF), so PR 1 leaves
 * them byte-identical; the display surfaces (workspace, list, pack page)
 * use `canMerchantUpload`. Do not call this from a display surface.
 */
export function canMerchantUploadAtBuild(item: {
  field: string;
  collectionType?: string;
}): boolean {
  if (getCanonicalSpec(item.field)?.supportingOnly === true) return false;
  if (MERCHANT_ACTIONABLE_FIELDS.has(item.field)) return true;
  if (SYSTEM_DERIVED_FIELDS.has(item.field)) return false;
  return item.collectionType === "manual" || item.collectionType === "conditional_auto";
}

/**
 * Fields a merchant can never satisfy by attaching a file (plan §3.1 F-1a, §4.2).
 *
 *  - `refund_record` is Shopify's own record of a refund. The collector adds it
 *    only when the refunded total is above zero, so a MISSING row already means
 *    "no confirmed refund amount" — an upload can only ever land as generic
 *    manual evidence and was never the refund record (0 prod uploads ever).
 *    Proof of a refund made outside Shopify belongs on `supporting_documents`.
 *  - `no_return_initiated` is a conclusion drawn from Shopify's return status;
 *    the merchant's real channel is the return-request answer.
 *
 * Field-level on purpose: the list (`serverFacts.ts`) selects only the stored
 * checklist and cannot see the order, so this is the one rule every caller
 * shares. It changes no score and no readiness (the rows are critical or
 * skipped by the `recommended_actions` rule), only the upload affordance.
 */
export const NEVER_MERCHANT_UPLOADABLE: ReadonlySet<string> = new Set([
  "refund_record",
  "no_return_initiated",
]);

/** Minimal checklist-row shape the derivation needs (a subset of
 *  ChecklistItemV2 as persisted in `pack_json.checklistV2`). */
export interface ChecklistRowFacts {
  field: string;
  status: string;
  priority?: string;
  collectionType?: string;
}

/**
 * Derive the concrete-contribution tier for the attention resolver
 * from a pack's checklist: the strongest missing, merchant-addable item.
 *
 *   "recommended" — a missing item the pipeline marks critical or
 *                   recommended (a concrete, recommended contribution).
 *   "optional"    — only optional missing items are addable.
 *   null          — nothing concrete the merchant can add.
 *
 * Strength, heroVariant, and improvementHint are deliberately NOT
 * inputs (plan §3.1 rung 4).
 */
export function deriveConcreteContribution(
  checklist: ChecklistRowFacts[] | null | undefined,
): "recommended" | "optional" | null {
  if (!checklist?.length) return null;
  let best: "recommended" | "optional" | null = null;
  for (const row of checklist) {
    if (row.status !== "missing") continue;
    if (!canMerchantUpload(row)) continue;
    if (row.priority === "critical" || row.priority === "recommended") {
      return "recommended";
    }
    best = "optional";
  }
  return best;
}
