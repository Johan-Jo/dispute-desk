/**
 * The package as a PROJECTION of `CaseArgumentPlan` (CP-B §2).
 *
 * THE LOAD-BEARING PROPERTY: no sentence may survive after its support is
 * removed. Everything else in this file exists to make that structurally true
 * rather than hopefully true.
 *
 * WHY REBUILDING IS NOT THE SAME AS FILTERING. Before this module, a
 * `review_required` fact was suppressed at the Evidence Basis table while the
 * prose that had been generated around it stayed in the letter — the fact
 * vanished from the appendix and the claim it supported went to the issuer
 * unsupported. That is an ORPHANED CLAIM, and it is worse than either extreme:
 * the issuer reads an assertion and finds nothing behind it.
 *
 * SECTION GRANULARITY, DELIBERATELY. When a section cites an excluded record,
 * the WHOLE section is dropped, not the offending clause. Sub-sentence surgery
 * would require knowing which words a fact supports, which nothing in this
 * system knows; a partial edit that leaves the topic sentence in place is the
 * orphaned claim again, in a smaller box. Dropping the block and letting the
 * deterministic validator re-check what remains is the version that can be
 * proven.
 *
 * NOTHING IS RECLASSIFIED HERE. Which facts may be used is answered entirely by
 * `plan.included`; this module performs no eligibility test of its own. That is
 * the CP-B acceptance criterion "package generation contains no independent
 * evidence classification outside CaseArgumentPlan".
 */

import type { CaseArgumentPlanSnapshot } from "@/lib/pipeline/contracts";
import { excludedRecordIds, includedRecordIds } from "@/lib/argument/plan";
import { composePdfBlocks } from "../pdf/composePdfBlocks";
import { hasFulfillmentClaimAuthority } from "./fulfillmentClaimAuthority";
import type {
  ComposedDocumentBlock,
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSectionKey,
  PackageMode,
  ReasonCodeFamilyKey,
} from "../types";

/** Machine reason recorded on a section the plan emptied. Never prose. */
export const SUPPORT_EXCLUDED_REASON = "support_excluded_by_argument_plan";

/**
 * One claim that lost its support. Kept as data, not as a log line: the rebuild
 * must be able to PROVE nothing survived, and an audit that only exists in
 * stdout cannot be asserted on.
 */
export interface OrphanedClaim {
  sectionKey: NarrativeSectionKey;
  /** Record ids the section cited that the plan does not authorise. */
  unsupportedFactIds: string[];
}

export interface PlanFactSelection {
  /** The ONLY facts any issuer-facing surface may use. */
  includedFacts: EvidenceFact[];
  /** Plan-authorised record ids for which no fact was supplied. */
  missingRecordIds: string[];
  /** Record ids the plan removed. */
  excludedIds: Set<string>;
}

/**
 * Fact selection — `plan.included` resolved against the case's facts.
 *
 * The map is keyed by the plan's `recordId`, which is source-derived and stable
 * across rebuilds. `EvidenceFact.id` is positional (`f${index}`) and therefore
 * cannot be the join key: the same fact carries a different id on every rebuild,
 * which is exactly why the plan does not reference it.
 *
 * A plan-authorised record with no fact is REPORTED, never silently skipped. It
 * means the plan and the fact set were derived from different inputs, which is a
 * staleness condition the selector must be able to see.
 */
export function selectPlanFacts(
  plan: CaseArgumentPlanSnapshot,
  factsByRecordId: ReadonlyMap<string, EvidenceFact>,
): PlanFactSelection {
  const includedFacts: EvidenceFact[] = [];
  const missingRecordIds: string[] = [];
  for (const recordId of includedRecordIds(plan)) {
    const fact = factsByRecordId.get(recordId);
    if (!fact) {
      missingRecordIds.push(recordId);
      continue;
    }
    /* RELABELLED to the record id — this line is what joins the two halves of
     * the pipeline.
     *
     * The narrative writer passes `fact.id` into the LLM payload verbatim, the
     * model cites those ids back in `usedFactIds`, and
     * `rebuildNarrativeFromPlan` checks the citations against the plan's
     * record ids. With the classifier's positional `f${n}` ids, nothing could
     * ever match: every section orphaned and every canonical build failed
     * `orphaned_claim` — measured live on the 2026-08-15 activation canary,
     * a FRESH generation, on the first real execution of this route.
     *
     * A copy, never a mutation: the map's values are the classifier's own fact
     * objects, shared with the legacy path, and relabelling those in place
     * would leak record ids into a route that still expects `f${n}`.
     *
     * Everything downstream of the canonical route reads this one list — the
     * LLM payload, `validateNarrative`'s referential layer (it builds
     * `approvedFactIds` from the same array), and the projection — so the
     * namespaces agree everywhere by construction rather than by parallel
     * bookkeeping. */
    includedFacts.push({ ...fact, id: recordId });
  }
  return {
    includedFacts,
    missingRecordIds: missingRecordIds.sort(),
    excludedIds: excludedRecordIds(plan),
  };
}

const SECTION_KEYS: NarrativeSectionKey[] = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
];

export interface RebuiltNarrative {
  narrative: DefenceNarrativeOutput;
  orphaned: OrphanedClaim[];
}

