/**
 * Pack-health numbers for the admin Overview.
 *
 * evidence_packs.status has grown beyond the three names the Overview was
 * written against: prod now holds `saved_to_shopify_verified` and
 * `saved_to_shopify_unverified` (the bulk of saved packs) and `save_failed`,
 * alongside ready / draft / archived / failed / saved_to_shopify. Matching on
 * exact names would silently drop most saved packs from the rates. "Saved" is
 * therefore any status starting `saved_to_shopify`.
 */

export interface PackRow {
  status: string | null;
  saved_to_shopify_at: string | null;
}

export const isSavedStatus = (s: string | null): boolean =>
  typeof s === "string" && s.startsWith("saved_to_shopify");

/** Packs whose build ended badly. `draft` and `archived` are neither. */
export const isFailingStatus = (s: string | null): boolean =>
  s === "failed" || s === "blocked" || s === "save_failed";

const isBuilt = (s: string | null): boolean => s === "ready" || isSavedStatus(s) || isFailingStatus(s);

export function packHealth(packs: PackRow[]): { automationSuccessRate: number; saveSuccessRate: number } {
  // Automation success: of packs whose build finished, how many ended ready/saved.
  const built = packs.filter((p) => isBuilt(p.status));
  const ok = built.filter((p) => p.status === "ready" || isSavedStatus(p.status));
  const automationSuccessRate = built.length > 0 ? Math.round((ok.length / built.length) * 100) : 0;

  // Save rate: of packs that could be (or were) saved, how many reached Shopify.
  const savable = packs.filter(
    (p) => p.status === "ready" || p.status === "failed" || p.status === "save_failed" || isSavedStatus(p.status),
  );
  const saved = packs.filter((p) => p.saved_to_shopify_at != null).length;
  const saveSuccessRate = savable.length > 0 ? Math.round((saved / savable.length) * 100) : 0;

  return { automationSuccessRate, saveSuccessRate };
}
