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
export const MERCHANT_UI_HIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "customer_communication",
  "supporting_documents",
]);
