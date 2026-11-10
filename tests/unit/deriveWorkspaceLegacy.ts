/**
 * FROZEN COPY of the `derived` computation exactly as it stood inline in
 * `useDisputeWorkspace` before the single-source plan 3.0 extraction (develop
 * d1b3eb1c). It exists only so `deriveWorkspaceParity.test.ts` can prove the
 * extracted `deriveWorkspace` is behaviour-preserving. Do not edit it, do not
 * import it from production code, delete it with the parity test when the
 * extraction has been in production for a release.
 */

import type { useTranslations } from "next-intl";
import type {
  WorkspaceData,
  ChecklistItemV2,
  SubmissionReadiness,
  EvidenceItemWithStrength,
  EvidenceCategory,
  MissingItemWithContext,
  CaseStrengthResult,
} from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import { EVIDENCE_CATEGORIES } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import { computeNextAction } from "@/lib/argument/nextAction";
import { hintAsksForUnsuppliableSignal } from "@/lib/argument/improvementHint";
import type { WorkspaceAssessmentPayload } from "@/lib/disputes/workspaceAssessmentTypes";
import { resolveAssessmentGate } from "@/lib/disputes/assessmentPresence";
import { generateWhyWins } from "@/lib/argument/whyThisCaseWins";
import { generateRiskExplanation } from "@/lib/argument/riskExplanation";
import { generateRecommendation } from "@/lib/argument/recommendation";
import { asLocalized, type Localized } from "@/lib/i18n/localized";
import { resolveToken } from "@/lib/i18n/resolveToken";
import { safeDynamicT } from "@/lib/i18n/safeDynamicT";
import {
  FIELD_ACTIONS,
  DEFAULT_FIELD_ACTION as DEFAULT_ACTION,
  canMerchantUpload,
} from "@/lib/disputes/presentation/concreteContribution";
import type { DerivedState, WorkspaceClientState } from "@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace";


/* ── Missing item context ── */

const EFFORT_MAP: Record<string, "low" | "medium" | "high"> = {
  order_confirmation: "low",
  avs_cvv_match: "low",
  shipping_tracking: "low",
  delivery_proof: "medium",
  customer_communication: "medium",
  refund_policy: "low",
  shipping_policy: "low",
  cancellation_policy: "low",
  product_description: "medium",
  activity_log: "low",
  supporting_documents: "high",
  duplicate_explanation: "medium",
};

// SOURCE_MAP deleted in Phase 5: see comment on EFFORT_MAP.

/* ── Derived state helpers ── */

function deriveEvidenceWithStrength(
  checklist: ChecklistItemV2[],
  evidenceItems: Array<{ type: string; payload: Record<string, unknown> }>,
  evidenceItemsByField:
    | Record<string, { payload?: Record<string, unknown> | null }>
    | undefined,
): EvidenceItemWithStrength[] {
  const contentMap = new Map<string, Record<string, unknown>>();
  for (const ei of evidenceItems) {
    contentMap.set(ei.type, ei.payload);
  }

  // Post-retirement: without the argument map's per-counterclaim
  // breakdown, derive a coarse per-row pill purely from checklist
  // status + priority. Headline strength is unaffected (it comes from
  // the canonical-signal path via `calculateCaseStrength`); only the
  // per-row pill granularity in the Evidence tab drops.
  return checklist.map((item): EvidenceItemWithStrength => {
    const strength: EvidenceItemWithStrength["strength"] =
      item.status === "available" || item.status === "waived" ? "moderate" : "none";
    const impact: EvidenceItemWithStrength["impact"] =
      item.priority === "critical"
        ? "critical"
        : item.priority === "recommended"
          ? "significant"
          : item.priority === "optional"
            ? "minor"
            : "negligible";

    return {
      ...item,
      strength,
      impact,
      content: contentMap.get(item.field) ?? null,
      payload: evidenceItemsByField?.[item.field]?.payload ?? null,
    };
  });
}

