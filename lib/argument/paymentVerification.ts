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

import {
  isAddressMatchResult,
  normalizeAvsCode,
  resolveCardNetwork,
  type AvsAuthority,
  type AvsNormalizedResult,
  type CardNetwork,
} from "./avsCodeMap";

/* ── Codes ─────────────────────────────────────────────────────────────── */

/**
 * AVS semantics moved to `avsCodeMap.ts` in PR-C3 (C-13): normalization is
 * keyed on (network, code), every cell carries an authority state, and the
 * citation set is the primary-sourced one. This module stays the single
 * PREDICATE surface — nothing outside it reads the map directly.
 *
 * `tests/unit/paymentVerificationSingleOwner.test.ts` fails the build if a
 * second definition of either code set appears anywhere in the repo.
 */

/** CVV codes that count as a match. M = match. */
const CVV_SCORING_MATCH = new Set(["M"]);

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
   * SCORING predicate: is this a match we credit?
   *
   * Since PR-C3 this is derived from the normalized result, so the
   * descriptive reading and the scoring reading cannot disagree — the `F`
   * divergence PR-C2 pinned is resolved by the map, conservatively: an
   * unlisted code is `unknown` and credits nothing.
   *
   * NOT the citation question. See `PaymentVerification.citable`.
   */
  matched: boolean;
}

/** The AVS half, with its normalization and its authority. */
export interface AvsSubfact extends VerificationSubfact {
  /** Factual reading of the issuer's response (PR-C3). */
  normalized: AvsNormalizedResult;
  /** Verification state of the map cell this code resolved through. */
  authority: AvsAuthority;
  /** A code the map has no entry for: diagnostic, never credit. */
  unmapped: boolean;
}

export interface PaymentVerification {
  /** The card network, used to key the AVS map. `unknown` is first-class. */
  network: CardNetwork;
  /** Address Verification Service — the ADDRESS fact. */
  avs: AvsSubfact;
  /** Card security code — the CARD-POSSESSION fact. */
  cvv: VerificationSubfact;
  /**
   * The issuer confirmed the address (AVS), to the SCORING standard — the
   * three match flavours. Feeds grade, merchant copy and internal signals.
   * Broader than what may be cited (PR-C3 decision 3).
   */
  addressVerified: boolean;
  /**
   * The issuer confirmed the address to the CITABLE standard: a
   * primary-sourced code (register R-E names `Y` and `M`). This, not
   * `addressVerified`, is what authorizes bank-facing text.
   */
  citableAddressVerified: boolean;
  /** The issuer confirmed the security code. Never an address authority. */
  securityCodeVerified: boolean;
  /**
   * DECISION 1. True when the security code matched and the address did not
   * (or was never verified) — a valid internal fact with no citable content.
   */
  cvvOnly: boolean;
  /**
   * May any part of this fact reach an issuer?
   *
   * DECISION 1 (PR-C2): requires the address half — a CVV-only match is
   * structurally uncitable. DECISION 3 (PR-C3): the address half must be a
   * PRIMARY-SOURCED match; a `W` postal-only result stays merchant-visible
   * and no longer travels under a rule that names `Y` or `M`.
   *
   * No consumer can opt back in: every bank-facing surface reads this flag.
   */
  citable: boolean;
  /**
   * The issuer returned a code the canonical map does not recognise. Earns
   * nothing anywhere and raises an internal diagnostic; on its own it never
   * parks the dispute — escalation happens only when a package tries to RELY
   * on it, which the claim guards refuse.
   */
  avsUnmapped: boolean;
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

/** The descriptive bucket for a normalized AVS result — the coarse merchant
 *  reading (2026-07-23 directive), derived from the map so the description
 *  and the predicate cannot drift. */
function outcomeForAvs(normalized: AvsNormalizedResult): VerificationOutcome {
  if (isAddressMatchResult(normalized)) return "match";
  if (normalized === "no_match") return "no_match";
  // `not_checked`, `unavailable` and `unknown` all read as "the issuer did
  // not tell us", never as a mismatch. An unrecognised code is a gap in OUR
  // map; saying it failed would put words in the issuer's mouth.
  return "unchecked";
}

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

  // AVS resolves through the canonical (network, code) map (PR-C3). The
  // network is read from the same payload the codes came from; `unknown` is a
  // first-class state that selects the base table and is never punitive.
  const network = resolveCardNetwork(p);
  const normalizedAvs = normalizeAvsCode(network, avsCode);
  const avsMatched = isAddressMatchResult(normalizedAvs.result);
  const avs: AvsSubfact = {
    code: normalizedAvs.code,
    present: normalizedAvs.code !== null,
    outcome: normalizedAvs.code === null ? null : outcomeForAvs(normalizedAvs.result),
    matched: avsMatched,
    normalized: normalizedAvs.result,
    authority: normalizedAvs.authority,
    unmapped: normalizedAvs.unmapped,
  };
  const cvv = subfact(cvvCode, CVV_SCORING_MATCH, CVV_DEFINITE_NO_MATCH);

  const addressVerified = avs.matched;
  // Citation needs the primary-sourced code, not merely a match (decision 3).
  const citableAddressVerified = avsMatched && normalizedAvs.ceItem3Citable;
  const securityCodeVerified = cvv.matched;

  const name = typeof p.cardholderName === "string" ? p.cardholderName.trim() : "";

  return {
    network,
    avs,
    cvv,
    addressVerified,
    citableAddressVerified,
    securityCodeVerified,
    cvvOnly: securityCodeVerified && !addressVerified,
    citable: citableAddressVerified,
    avsUnmapped: avs.unmapped,
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
  return hasCitableAddressMatch(v) && v.securityCodeVerified;
}

/**
 * The citable address match — a primary-sourced (network, code) cell.
 *
 * PR-C2 left this as a literal `avs.code === "Y"`, which was the strictest
 * thing available before the map existed and is now both too narrow and too
 * loose: too narrow because a **Visa `M`** is named by the same rule as `Y`,
 * too loose because it accepted a `Y` on any network, including one whose
 * document we have never read. PR-C3 replaces the letter with the cell.
 */
export function hasCitableAddressMatch(v: PaymentVerification): boolean {
  return v.citableAddressVerified;
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

/**
 * PR-C3: a citable fact is `Y` or `M` — a FULL address match — so the clause
 * is the full-match one. The street-only (`A`) and postal-only (`W`) variants
 * that used to live here are unreachable now that a partial result cannot be
 * cited; they survive on the merchant surfaces, which say what the issuer
 * actually returned.
 */
function addressClauseEn(_v: PaymentVerification): string {
  return "the billing address matched the issuer's records";
}

/**
 * The same content in the Evidence Basis table's terse register
 * ("billing address matched • CVV matched"), for facts built before
 * `verificationSummary` existed. Empty for everything uncitable.
 */
export function citableVerificationPartsEn(v: PaymentVerification): string[] {
  if (!v.citable) return [];
  const parts: string[] = ["billing address matched"];
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
