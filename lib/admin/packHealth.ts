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

export interface PackHealth {
  automationSuccessRate: number;
  /** Of packs we actually tried to send to Shopify: percent that went through. */
  saveSuccessRate: number;
  /** Packs that reached Shopify. */
  saveSent: number;
  /** Packs whose send was attempted and failed. */
  saveFailed: number;
}

export function packHealth(packs: PackRow[]): PackHealth {
  // Automation success: of packs whose build finished, how many ended ready/saved.
  const built = packs.filter((p) => isBuilt(p.status));
  const ok = built.filter((p) => p.status === "ready" || isSavedStatus(p.status));
  const automationSuccessRate = built.length > 0 ? Math.round((ok.length / built.length) * 100) : 0;

  // Save rate counts TRUE SENDS only: a pack that reached Shopify
  // (`saved_to_shopify_at` set) or whose send was attempted and failed
  // (`save_failed`). Packs merely sitting in `ready` were never sent, so they are
  // neither a success nor a failure. (The old denominator counted every ready
  // pack, 260 of 352 on prod belong to disputes already closed, which read as a
  // 24% save rate when sends were succeeding ~98% of the time.)
  const saveSent = packs.filter((p) => p.saved_to_shopify_at != null).length;
  const saveFailed = packs.filter((p) => p.saved_to_shopify_at == null && p.status === "save_failed").length;
  const attempts = saveSent + saveFailed;
  const saveSuccessRate = attempts > 0 ? Math.round((saveSent / attempts) * 100) : 0;

  return { automationSuccessRate, saveSuccessRate, saveSent, saveFailed };
}
