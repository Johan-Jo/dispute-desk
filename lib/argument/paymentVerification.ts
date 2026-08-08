/**
 * Payment verification — AVS and CVV as TWO facts, one owner. (PR-C2 / C-12)
 *
 * WHY THIS FILE EXISTS. `avs_cvv_match` was one canonical field standing for
 * two independent checks performed by two different parties' systems, and the
 * code that decided what those checks meant was written **six** times:
 *
 *   lib/argument/canonicalEvidence.ts          match sets (scoring)
 *   lib/argument/evidenceLineItem.ts           match sets (row reason)
 *   lib/argument/internalSignals.ts            match sets (server warning)
 *   app/(embedded)/.../useEvidenceSections.ts  match sets (client warning)
 *   lib/argument/avsCvvExplain.ts              buckets (merchant copy)
 *   lib/defence/factPredicates.ts              inline "Y" / "M" (claim guards)
 *
 * They were kept "in lockstep" by comment, and they had already drifted: AVS
 * `F` read as *matched* in merchant copy while scoring credited nothing, and
 * `Z` (street failed, postal matched) produced a bank-facing "postal code
 * matched" clause while scoring called the same code a non-match.
 *
 * THE TWO FACTS ARE NOT INTERCHANGEABLE. AVS answers "does the address the
 * merchant holds agree with the address the issuer holds"; CVV answers "did
 * the person at checkout hold the physical card". The Visa §4 Compelling
 * Evidence rule this evidence is cited under (register R-E, chart Item 3) is
 * an **address** rule. A CVV match is not a weaker address match — it is not
 * an address match at all.
 *
 * DECISION 1 (maintainer, 2026-08-08 — `docs/evidence-model/p0/containment-proposals.md`
 * § Decision gates): a CVV-only match is a **valid internal merchant fact**
 * that is **not issuer-citable**, and it cannot satisfy an AVS/address claim,
 * CE chart Item 3, or any related claim guard. That is enforced here, in the
 * predicate every consumer reads — not by prompt wording, and not by a regex
 * over generated prose.
 *
 * DECISION 2: completeness keeps ONE grouped payment-verification requirement
 * with AVS and CVV as subfacts beneath it. This module produces the subfacts;
 * it deliberately does not add a checklist row. (`lib/automation/completeness.ts`)
 *
 * WHAT THIS FILE DOES NOT DECIDE — PR-C3 (C-13) owns it: which codes qualify,
 * per network. The match sets below are today's behaviour, carried over
 * unchanged and network-agnostic, so that PR-C2 is a split and not a
 * re-grading. Every place where the descriptive reading and the scoring
 * reading disagree (`F`) is named explicitly below rather than silently
 * reconciled, because reconciling it *is* PR-C3's job.
 */

/* ── Codes ─────────────────────────────────────────────────────────────── */

/**
 * AVS codes that count as a match FOR SCORING AND CITATION.
 *
 * Y = street+ZIP · A = street only · W = ZIP only · X = full (international)
 * D / M = international match.
 *
 * Network-agnostic, and broader than the only V-PRIMARY rule we hold
 * (register R-E qualifies `Y` or `M` specifically). PR-C3 narrows the
 * *citation* path to the primary-sourced set; PR-C2 changes neither the set
 * nor the grade it produces.
 *
 * THE ONE DEFINITION. `tests/unit/paymentVerificationSingleOwner.test.ts`
 * fails the build if a second one appears anywhere in the repo.
 */
const AVS_SCORING_MATCH = new Set(["Y", "A", "W", "X", "D", "M"]);

/** CVV codes that count as a match. M = match. */
const CVV_SCORING_MATCH = new Set(["M"]);

/**
 * AVS codes that assert a DEFINITE component failure — Z (street failed,
 * postal matched), N (nothing matched), C (nothing matched, international).
 * Everything outside both sets is "the issuer did not verify / did not tell
 * us", which is never a negative signal.
 */
const AVS_DEFINITE_NO_MATCH = new Set(["Z", "N", "C"]);

/** CVV codes that assert a definite failure. */
const CVV_DEFINITE_NO_MATCH = new Set(["N"]);

/* ── Types ─────────────────────────────────────────────────────────────── */

/**
 * How the issuer's response READS, in merchant-facing terms. Descriptive
 * only — `matched` below is the scoring/citation question, and the two are
 * deliberately separate fields because they do not agree on every code.
 */
export type VerificationOutcome = "match" | "no_match" | "unchecked";

