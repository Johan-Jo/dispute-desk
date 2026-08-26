/**
 * Which Shopify fraud-screening signals may reach a bank. ONE owner.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────
 *
 * Shopify's screening returns `positiveFacts` as free prose, and some of those
 * strings ARE verification assertions:
 *
 *     "Card Verification Value (CVV) is correct"
 *     "Billing street address matches credit card's registered address"
 *
 * C-12 decided that only an approved `payment_authentication` / `payment_auth`
 * fact may ground an address or security-code claim, and the claim guards
 * enforce it. But `buildLlmFactPayload` maps `f.value` through UNCHANGED, so
 * the screening fact carried those sentences straight into the model's context
 * window — and `fraudScreeningReasonWithSignals` inlined them into bank-facing
 * Evidence Basis copy, where no guard runs at all.
 *
 * So the model was shown the forbidden assertion as CASE DATA, told it was a
 * positive signal, and then refused when it repeated it. Fixing the prompt did
 * not touch this path: the 2026-08-11 prompt work removed the strings from the
 * system blocks while the same strings kept arriving in the user payload.
 *
 * ── WHY A DETERMINISTIC FILTER, NOT AN INSTRUCTION ────────────────────
 *
 * "Do not quote the verification phrases" makes the model responsible for
 * classifying strings it is simultaneously being shown as evidence. That is
 * the arrangement that failed. The classification happens here, before the
 * payload is built, and the model never sees the excluded text.
 *
 * ── WHY ONE MODULE ────────────────────────────────────────────────────
 *
 * Two surfaces consume `positiveFacts` — the LLM payload and the Evidence
 * Basis row — and they are built in different files by different code paths.
 * A regex copy in each is the six-way drift `paymentVerification.ts` was
 * created to end. This is the single predicate; both call it.
 *
 * ── WHAT IS NOT DECIDED HERE ──────────────────────────────────────────
 *
 * Nothing about AVS or CVV EVIDENCE. This module does not grade, score,
 * license or refuse a verification claim — `factPredicates` and `claimGuards`
 * do, unchanged. It only answers "may this sentence be shown to a bank", and
 * its answer for every verification-shaped sentence is no, because the only
 * approved route for that subject is `verificationSummary`.
 *
 * Raw screening data stays untouched wherever it is stored. This filters the
 * BANK-FACING projection, so internal surfaces keep the full picture.
 */

/**
 * Sentence shapes that assert a verification result.
 *
 * Deliberately broad and shape-based rather than a list of Shopify's exact
 * strings: the wording is Shopify's to change, it is not versioned, and a
 * miss here puts the forbidden assertion in front of the model. Over-excluding
 * a safe signal costs one corroborating sentence; under-excluding reproduces
 * the regression.
 */
const VERIFICATION_SHAPES: readonly RegExp[] = [
  // Card security code, by any of its names.
  /\bCVV\b|\bCVC\b|\bCVV2\b|\bCID\b/i,
  /\bcard\s+(?:security|verification)\s+(?:code|value|number)\b/i,
  // Address verification, named or described.
  /\bAVS\b/i,
  /\b(?:billing|street|postal|zip)\s*(?:code)?\s*address\b/i,
  /\baddress\s+(?:verification|match\w*|verif\w*)\b/i,
  // "…matches the card's registered address", "…matched issuer records".
  /\bmatch\w*\b[^.]*\b(?:registered|issuer'?s?|on\s+file|of\s+record)\b/i,
  /\b(?:registered|issuer'?s?)\b[^.]*\bmatch\w*\b/i,
];

/** True when a screening phrase asserts an address or security-code result. */
export function isVerificationScreeningSignal(phrase: string): boolean {
  return VERIFICATION_SHAPES.some((re) => re.test(phrase));
}

/**
 * The bank-facing subset of `positiveFacts`.
 *
 * Everything else — device, connection, IP reputation, order history,
 * behavioural observations — survives untouched. Those are independently
 * observable and no predicate reserves them.
 */
export function bankFacingScreeningSignals(positiveFacts: unknown): string[] {
  if (!Array.isArray(positiveFacts)) return [];
  return positiveFacts
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isVerificationScreeningSignal(s));
}

/**
 * May the screening fact appear on a bank-facing surface at all?
 *
 * False when every signal it carried was a verification assertion. The right
 * answer then is silence, not a screening mention with nothing behind it: a
 * corroborator whose content was entirely removed corroborates nothing, and
 * "Shopify's screening recommended ACCEPT" on its own is the bare-recommendation
 * claim the module already forbids.
 */
export function screeningReachesBank(positiveFacts: unknown): boolean {
  return bankFacingScreeningSignals(positiveFacts).length > 0;
}

/**
 * A `fraud_screening` fact value, projected for bank-facing use.
 *
 * Returns `null` when nothing survives — callers omit the fact rather than
 * shipping an empty one. Non-screening values pass through untouched so this
 * is safe to apply across a whole fact list.
 */
export function projectScreeningValueForBank(value: unknown): unknown | null {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (!("positiveFacts" in v)) return value;

  const safe = bankFacingScreeningSignals(v.positiveFacts);
  if (safe.length === 0) return null;
  return { ...v, positiveFacts: safe };
}

/* ── Payment-verification bank projection (P0, 2026-08-26) ──────────────── */

/**
 * Address/AVS-bearing keys on a `payment_authentication` fact value.
 *
 * `addressVerified` is the leak this list exists for. On #347617 the fact
 * carried `addressVerified: true` with `bankEligible: false` and
 * `verificationSummary: null` — the CODES were correctly withheld (PR-C2
 * "Decision 1"), but the BOOLEAN was not, and the narrative generator wrote
 * "both address verification and security-code verification were completed"
 * from it. That sentence reached the filed PDF in three places.
 *
 * Neither Visa CE Item 3 nor the Mastercard Chargeback Guide 4837 AVS route
 * authorizes a standalone address-verification assertion: both require the
 * compound element (delivery/dispatch to the AVS-confirmed address), which is
 * not observable today.
 */
const ADDRESS_VERIFICATION_KEYS = [
  "addressVerified",
  "avsResult",
  "avsResultCode",
  "avs_result_code",
] as const;

/**
 * A `payment_authentication` fact value, projected for bank-facing use.
 *
 * When the fact is NOT bank-eligible, every address/AVS-bearing field is
 * omitted from what the narrative generator sees. What survives is the
 * independently supported material — `securityCodeVerified`, `cvvResult`,
 * `network` — so a CVV match still argues, and the internal factual/risk
 * signal is untouched on the persisted fact.
 *
 * This fixes the boolean leak ONLY. Whether authoritative AVS may ever appear
 * as narrowly factual corroboration without satisfying the complete network
 * remedy is a separate policy decision and is deliberately NOT decided here.
 */
export function projectPaymentVerificationValueForBank(
  value: unknown,
  bankEligible: boolean,
): unknown {
  if (bankEligible) return value;
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (v.fieldKey !== "avs_cvv_match") return value;

  const out: Record<string, unknown> = { ...v };
  for (const key of ADDRESS_VERIFICATION_KEYS) delete out[key];
  return out;
}
