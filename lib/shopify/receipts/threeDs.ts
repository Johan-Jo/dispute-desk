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
 * The `three_d_secure` block itself, found by the canonical walk.
 * Returns the raw object plus the path it came from, or null.
 */
export function readThreeDsBlock(
  receipt: Record<string, unknown>,
): Record<string, unknown> | null {
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
      if (isPlainObject(tds)) return tds;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Walk a parsed Shopify Payments receipt for a positive 3DS
 * authentication. Returns true on an explicit affirmative statement
 * from the gateway, else null. Never false — see module header.
 */
export function readThreeDsAuthenticated(
  receipt: Record<string, unknown>,
): boolean | null {
  const tds = readThreeDsBlock(receipt);
  if (!tds) return null;
  // Old shape says `authenticated: true`; modern shape says
  // `result: "authenticated"` with no boolean. Either is an
  // explicit gateway affirmation. Nothing else is.
  if (tds.authenticated === true) return true;
  if (tds.result === "authenticated") return true;
  return null;
}

/**
 * ECI values that carry a FULL liability shift to the issuer.
 *
 * Mastercard `02` and Visa `05` = fully authenticated: the issuer's own ACS
 * authenticated the cardholder (frictionless or challenged) and accepted fraud
 * liability at authorization time.
 *
 * Deliberately NOT included:
 *   - `01` / `06` — "attempted": authentication did not complete. Liability
 *     treatment varies by region and it invites the issuer to point out that
 *     the cardholder was never authenticated.
 *   - `00` / `07` — no authentication at all.
 * Anything else (unknown, malformed) is treated as no shift.
 */
const LIABILITY_SHIFT_ECI = new Set(["02", "05"]);

/** Structured 3DS detail for evidence collection. */
export interface ThreeDsDetail {
  /** Positive authentication per the canonical rule. */
  authenticated: boolean;
  /** Raw ECI as the gateway reported it (e.g. "02"). */
  eci: string | null;
  /**
   * Directory-server transaction id. This is the reference an issuer matches
   * against their OWN authentication record — the difference between an
   * assertion and a checkable fact in a bank-facing letter.
   */
  dsTransactionId: string | null;
  /** 3DS protocol version, e.g. "2.2.0". */
  version: string | null;
  /** "frictionless" | "challenge" | … as reported. */
  authenticationFlow: string | null;
  /**
   * True only for ECI 02/05 with a positive authentication and NO exemption.
   * An SCA exemption means authentication was deliberately skipped and the
   * merchant kept the liability — citing 3DS there would argue against us.
   */
  liabilityShift: boolean;
  /** Set when the gateway recorded an SCA exemption (TRA, low-value, …). */
  exemptionIndicator: string | null;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

/**
 * Full 3DS detail from a parsed receipt, or null when the block is absent.
 *
 * `readThreeDsAuthenticated` reduces the same block to one boolean; that was
 * everything the evidence pipeline captured until 2026-08-03, which is why a
 * fully liability-shifted authentication (blume-box #352552: ECI 02,
 * `result: authenticated`, 3DS 2.2.0) could never be cited to the issuer —
 * `payload.liabilityShift` was read by the claim guard but written by nothing.
 */
export function readThreeDsDetail(
  receipt: Record<string, unknown>,
): ThreeDsDetail | null {
  const tds = readThreeDsBlock(receipt);
  if (!tds) return null;
  const authenticated =
    tds.authenticated === true || tds.result === "authenticated";
  const eci = str(tds.electronic_commerce_indicator);
  const exemptionIndicator = str(tds.exemption_indicator);
  return {
    authenticated,
    eci,
    dsTransactionId: str(tds.transaction_id),
    version: str(tds.version),
    authenticationFlow: str(tds.authentication_flow),
    exemptionIndicator,
    liabilityShift:
      authenticated && eci != null && LIABILITY_SHIFT_ECI.has(eci) && exemptionIndicator == null,
  };
}
