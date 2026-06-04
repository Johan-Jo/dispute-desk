import type { PlanId } from "@/lib/billing/plans";

/**
 * sessionStorage key holding the plan the merchant picked on the marketing
 * pricing page during install. Set on the wizard welcome screen (/app/setup),
 * read on the post-wizard completion screen, then cleared. It rides in
 * sessionStorage rather than a query param because the wizard's per-step
 * navigation deliberately propagates only an allowlist of params
 * (shop/host/locale/…) — see `withShopParams` and the `ddredirect` carry-list.
 */
export const INSTALL_PLAN_STORAGE_KEY = "dd_install_plan";

const VALID: readonly PlanId[] = ["free", "starter", "growth", "scale"];

/** Coerce an arbitrary string to a known PlanId, or null. */
export function normalizeInstallPlan(value: string | null | undefined): PlanId | null {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  return (VALID as readonly string[]).includes(v) ? (v as PlanId) : null;
}

/** Read + normalize the stashed install plan from sessionStorage. */
export function readInstallPlan(): PlanId | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeInstallPlan(sessionStorage.getItem(INSTALL_PLAN_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Clear the stashed install plan (call once it has been consumed). */
export function clearInstallPlan(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(INSTALL_PLAN_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}
