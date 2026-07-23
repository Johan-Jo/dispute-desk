/**
 * Evidence fields that are present in the data model but intentionally
 * hidden from every merchant-facing UI surface.
 *
 * Decision 2026-05-21 (dev mode, no prod merchants): the two freeform
 * manual-upload buckets — `customer_communication` and
 * `supporting_documents` — were nagging merchants to upload generic
 * attachments on every dispute. The structured fraud-rebuttal lever
 * (CardholderAcknowledgementCard) covers the high-leverage Customer
 * Communication case; the rest is noise.
 *
 * The fields stay in:
 *   - the checklist + completeness scoring (so the pack builder,
 *     coverage gate, and bank-facing rebuttal are unaffected),
 *   - the admin source-of-truth views (admin section per
 *     `feedback_admin_is_source_of_truth`),
 *   - any uploaded/included evidence still surfaces as collected
 *     evidence wherever real evidence is listed (we only hide the
 *     *missing* / *not-yet-included* nags).
 *
 * Surfaces that read this set:
 *   - app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections.ts
 *     → Evidence tab §3 "Missing or weak evidence"
 *   - app/(embedded)/app/disputes/[id]/tabs/OverviewTab.tsx
 *     → Overview "Evidence collected" Missing rows + checklist buckets
 *   - app/(embedded)/app/disputes/[id]/tabs/sections/InclusionReviewSection.tsx
 *     → Submit/Review tab "Not included" group
 */
import { effectivePriorOrders } from "@/lib/argument/canonicalEvidence";

export const MERCHANT_UI_HIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "customer_communication",
  "supporting_documents",
]);

/**
 * Payload-conditional companion to the static set above: the
 * "Customer account history" row for a FIRST-TIME customer on a fraud
 * dispute (2026-07-23 user decision, prod example JAYLENE DOILEY /
 * Roy L MCLANE).
 *
 * A first order is not evidence — it is the absence of history, and the
 * only thing the card could say is "we're withholding a fraud
 * indicator". Evidence surfaces list evidence; so the row renders
 * NOWHERE merchant-facing when this returns true. A returning customer
 * (≥1 order before the disputed one) keeps the row — that IS evidence.
 *
 * Scoring, the pack builder, the coverage gate, and admin views are
 * unaffected — like the static set, this only filters merchant-facing
 * rendering. Non-fraud families keep the row too (first-time status is
 * neutral context there, not a fraud indicator).
 *
 * `family` is the resolved reason family (`resolveReasonFamily`).
 */
export function isNonEvidenceAccountHistoryRow(
  field: string,
  payload: Record<string, unknown> | null | undefined,
  family: string | null | undefined,
): boolean {
  if (field !== "customer_account_info") return false;
  if (family !== "fraud") return false;
  const prior = effectivePriorOrders(payload ?? null);
  return prior === 0 || prior === null;
}
