/**
 * P-7, as an operational switch rather than a recommendation.
 *
 * ── THE DECISION (plan §1A, maintainer, 2026-08-09) ───────────────────
 *
 *   "Activate blume-box at threshold 60. Exclude surasvenne unless the new
 *    calibration produces a disposition-preserving result."
 *
 * The calibration was re-run on the post-C-14 baseline and did not produce
 * one for surasvenne, so the rule resolves to: **blume-box on canonical
 * completeness at 60; surasvenne on the existing path.** That is a constant
 * now, not a question — §1A is explicit that no epic re-opens it.
 *
 * ── WHY A SHOP LIST AND NOT A SETTING ─────────────────────────────────
 *
 * A `shop_settings` column would be a merchant-visible knob for a
 * measurement decision the merchant did not make and cannot evaluate, and it
 * would drift the moment someone toggled it. This is a deployment fact with a
 * measured basis, so it lives in code beside the reasoning, and the shop set
 * moves through a reviewed change.
 *
 * ── WHY THE THRESHOLD TRAVELS WITH THE SHOP ───────────────────────────
 *
 * `auto_save_min_score` is the merchant's own setting and stays theirs. The
 * activated threshold is a property of the CANONICAL scale, which is not the
 * same scale: the calibration measured 90 packs moving −1…−7 and 15 moving
 * +2…+17 against the persisted values. Applying a merchant's number chosen on
 * the old scale to the new one would move dispositions for a reason nobody
 * decided. So an activated shop reads BOTH from here, together — the scale
 * and the number that was calibrated on it.
 *
 * ── WHAT "NOT ACTIVATED" MEANS ────────────────────────────────────────
 *
 * Everything else keeps the persisted `completeness_score` column and the
 * merchant's own `auto_save_min_score`, unchanged. surasvenne is not
 * "pending"; it is excluded, for a stated reason, until a calibration
 * produces a disposition-preserving threshold. Recording it as deferred is
 * what let the old report claim P-7 was unapproved for four months.
 */

/**
 * Shops on canonical completeness, with the threshold calibrated for it.
 *
 * Keyed by `shops.shop_domain` — the value the pipeline already holds and the
 * one the calibration harness reported against. A shop id would be stable but
 * unreadable, and this list has to be checkable against the report by a human.
 */
const ACTIVATED: ReadonlyMap<string, number> = new Map([
  ["blume-box.myshopify.com", 60],
]);

/**
 * Shops deliberately EXCLUDED, and why.
 *
 * Carried in code rather than only in the report so the exclusion is visible
 * where the activation is. An empty exclusion list and an unconsidered shop
 * look identical otherwise.
 */
export const P7_EXCLUSIONS: ReadonlyMap<string, string> = new Map([
  [
    "surasvenne.myshopify.com",
    "No disposition-preserving threshold exists at any value: under the live " +
      "baseline the candidate semantics REORDER rather than rescale — weakest " +
      "auto-filing pack 23, a blocked pack 24 — and all 10 eligible packs reach " +
      "the gate via legacy_no_strength. C-14 clears one of three prerequisites " +
      "and does not fix reordering.",
  ],
]);

export interface CompletenessActivation {
  /** Read the canonical snapshot's score instead of the persisted column. */
  useCanonicalScore: boolean;
  /**
   * The threshold to compare against.
   *
   * `null` means "use the merchant's `auto_save_min_score`" — the unchanged
   * path. A number means the calibrated threshold for the canonical scale,
   * and it REPLACES the setting rather than bounding it.
   */
  threshold: number | null;
}

const NOT_ACTIVATED: CompletenessActivation = {
  useCanonicalScore: false,
  threshold: null,
};

/**
 * Is this shop on canonical completeness?
 *
 * Takes the domain and nothing else. A signature that also took the pack, the
 * score or the settings would invite "…unless the score is close", which is
 * how an activation list becomes a second gate.
 */
export function completenessActivationFor(
  shopDomain: string | null | undefined,
): CompletenessActivation {
  if (!shopDomain) return NOT_ACTIVATED;
  const threshold = ACTIVATED.get(shopDomain.trim().toLowerCase());
  if (threshold === undefined) return NOT_ACTIVATED;
  return { useCanonicalScore: true, threshold };
}

/** The activated set, for tests and for the calibration report to check against. */
export function activatedShopDomains(): string[] {
  return [...ACTIVATED.keys()].sort();
}

/**
 * The canonical completeness score persisted on a pack, or `null`.
 *
 * `null` when the pack predates the assessment writer. An activated shop with
 * a legacy pack therefore falls back to the persisted column rather than to
 * zero: treating "not yet written" as 0 would park every pre-activation pack
 * on a threshold it was never measured against.
 */
export function canonicalScoreFromPackJson(packJson: unknown): number | null {
  if (!packJson || typeof packJson !== "object") return null;
  const assessment = (packJson as { case_assessment?: unknown }).case_assessment;
  if (!assessment || typeof assessment !== "object") return null;
  const completeness = (assessment as { completeness?: unknown }).completeness;
  if (!completeness || typeof completeness !== "object") return null;
  const score = (completeness as { score?: unknown }).score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}