/**
 * Rebuild the narrative from the plan's included set.
 *
 * A section survives only when every id it cites is plan-authorised. Anything
 * else is emptied and listed in `omittedSections`, which keeps the narrative
 * self-consistent for `validateNarrative`'s layer 4 and leaves a machine-readable
 * record of what was dropped and why.
 *
 * `usedFactIds` here are the plan's RECORD ids. A generator that still emits
 * positional `f${n}` ids produces no match and its sections are dropped whole —
 * the conservative answer, and the one that makes a half-migrated caller
 * obviously broken instead of quietly unsafe.
 */
export function rebuildNarrativeFromPlan(args: {
  narrative: DefenceNarrativeOutput;
  plan: CaseArgumentPlanSnapshot;
}): RebuiltNarrative {
  const authorised = includedRecordIds(args.plan);
  const orphaned: OrphanedClaim[] = [];
  const rebuilt = { ...args.narrative } as DefenceNarrativeOutput;
  // A prior support-excluded omission survives only while its section is still
  // empty. Keeping it unconditionally would leave a stale "we dropped this"
  // record on a section a later plan restored; dropping it unconditionally
  // would make the rebuild non-idempotent, erasing the reason on the second
  // pass — and the reason is the whole point of recording it.
  const omitted = args.narrative.omittedSections.filter(
    (o) =>
      o.reason !== SUPPORT_EXCLUDED_REASON ||
      (args.narrative[o.sectionKey]?.text ?? "").trim() === "",
  );

  for (const sectionKey of SECTION_KEYS) {
    const section = args.narrative[sectionKey];
    if (!section) continue;
    const unsupported = section.usedFactIds.filter((id) => !authorised.has(id));
    if (unsupported.length === 0) continue;
    orphaned.push({ sectionKey, unsupportedFactIds: [...unsupported].sort() });
    rebuilt[sectionKey] = { text: "", usedFactIds: [] };
    if (!omitted.some((o) => o.sectionKey === sectionKey)) {
      omitted.push({ sectionKey, reason: SUPPORT_EXCLUDED_REASON });
    }
  }

  rebuilt.omittedSections = omitted;
  return { narrative: rebuilt, orphaned };
}

export interface ProjectPackageInput {
  plan: CaseArgumentPlanSnapshot;
  narrative: DefenceNarrativeOutput;
  /** Keyed by the plan's `recordId`, never by `EvidenceFact.id`. */
  factsByRecordId: ReadonlyMap<string, EvidenceFact>;
  packageMode: PackageMode;
  familyKey: ReasonCodeFamilyKey;
  moduleKey: string | null;
  fulfillmentStatus: string | null;
  /**
   * The plan's included facts AFTER the bank-inclusion filter, when the caller
   * applies one.
   *
   * Two different questions produce two different lists and both have to be
   * asked: `plan.included` answers "does this fact belong in THIS argument",
   * `isBankIncludedFact` answers "may an issuer see it at all". The projection
   * composes from the intersection; `selectPlanFacts` alone would compose from
   * the first only, which is how a plan-authorised but bank-ineligible fact
   * reaches a thesis. Omitted ⇒ the plan's own list, i.e. the caller has
   * already intersected or has no bank filter to apply.
   */
  bankIncludedFacts?: EvidenceFact[];
}

export interface PackageProjection {
  /** Fact selection — the Evidence Basis, Case Details and chronology source. */
  includedFacts: EvidenceFact[];
  /** Record ids the plan removed. Nothing downstream may read them. */
  excludedRecordIds: string[];
  /** Plan-authorised records with no fact supplied. A staleness symptom. */
  missingRecordIds: string[];
  /** Sections dropped because their support was removed. */
  orphaned: OrphanedClaim[];
  /** The rebuilt narrative — what the document is composed from. */
  narrative: DefenceNarrativeOutput;
  /** Thesis + body + fallback per surviving section. THE rendered content. */
  blocks: ComposedDocumentBlock[];
}

/**
 * Plan → package. Fact selection, thesis, chronology source and section
 * composition, all from `plan.included`.
 *
 * `composePdfBlocks` is handed ONLY the included facts, so the templated thesis
 * re-renders from the surviving support: a thesis token whose predicate no
 * longer evaluates resolves null and the whole blockquote disappears, which is
 * the same "no sentence survives its support" rule applied to deterministic
 * prose.
 */
export function projectPackageFromPlan(input: ProjectPackageInput): PackageProjection {
  const selection = selectPlanFacts(input.plan, input.factsByRecordId);
  const rebuilt = rebuildNarrativeFromPlan({
    narrative: input.narrative,
    plan: input.plan,
  });

  const composeFrom = input.bankIncludedFacts ?? selection.includedFacts;

  const blocks = composePdfBlocks({
    narrative: rebuilt.narrative,
    approvedFacts: composeFrom,
    packageMode: input.packageMode,
    familyKey: input.familyKey,
    moduleKey: input.moduleKey,
    fulfillmentStatus: input.fulfillmentStatus,
    // F6. The deterministic fulfilment paragraph is authorised by the
    // ARGUMENT, never by the raw `fulfillmentStatus` scalar. Derived from the
    // same facts the document is composed from, so the validator can
    // re-derive it independently instead of trusting a flag passed alongside.
    fulfillmentClaimAuthority: hasFulfillmentClaimAuthority(composeFrom),
  });

  return {
    includedFacts: selection.includedFacts,
    excludedRecordIds: [...selection.excludedIds].sort(),
    missingRecordIds: selection.missingRecordIds,
    orphaned: rebuilt.orphaned,
    narrative: rebuilt.narrative,
    blocks,
  };
}
