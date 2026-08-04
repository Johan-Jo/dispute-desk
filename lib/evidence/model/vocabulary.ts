/**
 * Canonical evidence vocabularies — one per genuine concept.
 *
 * WHY THIS FILE EXISTS. The 2026-08-03 audit found **seven mutually
 * incompatible strength vocabularies** describing the same evidence:
 * `EvidenceCategory` (strong|moderate|supporting|invalid),
 * `EvidenceLineItem.strengthContribution` (…|internal_only|none),
 * `EvidenceFactCategory`, `SignalId`, `submissionMethod`, and two private
 * RANK maps. Consumers translated between them ad hoc, and concepts that are
 * genuinely different — "is this payload sound?" versus "how much does it
 * prove?" — were being carried in one enum.
 *
 * The fix is NOT one universal enum. It is one authoritative vocabulary per
 * concept. `invalid` in particular is a **validity** state, not a strength:
 * an AVS payload with no matching codes is perfectly well-formed evidence
 * that happens to prove nothing, which is a different thing from a delivery
 * payload we could not parse.
 *
 * Plan: docs/plans (approved 2026-08-04) §3.1. Nothing here is English —
 * every merchant- or bank-facing string is an I18nToken resolved by the
 * projection layer.
 */

/* ── 1. Validity — is the payload sound enough to reason about? ── */

/**
 * `invalid` means we understood the payload and it carries no assertion we
 * can stand behind (e.g. AVS `N` + CVV `N`). `unverifiable` means we could
 * not establish the fact from what we hold (e.g. a shipment still in
 * transit) — materially different, because unverifiable evidence may become
 * valid later while invalid evidence will not.
 */
export type ValidityState = "valid" | "invalid" | "unverifiable";

export interface Validity {
  state: ValidityState;
  /** Why, when not `valid`. Merchant-facing; never bank-facing. */
  reasonToken: import("@/lib/i18n/token").I18nToken | null;
}

/* ── 2. Quality — how much does a VALID record prove? ── */

/**
 * Deliberately not `strong|moderate|supporting`: those words were doing
 * triple duty as validity, scoring weight and UI badge. Quality answers only
 * "how much does this prove", and it is meaningful only when
 * `validity.state === "valid"`.
 */
export type EvidenceQuality = "decisive" | "corroborating" | "contextual";

/** Ordering for aggregation rollups. Higher wins. */
export const QUALITY_RANK: Record<EvidenceQuality, number> = {
  decisive: 3,
  corroborating: 2,
  contextual: 1,
};

/* ── 3. Relevance — does this dispute's reason care? ── */

/**
 * Owned by the reason template, and **only** this. Relevance may never
 * decide whether evidence exists — that was the mechanism of the
 * 2026-08-02 #352552 incident, where a field absent from
 * `REASON_TEMPLATES_V2` became invisible and unscored despite being
 * collected and cited to the issuer. See authority rule R3 in the plan.
 */
export type RelevanceLevel =
  | "critical"
  | "recommended"
  | "optional"
  | "not_applicable";

/* ── 4. Citation eligibility — may the issuer see this record? ── */

/**
 * `ineligible` is the ordinary "nothing here worth citing". The two
 * `withheld_*` states are deliberate suppression of evidence that IS sound:
 *   - `withheld_internal` — structurally never bank-facing (device/session
 *     signals), the merchant-only layer of the two-layer non-disclosure rule.
 *   - `withheld_risk` — citing it would hand the issuer an argument (refund
 *     and cancellation history on a bank pack; an "attempted" 3DS that never
 *     completed).
 * They are distinct because the merchant UI explains them differently and
 * because only `withheld_risk` is ever overridable.
 */
export type CitationEligibility =
  | "eligible"
  | "ineligible"
  | "withheld_internal"
  | "withheld_risk";

export interface CitationState {
  eligibility: CitationEligibility;
  reasonToken: import("@/lib/i18n/token").I18nToken | null;
}

/** Convenience predicate — the ONE definition of "may reach the issuer". */
export function isCitable(citation: CitationState): boolean {
  return citation.eligibility === "eligible";
}

/* ── 5. Submission disposition — what happened to it in the end? ── */

/**
 * Replaces `EvidenceLineItem.submissionMethod`. `not_supported` is dropped:
 * it was declared in the old enum and never produced by any code path.
 */
export type SubmissionDisposition =
  | "bank_argument"
  | "context_only"
  | "internal_only"
  | "not_included"
  | "excluded"
  | "waived"
  | "failed_upload";

/* ── 6. Case strength — a property of the CASE, not of an item ── */

/**
 * Unchanged in meaning from `lib/argument/caseStrength.ts`, restated here so
 * the model layer does not import the scorer. Item-level quality and
 * case-level strength were previously both spelled `strong|moderate|…`,
 * which is why they kept being confused.
 */
export type CaseStrengthLevel = "strong" | "moderate" | "weak" | "insufficient";

/* ── Bridges to the legacy vocabularies (P1 only) ────────────────────────
 *
 * These exist so the shadow derivation can be compared against today's
 * consumers. They are DELETED in P6 once no legacy consumer remains — a
 * bridge that outlives the migration becomes an eighth vocabulary.
 * ------------------------------------------------------------------- */

import type { EvidenceCategory } from "@/lib/argument/canonicalEvidence";

/**
 * Legacy `EvidenceCategory` → (validity, quality). The legacy enum folded
 * both axes together, so this split is the whole point: `invalid` carries no
 * quality at all.
 */
export function fromLegacyCategory(
  category: EvidenceCategory,
): { validity: ValidityState; quality: EvidenceQuality | null } {
  switch (category) {
    case "strong":
      return { validity: "valid", quality: "decisive" };
    case "moderate":
      return { validity: "valid", quality: "corroborating" };
    case "supporting":
      return { validity: "valid", quality: "contextual" };
    case "invalid":
      return { validity: "invalid", quality: null };
  }
}

/**
 * The inverse, for characterization tests that assert the shadow model
 * reproduces a legacy consumer's answer. Lossy by construction —
 * `unverifiable` has no legacy spelling, which is itself a finding worth
 * recording in the divergence manifest rather than papering over.
 */
export function toLegacyCategory(
  validity: ValidityState,
  quality: EvidenceQuality | null,
): EvidenceCategory | null {
  if (validity === "invalid") return "invalid";
  if (validity === "unverifiable") return null;
  switch (quality) {
    case "decisive":
      return "strong";
    case "corroborating":
      return "moderate";
    case "contextual":
      return "supporting";
    default:
      return null;
  }
}
