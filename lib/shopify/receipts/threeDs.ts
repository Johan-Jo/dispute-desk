/**
 * Canonical 3-D Secure receipt walk — the ONE place that knows how to
 * read 3DS authentication out of a Shopify Payments transaction
 * `receiptJson`.
 *
 * Shared by:
 *   - lib/packs/sources/threeDSecureSource.ts (per-dispute evidence)
 *   - lib/shopify/queries/ordersForBackfill.ts (shopify_orders ingest)
 * Both previously carried byte-identical private copies of this logic,
 * which desynchronized from the live receipt contract twice without
 * either noticing (see drift history below). Any future shape change
 * gets fixed HERE and nowhere else.
 * (scripts/backfill-3ds-from-receipts.mjs mirrors this walk — scripts
 * can't import TS. Keep it in sync when editing.)
 *
 * Receipt shapes observed live on real Shopify Payments orders
 * (probe: scripts/probe-3ds-cay-receipts.mjs, cay prod, 2026-07-19):
 *
 *   1. OLD PaymentIntent (pre-`latest_charge` Stripe API era):
 *      receipt.charges.data[0].payment_method_details.card.three_d_secure
 *        = { authenticated: true, authentication_flow, result:
 *            "authenticated", succeeded, version }
 *   2. MODERN PaymentIntent:
 *      receipt.latest_charge.payment_method_details.card.three_d_secure
 *        = { authentication_flow, electronic_commerce_indicator,
 *            exemption_indicator, result: "authenticated",
 *            result_reason, transaction_id, version }
 *      NOTE: NO `authenticated` boolean — success is expressed only via
 *      `result: "authenticated"`. This is the 2026 contract.
 *   3. Root-level `payment_method_details` — documented legacy fallback,
 *      never observed live; kept as cheap insurance.
 *
 * Drift history (why this module exists):
 *   - 2026-04-26 probe verified shape 2's *path* but never saw a
 *     populated block (test cards don't run real challenges), so the
 *     walk was written against `authenticated === true` only.
 *   - 2026-07-19 probe on live EU orders found BOTH misses: shape 1's
 *     `charges.data[0]` nesting (old orders) and shape 2's missing
 *     `authenticated` field (modern orders). Result: every one of cay's
 *     12K+ Shopify Payments orders read as NULL — a false zero.
 *
 * Positive rule: `three_d_secure` is a plain object AND
 * (`authenticated === true` OR `result === "authenticated"`).
 * Everything else — `result: "exempted"`, `"attempt_acknowledged"`,
 * `authenticated: false`, missing block, unparseable receipt — collapses
 * to null. This function NEVER returns false: absence of 3DS is never a
 * negative signal (CLAUDE.md / docs/technical.md § 3-D Secure
 * Collection), and SCA exemptions are not authentication failures.
 */

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Receipts come back as JSON strings in 2026-01. Older or proxied
 * gateways may pre-parse them. Accept either; reject everything else.
 */
export function parseReceiptJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(raw) ? raw : null;
}

/**
 * Walk a parsed Shopify Payments receipt for a positive 3DS
 * authentication. Returns true on an explicit affirmative statement
 * from the gateway, else null. Never false — see module header.
 */
export function readThreeDsAuthenticated(
  receipt: Record<string, unknown>,
): boolean | null {
  try {
    const charges = receipt.charges;
    const firstCharge =
      isPlainObject(charges) && Array.isArray(charges.data)
        ? charges.data[0]
        : undefined;
    const candidates: Array<unknown> = [
      // Shape 2 — modern PaymentIntent (the current live contract).
      (receipt.latest_charge as Record<string, unknown> | undefined)
        ?.payment_method_details,
      // Shape 3 — root-level legacy fallback (never observed live).
      receipt.payment_method_details,
      // Shape 1 — old PaymentIntent era, charge nested under charges.data.
      isPlainObject(firstCharge) ? firstCharge.payment_method_details : undefined,
    ];
    for (const pmd of candidates) {
      if (!isPlainObject(pmd)) continue;
      const card = pmd.card;
      if (!isPlainObject(card)) continue;
      const tds = card.three_d_secure;
      if (!isPlainObject(tds)) continue;
      // Old shape says `authenticated: true`; modern shape says
      // `result: "authenticated"` with no boolean. Either is an
      // explicit gateway affirmation. Nothing else is.
      if (tds.authenticated === true) return true;
      if (tds.result === "authenticated") return true;
    }
    return null;
  } catch {
    return null;
  }
}
