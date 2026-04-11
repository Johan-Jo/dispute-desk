/**
 * Canonical evidence_pack status values.
 *
 * Two enums live side-by-side in the DB today:
 *
 *   packs.status         — "DRAFT" | "ACTIVE" | "ARCHIVED" (uppercase,
 *                          library pack / catalog lifecycle)
 *   evidence_packs.status — "draft" | "queued" | "building" | "ready" |
 *                           "blocked" | "failed" | "saved_to_shopify" |
 *                           "save_failed" | "saving" (lowercase,
 *                           build + save lifecycle)
 *
 * This module is for the evidence_packs side — the lifecycle the
 * merchant actually sees on the pack detail page. The values were
 * previously scattered as inline string literals across the build
 * orchestrator, the completeness engine, the auto-save gate, the
 * pack detail pages, and several API routes. Concentrating them
 * here gives us type safety + a single place to add i18n labels
 * when the merchant-facing UI needs to render them in Portuguese,
 * Spanish, etc.
 */

export const EVIDENCE_PACK_STATUSES = [
  "draft",
  "queued",
  "building",
  "ready",
  "blocked",
  "failed",
  "saving",
  "saved_to_shopify",
  "save_failed",
] as const;

export type EvidencePackStatus = (typeof EVIDENCE_PACK_STATUSES)[number];

/**
 * Look up the merchant-facing localized label for a pack status.
 * Accepts any string so raw DB reads don't need casts — unknown
 * values fall through to a humanized fallback ("saved to shopify"
 * style) instead of throwing.
 *
 * The i18n keys live under packs.status_* in messages/*.json and
 * are added to all 12 locale files alongside this helper.
 */
export function formatPackStatus(
  status: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!status) return "—";
  const map: Record<string, string> = {
    draft: "packs.statusDraftLabel",
    queued: "packs.statusQueuedLabel",
    building: "packs.statusBuildingLabel",
    ready: "packs.statusReadyLabel",
    blocked: "packs.statusBlockedLabel",
    failed: "packs.statusFailedLabel",
    saving: "packs.statusSavingLabel",
    saved_to_shopify: "packs.statusSavedToShopifyLabel",
    save_failed: "packs.statusSaveFailedLabel",
  };
  const key = map[status];
  if (key) return t(key);
  // Unknown status → humanize the raw DB value ("some_new_status" →
  // "some new status") rather than crash. Safer than throwing for a
  // string that Shopify or a future migration might add.
  return status.replace(/_/g, " ");
}