export interface VerificationSubfact {
  /** Raw gateway code, upper-cased. Null when the gateway returned none. */
  code: string | null;
  /** True when a code was returned at all. Absence is never a signal. */
  present: boolean;
  /** Descriptive reading of the response (merchant copy). */
  outcome: VerificationOutcome | null;
  /**
   * SCORING / CITATION predicate: is this a match we credit and may cite?
   *
   * Not the same question as `outcome === "match"`. AVS `F` (UK street+postal
   * match) reads as a match and is credited by nothing — carried over from
   * the pre-split behaviour rather than quietly widened, because widening the
   * set is PR-C3's decision with its own primary source.
   */
  matched: boolean;
}

export interface PaymentVerification {
  /** Address Verification Service — the ADDRESS fact. */
  avs: VerificationSubfact;
  /** Card security code — the CARD-POSSESSION fact. */
  cvv: VerificationSubfact;
  /** The issuer confirmed the address (AVS). The only address authority. */
  addressVerified: boolean;
  /** The issuer confirmed the security code. Never an address authority. */
  securityCodeVerified: boolean;
  /**
   * DECISION 1. True when the security code matched and the address did not
   * (or was never verified) — a valid internal fact with no citable content.
   */
  cvvOnly: boolean;
  /**
   * DECISION 1. May any part of this fact reach an issuer? Requires the
   * address half. A CVV-only match is structurally uncitable: no consumer can
   * opt back in, because every bank-facing surface reads this flag.
   */
  citable: boolean;
  /** Gateway-registered cardholder name, when the payload carries one.
   *  Merchant-UI only (see `nameMismatch.ts`) — never bank-facing. */
  cardholderName: string | null;
}

/* ── Reading a payload ─────────────────────────────────────────────────── */

function readCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function subfact(
  code: string | null,
  matchSet: ReadonlySet<string>,
  noMatchSet: ReadonlySet<string>,
): VerificationSubfact {
  if (code === null) {
    return { code: null, present: false, outcome: null, matched: false };
  }
  const outcome: VerificationOutcome = matchSet.has(code)
    ? "match"
    : noMatchSet.has(code)
      ? "no_match"
      : "unchecked";
  return { code, present: true, outcome, matched: matchSet.has(code) };
}

/**
 * AVS `F` — street and postal matched, UK-issued cards. Reads as a match,
 * scores as nothing. Kept as an explicit exception rather than folded into
 * either set: PR-C3's network map is where it gets an authority and a home,
 * and a silent widening here would be a re-grading disguised as a refactor.
 */
const AVS_DESCRIPTIVE_ONLY_MATCH = new Set(["F"]);

/**
 * Normalize any historical or current payload shape into the two subfacts.
 *
 * Shapes accepted, all of them live on prod:
 *   - `avsResultCode` / `cvvResultCode`   — current collector output
 *   - `avs_result_code` / `cvv_result_code` — 11 packs, newest 2026-01-19
 *   - `avsResult` / `cvvResult`           — the fact-layer projection
 *     (`factClassifier.extractValue`), which several consumers re-read
 *
 * Nothing is rewritten in the database; normalization happens on read, at the
 * derivation boundary, exactly as the retired-key stripper does.
 */
export function readPaymentVerification(payload: unknown): PaymentVerification {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  const avsCode = readCode(p.avsResultCode) ?? readCode(p.avs_result_code) ?? readCode(p.avsResult);
  const cvvCode = readCode(p.cvvResultCode) ?? readCode(p.cvv_result_code) ?? readCode(p.cvvResult);

  const avsBase = subfact(avsCode, AVS_SCORING_MATCH, AVS_DEFINITE_NO_MATCH);
  const avs: VerificationSubfact =
    avsCode !== null && AVS_DESCRIPTIVE_ONLY_MATCH.has(avsCode)
      ? { ...avsBase, outcome: "match", matched: false }
      : avsBase;
  const cvv = subfact(cvvCode, CVV_SCORING_MATCH, CVV_DEFINITE_NO_MATCH);

  const addressVerified = avs.matched;
  const securityCodeVerified = cvv.matched;

  const name = typeof p.cardholderName === "string" ? p.cardholderName.trim() : "";

  return {
    avs,
    cvv,
    addressVerified,
    securityCodeVerified,
    cvvOnly: securityCodeVerified && !addressVerified,
    citable: addressVerified,
    cardholderName: name.length > 0 ? name : null,
  };
}

/* ── Grading ───────────────────────────────────────────────────────────── */

