/**
 * Cardholder-name vs. order-customer-name mismatch detector.
 *
 * The payment gateway returns the name the card is registered to
 * (`cardholderName` on the `avs_cvv_match` payload, via
 * `lib/packs/sources/paymentSource.ts`). When that name shares nothing
 * with the name on the order, the order was placed by someone other
 * than the person the issuer knows — the classic stolen-card pattern
 * (prod dispute 235d4152: card registered to "Robin Denise Pipe",
 * order placed by "Sean Boyd", AVS N, first-order account, Shopify
 * pre-auth risk HIGH/CANCEL — presented as a Strong case pre-fix).
 *
 * MERCHANT-UI ONLY. The mismatch NEVER enters the bank-facing PDF,
 * narrative, or Shopify structured fields — telling the bank "the
 * buyer's name doesn't match the cardholder" is a confession, and the
 * issuer already knows their own cardholder's name. Consumers:
 *   - `buildInternalSignalsByField` / `useEvidenceSections` → the
 *     "Kept internal" warning that prints both names to the merchant.
 *   - `calculateCaseStrength` → caps a fraud-family case at Moderate
 *     so a name-mismatched order never auto-submits as Strong.
 *
 * The comparison is deliberately CONSERVATIVE — it fires only when the
 * two names share not a single meaningful token. Family members with a
 * shared surname ("John Smith" paying for "Mary Smith"), initials
 * ("J. Smith" vs "John Smith"), and partial legal names all pass. A
 * false "mismatch" would cap genuinely winnable spouse/gift orders, so
 * when in doubt this returns false.
 */

/** Tokens of 1 character (initials, middle-name abbreviations) carry no
 *  comparison signal and are dropped before matching. */
function nameTokens(name: string): Set<string> {
  const tokens = name
    .normalize("NFKD")
    // Strip combining diacritics (U+0300–U+036F) so "José" matches "Jose".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Split on anything that isn't a letter or digit (spaces, dots,
    // hyphens, apostrophes). Hyphenated surnames compare token-wise.
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

/**
 * True when BOTH names are present and usable AND they share zero
 * tokens. Missing/empty/initials-only names return false — absence of
 * data is never a mismatch signal.
 */
export function detectCardholderNameMismatch(
  cardholderName: string | null | undefined,
  customerName: string | null | undefined,
): boolean {
  if (!cardholderName || !customerName) return false;
  const card = nameTokens(cardholderName);
  const customer = nameTokens(customerName);
  if (card.size === 0 || customer.size === 0) return false;
  for (const t of card) {
    if (customer.has(t)) return false;
  }
  return true;
}

/** Convenience reader: the gateway-registered cardholder name from an
 *  `avs_cvv_match` (payment section) payload, when present. */
export function cardholderNameFromPayload(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const v = payload?.cardholderName;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
