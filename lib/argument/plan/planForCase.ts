/**
 * The ONE production bridge from a case's persisted evidence to a
 * `CaseArgumentPlanSnapshot`.
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────
 *
 * `deriveCaseArgumentPlan` is pure and deliberately narrow: it takes candidates
 * and a module's two lists, and it cannot see a payload. That is what stops the
 * plan re-classifying evidence. But something has to turn `pack_json.sections`
 * into those candidates, resolve `alwaysAdmissible` against the real facts, and
 * build the record-id → fact map the projection joins on — and if TWO callers
 * do that (the build job when it writes a package, the selector when it decides
 * whether that package is current), they will disagree about the input hash and
 * every package will read stale against itself.
 *
 * So it happens here, once. The build job and `loadFileableSelection` both call
 * `derivePlanForCase`, which is what makes "the plan the package was built from"
 * and "the plan that is current now" comparable at all.
 *
 * ── THE JOIN KEY, AND WHY IT IS AWKWARD ───────────────────────────────
 *
 * The plan speaks `recordId` (`${fieldKey}#${instanceKey}`) — source-derived and
 * stable across rebuilds. `EvidenceFact.id` is POSITIONAL (`f${index}`), so it
 * cannot be the join key: the same fact carries a different id on every rebuild,
 * which is exactly why the plan does not reference it.
 *
 * The bridge is `EvidenceFact.value.fieldKey`, which `classifyFacts` writes onto
 * every fact it emits. One field may yield several records (parcels,
 * conversations, uploads) and today's classifier emits ONE fact per field, so
 * the map is many-records-to-one-fact. That is faithful rather than lossy: the
 * plan's per-record exclusion reasons stay per-record — the merchant is still
 * told which parcel needs confirming — while the fact those records resolve to
 * is the same object, so the projection cannot emit it twice.
 *
 * Grading and collapsing records individually is P2b work with its own
 * transition matrix; this module does not anticipate it.
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────
 *
 * No clock, no I/O, no randomness. `computedAt` is supplied by the caller and is
 * audit-only — it never enters the hash. Two calls with the same persisted
 * inputs produce byte-identical plans and hashes, which is the property that
 * makes `plan_input_hash` a staleness signal instead of a timestamp.
 */

import type {
  CaseArgumentPlanSnapshot,
  MerchantReviewItem,
} from "@/lib/pipeline/contracts";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import type { DeriveCaseEvidenceModelInput } from "@/lib/evidence/model/derive";
import { alwaysAdmissibleCategories } from "@/lib/defence/alwaysAdmissible";
import type { EvidenceFact, ReasonCodeGuidance } from "@/lib/defence/types";
import { planCandidatesFromModel, type PlanCandidate } from "./candidates";
import { computePlanInputHash } from "./planInputHash";
import { deriveCaseArgumentPlan, PLAN_VERSION } from "./deriveArgumentPlan";

/**
 * Bumped when the POLICY changes — which facts may be argued from, what a
 * review item blocks — as opposed to when the derivation's shape changes
 * (`PLAN_VERSION`). A policy bump invalidates every snapshot even when the
 * inputs are byte-identical, which a hash alone cannot express.
 */
export const PLAN_POLICY_VERSION = 1;

export interface DerivePlanForCaseInput {
  caseId: string;
  /** Everything `deriveCaseEvidenceModel` needs. Passed through unchanged. */
  model: DeriveCaseEvidenceModelInput;
  reasonCodeModule: Pick<
    ReasonCodeGuidance,
    "key" | "allowedFactCategories" | "criticalCategories"
  >;
  /**
   * The classifier's approved facts. Read for exactly two things: resolving
   * `alwaysAdmissible` (which operates on `value.fieldKey` and therefore cannot
   * live inside the plan), and building the record → fact map.
   *
   * NOT read to decide inclusion. That is the plan's job, and handing the
   * derivation a fact list it could filter is how "the plan consumes
   * classification" quietly becomes "the plan performs it".
   */
  approvedFacts: readonly EvidenceFact[];
  /** Records the merchant must resolve. Their presence makes the plan deadline-only. */
  reviewItems?: readonly MerchantReviewItem[];
  /** ISO-8601. Audit only — never an input to the hash. */
  computedAt: string;
}

export interface PlanForCase {
  plan: CaseArgumentPlanSnapshot;
  /** The value persisted as `defence_packages.plan_input_hash`. */
  planInputHash: string;
  policyVersion: number;
  candidates: PlanCandidate[];
  /**
   * `recordId` → the fact that record resolves to. The projection's join.
   * A record whose field produced no fact is simply absent, which
   * `selectPlanFacts` reports as `missingRecordIds` — a staleness symptom the
   * selector must be able to see, never a silent skip.
   */
  factsByRecordId: Map<string, EvidenceFact>;
}

/** `EvidenceFact.value.fieldKey`, the only link back to a model record. */
function fieldKeyOf(fact: EvidenceFact): string | null {
  const key = (fact.value as { fieldKey?: unknown } | null)?.fieldKey;
  return typeof key === "string" ? key : null;
}

export function derivePlanForCase(input: DerivePlanForCaseInput): PlanForCase {
  const { model } = deriveCaseEvidenceModel(input.model);
  const candidates = planCandidatesFromModel(model);

  // Resolved against the real facts, here rather than inside the derivation:
  // the admission test reads `value.fieldKey`, and letting the plan reach a
  // payload is the one thing its narrow input shape exists to prevent.
  const alwaysAdmissible = alwaysAdmissibleCategories(input.approvedFacts);

  const planInputHash = computePlanInputHash({
    reasonModuleId: input.reasonCodeModule.key,
    allowedFactCategories: input.reasonCodeModule.allowedFactCategories,
    criticalCategories: input.reasonCodeModule.criticalCategories,
    alwaysAdmissibleCategories: alwaysAdmissible,
    candidates,
    reviewItems: input.reviewItems,
  });

  const plan = deriveCaseArgumentPlan({
    caseId: input.caseId,
    reasonModuleId: input.reasonCodeModule.key,
    reasonModule: input.reasonCodeModule,
    candidates,
    alwaysAdmissibleCategories: alwaysAdmissible,
    reviewItems: input.reviewItems,
    freshness: {
      inputHash: planInputHash,
      policyVersion: PLAN_POLICY_VERSION,
      computedAt: input.computedAt,
    },
    planVersion: PLAN_VERSION,
  });

  const factByFieldKey = new Map<string, EvidenceFact>();
  for (const fact of input.approvedFacts) {
    const key = fieldKeyOf(fact);
    // First fact wins. `classifyFacts` emits one fact per (section, fieldKey)
    // and a field can appear in two sections; taking the first keeps the map
    // deterministic under the classifier's own ordering rather than under
    // whichever section happened to be scanned last.
    if (key && !factByFieldKey.has(key)) factByFieldKey.set(key, fact);
  }

  const factsByRecordId = new Map<string, EvidenceFact>();
  for (const candidate of candidates) {
    const fact = factByFieldKey.get(candidate.fieldKey);
    if (fact) factsByRecordId.set(candidate.recordId, fact);
  }

  return {
    plan,
    planInputHash,
    policyVersion: PLAN_POLICY_VERSION,
    candidates,
    factsByRecordId,
  };
}
