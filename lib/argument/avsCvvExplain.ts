/**
 * Plain-language buckets for AVS / CVV gateway result codes.
 *
 * MERCHANT-FACING RULE (2026-07-23, user directive): merchant copy must
 * NEVER lead with a bare gateway code — "AVS code Z" means nothing to
 * anyone but a bank. Every merchant surface explains WHAT matched or
 * failed in plain words, with the code in parentheses at the end.
 *
 * DELIBERATELY COARSE (user directive, same day): the merchant view
 * does NOT distinguish street-only vs ZIP-only vs neither — any address
 * component failing reads as "the address did not match". The finer
 * street/ZIP distinction was judged exaggerated detail for merchants;
 * the parenthesized code preserves the exact result for anyone who
 * needs it (and the bank-facing letter, which is exempt from this rule,
 * keeps its own wording).
 *
 * Consumers:
 *   - `useEvidenceSections.classifyAvsCvv` (client) resolves each bucket
 *     to a localized sentence under `disputes.internalSignals.avsCvvMismatch.*`.
 *   - `lib/argument/internalSignals.ts` (server) mirrors the same
 *     sentences in English — keep the two in lockstep.
 *
 * Bucketing is about honest description, NOT scoring. Scoring's match
 * sets live in `canonicalEvidence.ts` (AVS Y/A/W/X/D/M, CVV M) and are
 * unchanged; the `match` bucket below mirrors that set so "matched"
 * copy never disagrees with what scoring actually cites to the bank.
 */

export type AvsBucket =
  | "match" // address details matched per the scoring set
  | "no_match" // at least one address component definitively failed
  | "unchecked"; // issuer did not verify / unavailable / error

export type CvvBucket =
  | "match" // security code matched
  | "no_match" // security code did not match
  | "unchecked"; // not checked / unavailable

/** Standard AVS response codes (Visa/MC/Amex union as surfaced by
 *  Shopify gateways). `match` mirrors the canonical scoring set;
 *  `no_match` is any code that asserts a definite component failure
 *  (Z: street failed, N/C: nothing matched). Everything else —
 *  unavailable / unsupported / not-verified codes — falls to
 *  "unchecked", the safe description ("the issuer did not verify…")
 *  rather than a false match/mismatch claim. */
export function avsBucket(code: string | null | undefined): AvsBucket | null {
  if (!code || code.trim() === "") return null;
  switch (code.trim().toUpperCase()) {
    case "Y":
    case "A":
    case "W":
    case "X":
    case "D":
    case "M":
    case "F":
      return "match";
    case "Z":
    case "N":
    case "C":
      return "no_match";
    default:
      return "unchecked";
  }
}

export function cvvBucket(code: string | null | undefined): CvvBucket | null {
  if (!code || code.trim() === "") return null;
  switch (code.trim().toUpperCase()) {
    case "M":
      return "match";
    case "N":
      return "no_match";
    default:
      return "unchecked";
  }
}