function deriveMissingItems(
  checklist: ChecklistItemV2[],
  translators: {
    whyText: (field: string) => string;
    sourceCaption: (field: string) => string;
    fieldActionCta: (field: string) => string;
    fieldActionFormats: (field: string) => string;
    fieldActionSkip: (field: string) => string;
    impactFallback: string;
    sourceFallback: string;
    recCritical: string;
    recOptional: string;
  },
): MissingItemWithContext[] {
  return checklist
    .filter((c) => c.status === "missing")
    // Only merchant-actionable items appear as tasks. Delegate to the
    // single-sourced canMerchantUpload predicate so the Missing-or-weak
    // section, Overview "Add this evidence" CTA, and any future surface
    // share the same field gate. Catches system-derived fields like
    // fraud_risk_screening and billing_address_match even when their
    // DB-backed template row leaves collectionType null — those rows
    // cannot be uploaded and must not surface upload buttons.
    .filter((c) => canMerchantUpload(c))
    .map((c) => {
      const action = FIELD_ACTIONS[c.field] ?? DEFAULT_ACTION;
      return {
        field: c.field,
        label: c.label,
        priority: c.priority,
        impact: translators.whyText(c.field) || translators.impactFallback,
        source: translators.sourceCaption(c.field) || translators.sourceFallback,
        effort: EFFORT_MAP[c.field] ?? ("medium" as const),
        recommendation: c.priority === "critical" ? translators.recCritical : translators.recOptional,
        actionType: action.actionType,
        ctaLabel: translators.fieldActionCta(c.field),
        acceptedFormats: translators.fieldActionFormats(c.field),
        skipLabel: translators.fieldActionSkip(c.field),
      };
    });
}

function deriveCategories(
  items: EvidenceItemWithStrength[],
): Array<{ category: EvidenceCategory; items: EvidenceItemWithStrength[] }> {
  // Layout-only grouping. Per-row strength is rendered from the
  // canonical registry (`categoryFor` + `categoryBadge`) — group order
  // follows the static `EVIDENCE_CATEGORIES` array, not a dispute-reason
  // relevance heuristic. Plan v3 §P2.6 / P2.7.
  return EVIDENCE_CATEGORIES
    .map((cat) => ({
      category: cat,
      items: items.filter((i) => cat.fields.includes(i.field)),
    }))
    .filter((c) => c.items.length > 0);
}

/**
 * The scorer's "nothing to assess" result.
 *
 * NOT a verdict about a case. Rendered only while
 * `derived.needsRecalculation` is true, and present at all because the tabs
 * type against a non-null `CaseStrengthResult`. Kept as a frozen module
 * constant so the two places that need it cannot drift into two different
 * "empty" shapes — which is how "insufficient · 0%" once got rendered as if
 * the scorer had reached that conclusion.
 */
const EMPTY_CASE_STRENGTH: Readonly<CaseStrengthResult> = Object.freeze({
  overall: "insufficient",
  score: 0,
  coveragePercent: 0,
  strongCount: 0,
  moderateCount: 0,
  supportingCount: 0,
  supportedClaims: 0,
  totalClaims: 0,
  improvementHintI18n: null,
  strengthReasonI18n: { key: "disputes.strengthReason.general.insufficient" },
  heroVariant: "hard_to_win",
}) as Readonly<CaseStrengthResult>;