export type PaymentVerificationGrade = "strong" | "moderate" | "invalid";

/**
 * The grade, unchanged from the pre-split rule:
 *   both matched → strong · either matched → moderate · neither → invalid.
 *
 * A CVV-only match keeps its `moderate` grade DELIBERATELY. It is a real
 * signal for the merchant's own read of the case, and decision 1 removes its
 * *citability*, not its existence — so case strength and completeness are
 * untouched by the split, and the only delta PR-C2 produces is the withdrawn
 * citation.
 */
export function gradePaymentVerification(v: PaymentVerification): PaymentVerificationGrade {
  if (v.addressVerified && v.securityCodeVerified) return "strong";
  if (v.addressVerified || v.securityCodeVerified) return "moderate";
  return "invalid";
}

/**
 * The strict both-matched form the CE chart contemplates: AVS `Y` with CVV
 * `M`. Kept strict (not widened to the scoring set) because it gates
 * bank-facing strategy selection and thesis text; PR-C3 assigns it a
 * primary-sourced code set.
 */
export function hasFullAvsAndCvvMatch(v: PaymentVerification): boolean {
  return hasFullAvsMatch(v) && v.cvv.code === "M";
}

/**
 * A FULL address match (`Y`: street and postal) as distinct from a partial one
 * (`A` street-only, `W` postal-only) or an international match (`X`/`D`/`M`).
 *
 * Kept separate from `addressVerified` because bank-facing text that names the
 * authentication method has always required the full match, and PR-C2 is a
 * split, not a widening. PR-C3 replaces the letter with a normalized,
 * primary-sourced result.
 */
export function hasFullAvsMatch(v: PaymentVerification): boolean {
  return v.avs.code === "Y";
}

/* ── Citation ──────────────────────────────────────────────────────────── */

/**
 * The English clause an issuer may be told, or null when nothing here may be
 * cited. This is the ONLY producer of bank-facing AVS/CVV prose.
 *
 * English by design: the bank-rebuttal letter is written to a bank reviewer in
 * English, like `factClassifier.FIELD_LABEL_EN`. Merchant-facing copy is
 * localized elsewhere and never built from this.
 *
 * Returns null for every uncitable case, including the CVV-only one — so a
 * consumer that forgets the `citable` flag still cannot emit the claim.
 */
export function citableVerificationSummaryEn(v: PaymentVerification): string | null {
  if (!v.citable) return null;

  const parts: string[] = [addressClauseEn(v)];
  if (v.securityCodeVerified) {
    parts.push("the card verification code matched the issuer's records");
  }
  return parts.join(" and ");
}

function addressClauseEn(v: PaymentVerification): string {
  switch (v.avs.code) {
    case "A":
      return "the billing street matched the issuer's records";
    case "W":
      return "the billing postal code matched the issuer's records";
    default:
      return "the billing address matched the issuer's records";
  }
}

/**
 * The same content in the Evidence Basis table's terse register
 * ("billing address matched • CVV matched"), for facts built before
 * `verificationSummary` existed. Empty for everything uncitable.
 */
export function citableVerificationPartsEn(v: PaymentVerification): string[] {
  if (!v.citable) return [];
  const parts: string[] = [
    v.avs.code === "A"
      ? "billing street matched"
      : v.avs.code === "W"
        ? "billing postal code matched"
        : "billing address matched",
  ];
  if (v.securityCodeVerified) parts.push("CVV matched");
  return parts;
}

/* ── Merchant-facing description ───────────────────────────────────────── */

/**
 * Descriptive buckets for merchant copy. Formerly `lib/argument/avsCvvExplain.ts`,
 * folded in here so the description and the predicate cannot drift apart.
 *
 * MERCHANT-LANGUAGE RULE (2026-07-23): merchant copy never leads with a bare
 * gateway code — "AVS code Z" means nothing outside a bank. Callers resolve
 * these buckets to localized sentences with the code in parentheses.
 *
 * DELIBERATELY COARSE (same directive): the merchant view does not split
 * street-only from ZIP-only; any failing component reads as "the address did
 * not match".
 */
export type AvsBucket = VerificationOutcome;
export type CvvBucket = VerificationOutcome;

export function avsBucket(code: string | null | undefined): AvsBucket | null {
  return readPaymentVerification({ avsResultCode: code ?? null }).avs.outcome;
}

export function cvvBucket(code: string | null | undefined): CvvBucket | null {
  return readPaymentVerification({ cvvResultCode: code ?? null }).cvv.outcome;
}
