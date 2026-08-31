/**
 * Comparable-cohort construction and sufficiency gates (plan §15.6, §18, §23 step 11).
 *
 * ── The gates are enforced by the TYPE, not by a flag ──
 *
 * The obvious shape is `{ winRate: number; sufficient: boolean }`, and it is the
 * wrong one: every caller must remember to check the flag, and the one that
 * forgets renders a percentage computed from four cases. Plan §18 forbids
 * exactly that ("percentage differences below the stated sample thresholds"),
 * and a rule enforced by convention is enforced until someone is in a hurry.
 *
 * So `CohortResult` is a discriminated union. Rates exist ONLY on the
 * `SUFFICIENT` variant. An insufficient cohort carries raw counts and the list
 * of blocking dimensions — enough to explain itself, structurally incapable of
 * yielding a percentage.
 *
 * ── Why this ships with no UI ──
 *
 * Production has 8 installed shops, 3 with any analyzable decided case, and one
 * merchant holding 92% of them. A niche-matched cohort excluding the selected
 * merchant cannot reach the 3-peer floor, so every benchmark render today would
 * correctly refuse. Plan §25.6 therefore defers the panel and keeps the gates:
 * they are what stops a misleading average the day the data does arrive, and
 * they are cheap to carry until then.
 */

import type {
  AnalyzableOutcome,
  CardNetwork,
  PaymentProvider,
  ProviderAccessLevel,
} from "./taxonomy";

/* ──────────────────────────── Cohort definition ───────────────────────────── */

/**
 * Every dimension that must match before two decided cases may be compared.
 *
 * `cardNetwork: "UNKNOWN"` forms its OWN cohort and is never merged with a
 * known network (plan §18). That is not pedantry: 49 of 50 prod cases have an
 * unknown network, so a merge would silently pool almost everything.
 */
export interface CohortDefinition {
  paymentProvider: PaymentProvider;
  providerAccessLevel: ProviderAccessLevel;
  merchantNiche: string | null;
  phase: string;
  reasonFamily: string;
  /** Exact code when the sample permits; null means family-level only. */
  networkReasonCode: string | null;
  cardNetwork: CardNetwork;
  windowStart: string;
  windowEnd: string;
  /** Compatible analyzer versions, or null for "any" with the caveat recorded. */
  analyzerVersions: number[] | null;
  /** Excluded from its own benchmark (plan §18). */
  excludeShopId: string | null;
}

/** One decided case as the cohort layer sees it. */
export interface CohortCase {
  disputeId: string;
  shopId: string;
  outcome: AnalyzableOutcome;
  finalizedAt: string;
  paymentProvider: PaymentProvider;
  providerAccessLevel: ProviderAccessLevel;
  merchantNiche: string | null;
  phase: string;
  reasonFamily: string;
  networkReasonCode: string | null;
  cardNetwork: CardNetwork;
  analyzerVersion: number;
}

/** Stable identity for a cohort, so a frozen snapshot can be matched later. */
export function cohortKey(definition: CohortDefinition): string {
  return [
    definition.paymentProvider,
    definition.providerAccessLevel,
    definition.merchantNiche ?? "NICHE_UNKNOWN",
    definition.phase,
    definition.reasonFamily,
    definition.networkReasonCode ?? "CODE_ANY",
    definition.cardNetwork,
    definition.windowStart,
    definition.windowEnd,
    definition.analyzerVersions?.slice().sort((a, b) => a - b).join("+") ?? "VER_ANY",
    definition.excludeShopId ?? "NO_EXCLUSION",
  ].join("|");
}

export function matchesCohort(c: CohortCase, d: CohortDefinition): boolean {
  if (d.excludeShopId && c.shopId === d.excludeShopId) return false;
  if (c.paymentProvider !== d.paymentProvider) return false;
  if (c.providerAccessLevel !== d.providerAccessLevel) return false;
  if (c.phase !== d.phase) return false;
  if (c.reasonFamily !== d.reasonFamily) return false;
  // UNKNOWN network never merges with a known one, in either direction.
  if (c.cardNetwork !== d.cardNetwork) return false;
  // An UNKNOWN niche may be analysed individually but never enters a niche
  // benchmark (plan §4.5).
  if (d.merchantNiche !== null && c.merchantNiche !== d.merchantNiche) return false;
  if (d.merchantNiche === null && c.merchantNiche !== null) return false;
  if (d.networkReasonCode !== null && c.networkReasonCode !== d.networkReasonCode) {
    return false;
  }
  if (d.analyzerVersions && !d.analyzerVersions.includes(c.analyzerVersion)) return false;

  const at = Date.parse(c.finalizedAt);
  return at >= Date.parse(d.windowStart) && at <= Date.parse(d.windowEnd);
}

/* ─────────────────────────── Sufficiency thresholds ───────────────────────── */

export const COHORT_THRESHOLDS = {
  /** Peer merchants required, EXCLUDING the selected one (plan §15.6). */
  minPeerMerchants: 3,
  /** Decided cases required in the comparison cohort. */
  minPeerCases: 30,
  /** Decided cases required for the selected merchant before a rate is shown. */
  minSubjectCases: 10,
  /** Both sides of a pairwise comparison before it stops being "directional". */
  minPairwiseCases: 30,
  /** Floor for a pairwise comparison to be shown at all. */
  minPairwiseDirectional: 10,
} as const;