export function legacyDerived(
  data: WorkspaceData | null,
  clientState: Pick<WorkspaceClientState, "completedFields" | "justSubmitted">,
  tr: {
    tSource: ReturnType<typeof useTranslations>;
    tWhy: ReturnType<typeof useTranslations>;
    tFieldAction: ReturnType<typeof useTranslations>;
    tWorkspace: ReturnType<typeof useTranslations>;
    tRoot: ReturnType<typeof useTranslations>;
  },
): DerivedState {
  const { tSource, tWhy, tFieldAction, tWorkspace, tRoot } = tr;
  if (!data) {
    return {
      effectiveChecklist: [],
      categories: [],
      missingItems: [],
      submitOverrideGaps: [],
      readiness: "blocked" as SubmissionReadiness,
      blockerCount: 0,
      warningCount: 0,
      caseStrength: EMPTY_CASE_STRENGTH,
      strengthReasonText: asLocalized(""),
      improvementHintText: null,
      whyWins: { strengths: [], weaknesses: [], overall: "insufficient" },
      risk: { expectedOutcome: "insufficient", risks: [] },
      improvement: null,
      nextAction: { label: "Loading...", description: "", severity: "info" },
      recommendationText: asLocalized(""),
      recommendationHelperText: null,
      contributions: { strong: [], moderate: [] },
      isReadOnly: false,
      isBuilding: false,
      isFailed: false,
      failureCode: null,
      isRegenerating: false,
      // No response yet is not "this case scored insufficient". The zeroed
      // strength above exists only to satisfy the type; every surface must
      // branch on this flag first.
      needsRecalculation: true,
      // No response yet is the same merchant-facing state as no assessment:
      // nothing may be rendered as a verdict and nothing may be filed.
      assessment: resolveAssessmentGate({ needsRecalculation: true }),
      filing: null,
    };
  }

  const pack = data.pack;
  const checklist = pack?.checklistV2 ?? [];

  // Apply optimistic completedFields
  const effectiveChecklist = checklist.map((c): ChecklistItemV2 =>
    clientState.completedFields.has(c.field) && c.status === "missing"
      ? { ...c, status: "available" }
      : c,
  );

  const items = deriveEvidenceWithStrength(
    effectiveChecklist,
    pack?.evidenceItems ?? [],
    pack?.evidenceItemsByField,
  );

  const categories = deriveCategories(items);
  // Missing-key-safe lookups via the shared helper. The previous inline
  // guard compared the result to the SCOPED key, but next-intl returns
  // the FULL path (namespace included) on a miss, so the guard never
  // fired and raw keys like `disputes.whyText.refund_record` leaked
  // into the Missing-or-weak card (2026-07-15).
  const safeT = (t: ReturnType<typeof useTranslations>, key: string): string =>
    safeDynamicT(t, key);
  const safeTNested = (
    t: ReturnType<typeof useTranslations>,
    field: string,
    sub: string,
  ): string => safeDynamicT(t, `${field}.${sub}`);
  const missingItems = deriveMissingItems(effectiveChecklist, {
    whyText: (field) => safeT(tWhy, field),
    sourceCaption: (field) => safeT(tSource, field),
    fieldActionCta: (field) => safeTNested(tFieldAction, field, "ctaLabel") || safeTNested(tFieldAction, "default", "ctaLabel"),
    fieldActionFormats: (field) => safeTNested(tFieldAction, field, "acceptedFormats") || safeTNested(tFieldAction, "default", "acceptedFormats"),
    fieldActionSkip: (field) => safeTNested(tFieldAction, field, "skipLabel") || safeTNested(tFieldAction, "default", "skipLabel"),
    impactFallback: safeT(tWorkspace, "impactFallback") || "Strengthens your dispute response",
    sourceFallback: safeT(tWorkspace, "sourceFallback") || "Upload or provide manually",
    recCritical: safeT(tWorkspace, "recCritical") || "Would strengthen your case",
    recOptional: safeT(tWorkspace, "recOptional") || "Recommended if available",
  });

  // Lifecycle only. A pack is "saved" when its status reflects a
  // successful save OR it carries a saved_to_shopify_at timestamp — the
  // timestamp is authoritative, because status can be overwritten on a
  // rebuild while the save really did happen and the merchant must not
  // then be told "Not submitted".
  //
  // READINESS ITSELF IS NO LONGER RECONSTRUCTED HERE. The three-way
  // blocked / ready_with_warnings / ready branch lived in this file AND in
  // `deriveCompletenessMetrics`, so a change to the rule had to be made
  // twice or the page would disagree with the gate that filed the
  // evidence. It is now derived once, server-side, by
  // `buildWorkspaceAssessment`.
  const isSaved =
    pack?.status === "saved_to_shopify" ||
    pack?.status === "saved_to_shopify_unverified" ||
    pack?.status === "saved_to_shopify_verified" ||
    !!pack?.savedToShopifyAt;

  /* ── The server assessment ──────────────────────────────────────
   *
   * Absent means the response predates the server change (or the route
   * could not derive one). That is `needsRecalculation` — a state the UI
   * renders as "recalculating", never as a number. Filling in a plausible
   * default here would recreate the browser derivation with worse inputs.
   */
  const serverAssessment: WorkspaceAssessmentPayload | null =
    data.workspaceAssessment ?? null;
  const needsRecalculation =
    serverAssessment === null || serverAssessment.assessment.needsRecalculation;

  const readiness: SubmissionReadiness = serverAssessment?.readiness ?? "blocked";
  const blockerCount = serverAssessment?.blockerCount ?? 0;
  const warningCount = serverAssessment?.warningCount ?? 0;
  const submitOverrideGaps = serverAssessment?.submitOverrideGaps ?? [];

  /* ── Strength: rendered, never computed ──────────────────────────
   *
   * The gate set this hook used to assemble stated three of five gates as
   * `not_shipped_to_client` — an honest record that the browser could not
   * see them, and a guarantee that its answer would differ from the
   * server's whenever any of the three fired. Shipping the derived result
   * instead of the inputs is the only fix that makes the two agree by
   * construction.
   *
   * `EMPTY_CASE_STRENGTH` is the scorer's own "nothing to assess" value,
   * used ONLY while `needsRecalculation` is true. Consumers must branch on
   * that flag rather than treat `insufficient` as a verdict.
   */
  const caseStrength: CaseStrengthResult =
    serverAssessment?.caseStrength ?? EMPTY_CASE_STRENGTH;
  // Resolve the strength tokens into branded `Localized` strings at the
  // hook boundary. UI consumers receive already-translated text through
  // `strengthReasonText` / `improvementHintText`; the raw tokens stay on
  // `caseStrength.*I18n` for any consumer that needs them.
  const strengthReasonText: Localized = resolveToken(tRoot, caseStrength.strengthReasonI18n);
  const improvementHintText: Localized | null =
    caseStrength.improvementHintI18n && !hintAsksForUnsuppliableSignal(caseStrength.improvementHintI18n)
    ? resolveToken(tRoot, caseStrength.improvementHintI18n)
    : null;
  // "What supports your case" and the improvement hint were BOTH computed
  // here from `computeContributions` / `calculateImprovement`, and the
  // route computed its own copy for the line-item resolver on the same
  // request. One derivation now, server-side.
  const contributions = serverAssessment?.contributions ?? { strong: [], moderate: [] };
  const improvement = serverAssessment?.improvement ?? null;
  // These two take the BAND as an input and return copy; they derive no
  // score of their own, so they stay client-side. The band they are given
  // is the server's.
  const whyWins = generateWhyWins(effectiveChecklist, caseStrength.overall);
  const risk = generateRiskExplanation(effectiveChecklist, caseStrength.overall);

  const nextAction = computeNextAction({
    packExists: !!pack,
    packStatus: pack?.status ?? null,
    readiness,
    missingItems,
    savedToShopifyAt: pack?.savedToShopifyAt ?? null,
  });

  // Recommendation copy — produced by the shared backend module
  // `lib/argument/recommendation.ts`. Plan v3 §3.A.6: the UI must
  // not synthesise these strings inline. The lib emits token-only
  // output (`textI18n`, `helperI18n`); we resolve at the hook
  // boundary so the UI receives branded `Localized` strings.
  const isReadOnly = (isSaved ?? false) || clientState.justSubmitted;
  const recOutput = generateRecommendation({
    submitted: isReadOnly,
    strength: caseStrength.overall,
    topMissing: missingItems[0] ?? null,
    submittedAt: pack?.savedToShopifyAt ?? null,
  });
  const recommendationText: Localized = resolveToken(tRoot, recOutput.textI18n);
  const recommendationHelperText: Localized | null = recOutput.helperI18n
    ? resolveToken(tRoot, recOutput.helperI18n)
    : null;

  return {
    effectiveChecklist: items,
    categories,
    missingItems,
    submitOverrideGaps,
    readiness,
    blockerCount,
    warningCount,
    caseStrength,
    strengthReasonText,
    improvementHintText,
    whyWins,
    risk,
    improvement,
    nextAction,
    recommendationText,
    recommendationHelperText,
    contributions,
    needsRecalculation,
    assessment: resolveAssessmentGate({
      needsRecalculation,
      recalculationReason:
        serverAssessment?.assessment.recalculationReason ?? null,
    }),
    filing: serverAssessment?.filing ?? null,
    isReadOnly,
    isBuilding: pack?.status === "queued" || pack?.status === "building",
    isFailed: pack?.status === "failed",
    failureCode: pack?.failureCode ?? null,
    // Resubmission Window: a regenerate is in flight AND the pack
    // already has a prior Shopify save. Used by EvidenceTab to swap
    // the generic "Building" banner for the regenerate-aware
    // "Regenerating defence package — current saved package remains"
    // copy. `rebuildPending` covers the gap between the merchant's
    // request and the worker picking it up (status still
    // saved_to_shopify_verified); status in {queued, building,
    // saving, saved_to_shopify_unverified} covers the in-flight
    // build/save cycle itself.
    isRegenerating: (() => {
      const hasPriorSave =
        pack?.status === "saved_to_shopify_verified" ||
        pack?.status === "saved_to_shopify_unverified" ||
        pack?.status === "saved_to_shopify" ||
        !!pack?.savedToShopifyAt;
      const isInFlight =
        pack?.status === "queued" ||
        pack?.status === "building" ||
        pack?.status === "saving" ||
        pack?.status === "saved_to_shopify_unverified" ||
        !!pack?.rebuildPending;
      return hasPriorSave && isInFlight;
    })(),
  };
}