export type CohortBlocker =
  | "NO_COMPARABLE_COHORT"
  | "TOO_FEW_PEER_MERCHANTS"
  | "TOO_FEW_PEER_CASES"
  | "TOO_FEW_SUBJECT_CASES"
  | "NICHE_UNKNOWN";

export interface CohortCounts {
  peerCases: number;
  peerMerchants: number;
  peerWon: number;
  peerLost: number;
  subjectCases: number;
  subjectWon: number;
  subjectLost: number;
}

/**
 * The result of asking for a benchmark.
 *
 * Rates live only on the sufficient variant. A caller cannot read a percentage
 * off an insufficient cohort because there is none to read.
 */
export type CohortResult =
  | {
      status: "SUFFICIENT";
      key: string;
      definition: CohortDefinition;
      counts: CohortCounts;
      /** Descriptive outcome rate. Never a causal lift (plan §9). */
      peerWinRate: number;
      subjectWinRate: number;
      /** Percentage points, subject minus peer. Descriptive. */
      absoluteDifference: number;
    }
  | {
      status: "INSUFFICIENT_SAMPLE" | "NO_COMPARABLE_COHORT";
      key: string;
      definition: CohortDefinition;
      counts: CohortCounts;
      blockers: CohortBlocker[];
    };

function rate(won: number, total: number): number {
  return total === 0 ? 0 : won / total;
}

/**
 * Build a benchmark for one merchant against its comparable cohort.
 *
 * `subjectCases` and `peerCases` are passed separately rather than filtered
 * from one list, so the exclusion of the subject from its own benchmark is
 * structural rather than a predicate someone can drop.
 */
export function evaluateCohort(
  definition: CohortDefinition,
  allCases: readonly CohortCase[],
  subjectShopId: string,
): CohortResult {
  const peerDefinition: CohortDefinition = {
    ...definition,
    excludeShopId: subjectShopId,
  };

  const peers = allCases.filter((c) => matchesCohort(c, peerDefinition));
  const subject = allCases.filter(
    (c) =>
      c.shopId === subjectShopId &&
      matchesCohort(c, { ...definition, excludeShopId: null }),
  );

  const counts: CohortCounts = {
    peerCases: peers.length,
    peerMerchants: new Set(peers.map((c) => c.shopId)).size,
    peerWon: peers.filter((c) => c.outcome === "won").length,
    peerLost: peers.filter((c) => c.outcome === "lost").length,
    subjectCases: subject.length,
    subjectWon: subject.filter((c) => c.outcome === "won").length,
    subjectLost: subject.filter((c) => c.outcome === "lost").length,
  };

  const key = cohortKey(peerDefinition);
  const blockers: CohortBlocker[] = [];

  if (definition.merchantNiche === null) blockers.push("NICHE_UNKNOWN");
  if (counts.peerCases === 0) {
    blockers.push("NO_COMPARABLE_COHORT");
    return { status: "NO_COMPARABLE_COHORT", key, definition: peerDefinition, counts, blockers };
  }
  if (counts.peerMerchants < COHORT_THRESHOLDS.minPeerMerchants) {
    blockers.push("TOO_FEW_PEER_MERCHANTS");
  }
  if (counts.peerCases < COHORT_THRESHOLDS.minPeerCases) {
    blockers.push("TOO_FEW_PEER_CASES");
  }
  if (counts.subjectCases < COHORT_THRESHOLDS.minSubjectCases) {
    blockers.push("TOO_FEW_SUBJECT_CASES");
  }

  if (blockers.length > 0) {
    return { status: "INSUFFICIENT_SAMPLE", key, definition: peerDefinition, counts, blockers };
  }

  const peerWinRate = rate(counts.peerWon, counts.peerCases);
  const subjectWinRate = rate(counts.subjectWon, counts.subjectCases);

  return {
    status: "SUFFICIENT",
    key,
    definition: peerDefinition,
    counts,
    peerWinRate,
    subjectWinRate,
    absoluteDifference: subjectWinRate - peerWinRate,
  };
}

/** Human-readable blocking reasons for the admin empty state. */
export function describeBlockers(result: CohortResult): string[] {
  if (result.status === "SUFFICIENT") return [];
  return result.blockers.map((b) => {
    switch (b) {
      case "NO_COMPARABLE_COHORT":
        return "No decided cases match every required dimension.";
      case "TOO_FEW_PEER_MERCHANTS":
        return `${result.counts.peerMerchants} peer merchant(s); ${COHORT_THRESHOLDS.minPeerMerchants} required.`;
      case "TOO_FEW_PEER_CASES":
        return `${result.counts.peerCases} peer case(s); ${COHORT_THRESHOLDS.minPeerCases} required.`;
      case "TOO_FEW_SUBJECT_CASES":
        return `${result.counts.subjectCases} case(s) for this merchant; ${COHORT_THRESHOLDS.minSubjectCases} required.`;
      case "NICHE_UNKNOWN":
        return "Merchant niche is unclassified, so no niche benchmark may be formed.";
    }
  });
}
