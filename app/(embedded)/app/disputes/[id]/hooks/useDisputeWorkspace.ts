"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  WorkspaceData,
  ChecklistItemV2,
  SubmissionReadiness,
  WaiveReason,
  EvidenceItemWithStrength,
  EvidenceCategory,
  MissingItemWithContext,
  NextAction,
  CaseStrengthResult,
  WhyWinsResult,
  RiskResult,
  ImprovementSignal,
} from "../workspace-components/types";
import { EVIDENCE_CATEGORIES } from "../workspace-components/types";
import { computeNextAction } from "@/lib/argument/nextAction";
/* ── CP-A: the browser has no scorer ──────────────────────────────────
 *
 * This hook used to import `calculateCaseStrength`, `calculateImprovement`,
 * `computeContributions` and the gate builders, assemble its own
 * `CaseGateAssessment`, and score the case client-side — while the workspace
 * route scored the SAME case server-side from a different gate set on the
 * same request. On a fraud dispute with a cardholder-name mismatch the two
 * disagreed on one screen: the browser rendered Strong, the server had capped
 * Moderate (2026-08-05 audit, `p4/legacy-removal-inventory.md`).
 *
 * All of it now arrives pre-derived on `data.workspaceAssessment`, built by
 * `buildWorkspaceAssessment` in `lib/disputes/workspaceAssessment.ts`. Those
 * imports are deliberately absent, and their absence is enforced by
 * `tests/unit/clientAssessmentRecomputation.test.ts` — a derivation that
 * exists while the old caller survives is exactly the failure this epic was
 * written to correct.
 *
 * The type-only import below is safe and load-bearing: it is erased at
 * compile time, so the scorer never enters the client bundle. */
import type { WorkspaceAssessmentPayload } from "@/lib/disputes/workspaceAssessmentTypes";
import {
  resolveAssessmentGate,
  type AssessmentGate,
} from "@/lib/disputes/assessmentPresence";
import { generateWhyWins } from "@/lib/argument/whyThisCaseWins";
import { generateRiskExplanation } from "@/lib/argument/riskExplanation";
import { generateRecommendation } from "@/lib/argument/recommendation";
import { asLocalized, type Localized } from "@/lib/i18n/localized";
import { resolveToken } from "@/lib/i18n/resolveToken";
import { safeDynamicT } from "@/lib/i18n/safeDynamicT";

/* ── WHY text for evidence items ── */

// WHY_TEXT was deleted in Phase 5 \u2014 see comment block on EFFORT_MAP.

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

/* ── Per-field action metadata for merchant-addable items ──
 *
 * Relocated to lib/disputes/presentation/concreteContribution.ts so the
 * server-side presentation resolver shares the exact same predicate and
 * field sets (plan §12V item 4). Re-exported below for existing
 * consumers of this hook module. */

import {
  FIELD_ACTIONS,
  DEFAULT_FIELD_ACTION as DEFAULT_ACTION,
  MERCHANT_ACTIONABLE_FIELDS,
  SYSTEM_DERIVED_FIELDS,
  canMerchantUpload,
} from "@/lib/disputes/presentation/concreteContribution";

export { MERCHANT_ACTIONABLE_FIELDS, SYSTEM_DERIVED_FIELDS, canMerchantUpload };

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

/* ── Hook ── */

/** Shown after a successful manual upload so the row leaving "Missing"
 *  is not mistaken for a silent failure. */
export interface UploadSuccessNotice {
  field: string;
  fileName: string;
  evidenceTitle: string;
}

/** Resubmission Window: set by the upload route response when the pack
 *  has been saved to Shopify but the window is still open. Opens the
 *  RegeneratePromptModal. */
export interface PendingRegeneratePrompt {
  packId: string;
  evidenceItemId: string;
}

export interface WorkspaceClientState {
  activeTab: 0 | 1 | 2;
  loading: boolean;
  uploadingField: string | null;
  failedFields: Map<string, string>;
  completedFields: Set<string>;
  uploadSuccessNotice: UploadSuccessNotice | null;
  focusField: string | null;
  /** A workspace SECTION to scroll-to + spotlight (in-page equivalent of
   *  the `?section=` deep-link). Bumped with a nonce so re-triggering the
   *  same section (e.g. the Overview "Review communication" CTA) re-fires
   *  the pulse even if it was already applied once. */
  focusSection: { key: string; nonce: number } | null;
  expandedCategories: Set<string>;
  excludedFields: Set<string>;
  showOverrideModal: boolean;
  saving: boolean;
  rendering: boolean;
  /** In-flight flag for generatePack. Used to disable retry buttons
   *  and prevent double-click duplicate pack creation after a failure. */
  retrying: boolean;
  justSubmitted: boolean;
  /** Resubmission Window: set when an upload returns promptRebuild=true.
   *  Drives RegeneratePromptModal visibility. */
  pendingRegeneratePrompt: PendingRegeneratePrompt | null;
  /** Resubmission Window: in-flight flag for the regenerate POST. */
  regenerateSubmitting: boolean;
  /** Resubmission Window: timestamp of the most recently-dismissed
   *  rebuild outcome banner (matches `pack.lastRebuildAt`). Used to hide
   *  the outcome banner after the merchant acknowledges it, so the
   *  workspace doesn't badger them every fetch cycle. Reset when a new
   *  outcome with a later timestamp arrives. Session-only — refreshing
   *  the page brings the banner back, which is the correct behaviour
   *  for the "blocked, still not resaved" case. */
  dismissedRebuildOutcomeAt: string | null;
  /** Resubmission Window: error from non-window regenerate failures.
   *  Rendered inside the modal. Cleared when the modal closes. The
   *  WINDOW_CLOSED case closes the modal silently and lets the
   *  persistent banner take over, so this field stays null for that
   *  branch. */
  regenerateError: string | null;
}

export interface DerivedState {
  effectiveChecklist: EvidenceItemWithStrength[];
  categories: Array<{ category: EvidenceCategory; items: EvidenceItemWithStrength[] }>;
  missingItems: MissingItemWithContext[];
  /**
   * Checklist rows that trigger "submit with override" — critical priority,
   * not a blocker, still missing. Includes auto/conditional rows (e.g. IP)
   * that are omitted from `missingItems`.
   */
  submitOverrideGaps: Array<{ field: string; label: string }>;
  readiness: SubmissionReadiness;
  blockerCount: number;
  warningCount: number;
  caseStrength: CaseStrengthResult;
  /** Resolved `Localized` text for the "why this strength" sentence.
   *  Produced by `resolveToken(rootTranslator, caseStrength.strengthReasonI18n)`
   *  at the hook boundary. UI consumes this directly — never reads the
   *  raw token. */
  strengthReasonText: Localized;
  /** Resolved `Localized` text for the improvement hint. null when the
   *  case is already strong, no actionable missing field exists, or
   *  the case is covered / fatal-loss. */
  improvementHintText: Localized | null;
  whyWins: WhyWinsResult;
  risk: RiskResult;
  improvement: ImprovementSignal | null;
  nextAction: NextAction;
  /** Backend-derived merchant-facing recommendation. Plan v3 §3.A.6.
   *  OverviewTab renders these strings verbatim — never reconstructs
   *  the recommendation logic in JSX. */
  recommendationText: Localized;
  recommendationHelperText: Localized | null;
  /** "What supports your case" rows. Plan v3 §P2.6: one row per
   *  canonical signalId with effective category `strong` or
   *  `moderate`. The Overview UI iterates this directly — no UI
   *  inference, no text-based dedupe. */
  contributions: WorkspaceAssessmentPayload["contributions"];
  isReadOnly: boolean;
  isBuilding: boolean;
  /** True when the build itself failed (system error), distinct from
   *  evidence gaps. UIs should render a system-error banner and skip
   *  the normal evidence-analysis surfaces. */
  isFailed: boolean;
  failureCode: string | null;
  /** Resubmission Window: true when a regenerate is currently running
   *  AND the pack already has a prior Shopify save. Drives the
   *  "Regenerating defence package" banner. Distinct from `isBuilding`
   *  (which fires on first-time builds too). */
  isRegenerating: boolean;
  /**
   * CP-A — the server could not give a current assessment for this case.
   *
   * A FIRST-CLASS STATE, not a null. When true, `caseStrength`, `readiness`
   * and the counts carry the scorer's own "nothing to assess" values and a
   * surface MUST branch on this before rendering any of them. A stale number
   * shown as current is worse than no number: the merchant acts on it.
   */
  needsRecalculation: boolean;
  /**
   * THE gate every surface reads before rendering a verdict, a
   * recommendation, or a filing action.
   *
   * `needsRecalculation` above is the raw flag and stays for the one consumer
   * that genuinely wants a boolean; this carries the three permissions and the
   * merchant copy, so five surfaces cannot each write the condition slightly
   * differently. See `lib/disputes/assessmentPresence.ts`.
   */
  assessment: AssessmentGate;
  /**
   * `deadline_only` vs `withheld_no_safe_argument`, as tokens (plan §4.1).
   * Null until the server ships it.
   */
  filing: WorkspaceAssessmentPayload["filing"] | null;
}

export function useDisputeWorkspace(disputeId: string) {
  const locale = useLocale();
  const tSource = useTranslations("disputes.sourceCaption");
  const tWhy = useTranslations("disputes.whyText");
  const tFieldAction = useTranslations("disputes.fieldAction");
  const tWorkspace = useTranslations("disputes.workspaceHook");
  // Root translator used by `resolveToken` — tokens encode absolute
  // key paths, so the translator must NOT be scoped.
  const tRoot = useTranslations();

  const [data, setData] = useState<WorkspaceData | null>(null);
  const [clientState, setClientState] = useState<WorkspaceClientState>({
    activeTab: 0,
    loading: true,
    uploadingField: null,
    failedFields: new Map(),
    completedFields: new Set(),
    uploadSuccessNotice: null,
    focusField: null,
    focusSection: null,
    expandedCategories: new Set(),
    excludedFields: new Set(),
    showOverrideModal: false,
    saving: false,
    rendering: false,
    retrying: false,
    justSubmitted: false,
    pendingRegeneratePrompt: null,
    regenerateSubmitting: false,
    regenerateError: null,
    dismissedRebuildOutcomeAt: null,
  });

  const pollRef = useRef<ReturnType<typeof setInterval>>();

  /* ── Fetch ── */

  const fetchAll = useCallback(async () => {
    const res = await fetch(
      `/api/disputes/${disputeId}/workspace?locale=${encodeURIComponent(locale)}`,
    );
    if (!res.ok) {
      setClientState((s) => ({ ...s, loading: false }));
      return;
    }
    const json = await res.json();
    setData(json);
    setClientState((s) => ({
      ...s,
      loading: false,
      completedFields: new Set(),
    }));

    // Post-retirement: no more auto-POST to /api/disputes/[id]/argument.
    // The defence-package builder is the only narrative generator now,
    // and it runs from buildDefencePackageJob (enqueued via the pack
    // build path, not from the workspace hook).

    // Polling cadence:
    //   - pack queued/building → 4 s (active build, want fast updates)
    //   - pack ready but defence-package facts haven't landed yet → keep polling
    //     at 4 s. The defence-package job runs ~30–90 s after build_pack
    //     finishes (LLM call); without this branch the hook would freeze the
    //     UI on the fact-less first response and never pick up the facts.
    //     Heuristic: presentationStatus === "DRAFT" + zero positive facts
    //     means the LLM step hasn't materialised yet. Once any positive
    //     fact lands, OR the pack is saved/submitted, we relax to background.
    //   - otherwise → stop the active interval, but the visibilitychange
    //     listener below re-fetches whenever the merchant returns to the tab
    //     so a long-running build that finishes while the tab is hidden
    //     still updates immediately on focus.
    const positiveFactCount =
      json.submissionSummary?.counts?.usedAsPositiveBankArgument ?? 0;
    const stillWaitingForFacts =
      json.pack?.status === "ready" &&
      json.presentationStatus === "DRAFT" &&
      positiveFactCount === 0;
    const isActive =
      json.pack?.status === "queued" ||
      json.pack?.status === "building" ||
      stillWaitingForFacts;
    if (!isActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  }, [disputeId, locale]);

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, 4000);
    // Re-fetch on tab/iframe focus. Shopify Admin keeps the embedded
    // iframe alive across nav and even some refresh patterns, so a
    // merchant returning to a dispute can otherwise stare at state
    // that's hours stale. Listening to both `focus` and
    // `visibilitychange` covers desktop tabs (focus) and mobile /
    // iframe-switched contexts (visibilitychange) — Safari fires only
    // one of the two depending on how the user re-enters.
    const onFocus = () => {
      void fetchAll();
    };
    const onVisible = () => {
      if (!document.hidden) void fetchAll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchAll]);

  useEffect(() => {
    if (!clientState.uploadSuccessNotice) return;
    const t = window.setTimeout(() => {
      setClientState((s) => ({ ...s, uploadSuccessNotice: null }));
    }, 12000);
    return () => window.clearTimeout(t);
  }, [clientState.uploadSuccessNotice]);

  /* ── Actions ── */

  const dismissUploadSuccessNotice = useCallback(() => {
    setClientState((s) => ({ ...s, uploadSuccessNotice: null }));
  }, []);

  const generatePack = useCallback(
    async (templateId?: string) => {
      // Guard against double-clicks / concurrent retries. Without this,
      // a merchant who clicks "Retry build" twice can queue two packs.
      if (clientState.retrying) return undefined;
      setClientState((s) => ({ ...s, retrying: true }));
      try {
        const body = templateId ? { template_id: templateId } : {};
        const res = await fetch(`/api/disputes/${disputeId}/packs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          pollRef.current = setInterval(fetchAll, 3000);
          await fetchAll();
        }
        return res;
      } finally {
        setClientState((s) => ({ ...s, retrying: false }));
      }
    },
    [disputeId, fetchAll, clientState.retrying],
  );

  const uploadEvidence = useCallback(
    async (field: string, files: File[]) => {
      if (!data?.pack || files.length === 0) return;
      // Resubmission Window: client-side gate when Shopify has already
      // forwarded evidence to the bank. The server enforces this too
      // (returns 409 WINDOW_CLOSED before any persistence), but the UI
      // shouldn't even let the merchant initiate the upload.
      if (data.dispute?.submissionState === "submitted_confirmed") {
        return;
      }
      setClientState((s) => ({
        ...s,
        uploadingField: field,
        uploadSuccessNotice: null,
        failedFields: new Map([...s.failedFields].filter(([k]) => k !== field)),
      }));
      let serverMessage: string | null = null;
      // Track the last upload's response so we can open the regenerate
      // modal once after the for-loop completes (one prompt per batch,
      // not per file).
      let lastPromptRebuild: PendingRegeneratePrompt | null = null;
      try {
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          form.append("label", file.name);
          form.append("field", field);
          const res = await fetch(`/api/packs/${data.pack.id}/upload`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as
              | { error?: string; message?: string }
              | null;
            // 409 WINDOW_CLOSED: server rejected before persistence.
            // Surface the dedicated message; the persistent banner
            // takes over after fetchAll() refreshes submission_state.
            if (res.status === 409 && body?.error === "WINDOW_CLOSED") {
              serverMessage =
                body.message ??
                "Shopify has already forwarded this dispute evidence to the bank, so new files can no longer be added.";
              throw new Error(serverMessage);
            }
            serverMessage =
              typeof body?.error === "string" && body.error.trim().length > 0
                ? body.error
                : null;
            throw new Error(serverMessage ?? "Upload failed");
          }
          const okBody = (await res.json().catch(() => null)) as
            | {
                itemId?: string;
                promptRebuild?: boolean;
                packId?: string;
                evidenceItemId?: string;
              }
            | null;
          if (
            okBody?.promptRebuild === true &&
            typeof okBody.packId === "string" &&
            typeof okBody.evidenceItemId === "string"
          ) {
            lastPromptRebuild = {
              packId: okBody.packId,
              evidenceItemId: okBody.evidenceItemId,
            };
          }
        }
        const checklistRow = data.pack.checklistV2?.find((c) => c.field === field);
        // `||` not `??`: rows APPENDED by reconcileChecklistWithCollectedFields
        // carry `label: ""` by design (lib/** may not emit English), and `??`
        // only falls back on null/undefined — an empty string would sail
        // through and render a blank evidence title in the upload toast.
        const evidenceTitle =
          checklistRow?.label || field.replace(/_/g, " ");
        const fileSummary =
          files.length === 1
            ? files[0].name
            : files.map((f) => f.name).join(", ");
        setClientState((s) => ({
          ...s,
          completedFields: new Set(s.completedFields).add(field),
          uploadSuccessNotice: { field, fileName: fileSummary, evidenceTitle },
          // If the upload landed in the open window, open the
          // regenerate modal. The merchant chooses whether to kick
          // off the full pipeline rebuild.
          pendingRegeneratePrompt: lastPromptRebuild ?? s.pendingRegeneratePrompt,
        }));
      } catch {
        setClientState((s) => ({
          ...s,
          failedFields: new Map(s.failedFields).set(
            field,
            serverMessage ?? "Upload failed \u2014 try again",
          ),
        }));
      } finally {
        setClientState((s) => ({ ...s, uploadingField: null }));
        fetchAll();
      }
    },
    [data?.pack, data?.dispute?.submissionState, fetchAll],
  );

  const regeneratePack = useCallback(async () => {
    if (!data?.pack || !clientState.pendingRegeneratePrompt) return;
    setClientState((s) => ({
      ...s,
      regenerateSubmitting: true,
      regenerateError: null,
    }));
    try {
      const res = await fetch(`/api/packs/${data.pack.id}/regenerate`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        if (body?.error === "WINDOW_CLOSED") {
          // Window closed between modal-open and confirm. Close the
          // modal silently \u2014 the persistent window-closed banner takes
          // over once fetchAll() refreshes submissionState. Do NOT
          // surface regenerateError; the modal is closing.
          setClientState((s) => ({
            ...s,
            pendingRegeneratePrompt: null,
            regenerateError: null,
            regenerateSubmitting: false,
          }));
          fetchAll();
          return;
        }
        // Other errors \u2014 keep modal open and render the message inside.
        setClientState((s) => ({
          ...s,
          regenerateError: body?.message ?? "Regenerate failed",
        }));
        return;
      }
      setClientState((s) => ({
        ...s,
        pendingRegeneratePrompt: null,
        regenerateError: null,
      }));
      fetchAll();
    } finally {
      setClientState((s) => ({ ...s, regenerateSubmitting: false }));
    }
  }, [data?.pack, clientState.pendingRegeneratePrompt, fetchAll]);

  const dismissRegeneratePrompt = useCallback(() => {
    setClientState((s) => ({
      ...s,
      pendingRegeneratePrompt: null,
      regenerateError: null,
    }));
  }, []);

  const dismissRebuildOutcome = useCallback((outcomeAt: string | null) => {
    setClientState((s) => ({
      ...s,
      dismissedRebuildOutcomeAt: outcomeAt,
    }));
  }, []);

  const waiveItem = useCallback(
    async (field: string, reason: WaiveReason) => {
      if (!data?.pack) return;
      await fetch(`/api/packs/${data.pack.id}/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, reason }),
      });
      fetchAll();
    },
    [data?.pack, fetchAll],
  );

  const unwaiveItem = useCallback(
    async (field: string) => {
      if (!data?.pack) return;
      await fetch(`/api/packs/${data.pack.id}/waive?field=${encodeURIComponent(field)}`, {
        method: "DELETE",
      });
      fetchAll();
    },
    [data?.pack, fetchAll],
  );

  /** Submit a cardholder-acknowledgement text + confirmation checkbox.
   *  The server validates both inputs, writes a manual_text evidence_item
   *  with `customerConfirmsOrder=true` (which the canonical categorizer
   *  treats as the decisive signal that elevates customer_communication
   *  to strong), patches checklist_v2, and enqueues a rebuild.
   *
   *  Returns the API response so the caller can branch on
   *  `promptRebuild` and open the existing RegeneratePromptModal. */
  const submitCardholderAcknowledgement = useCallback(
    async (text: string): Promise<{
      ok: boolean;
      promptRebuild?: boolean;
      evidenceItemId?: string;
      error?: string;
      code?: string;
    }> => {
      if (!data?.pack) return { ok: false, error: "No pack" };
      const res = await fetch(
        `/api/packs/${data.pack.id}/cardholder-acknowledgement`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, confirmedByMerchant: true }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { evidenceItemId?: string; promptRebuild?: boolean; error?: string; code?: string }
        | null;
      // Re-fetch regardless so the new evidence_items row shows up in
      // the workspace UI immediately (independent of the rebuild job
      // landing later).
      fetchAll();
      if (!res.ok) {
        return {
          ok: false,
          error: body?.error ?? `Server error (${res.status})`,
          code: body?.code,
        };
      }
      // Surface the regenerate prompt for window-open disputes — same
      // modal the upload + waive flows use.
      if (body?.promptRebuild && body?.evidenceItemId) {
        setClientState((s) => ({
          ...s,
          pendingRegeneratePrompt: {
            packId: data.pack!.id,
            evidenceItemId: body.evidenceItemId!,
          },
        }));
      }
      return {
        ok: true,
        promptRebuild: body?.promptRebuild,
        evidenceItemId: body?.evidenceItemId,
      };
    },
    [data?.pack, fetchAll],
  );

  /** Toggle a merchant inclusion override for a single evidence field.
   *
   *  Value semantics:
   *    - "force_include": include in the defence package (but ONLY as
   *      `bank_argument` when the payload independently qualifies; the
   *      derivation refuses to elevate strength on its own).
   *    - "force_exclude": remove from the defence package entirely.
   *    - null: clear an existing override and restore the natural state.
   *
   *  Phase 1: the API rejects `force_include` for internal-only fields
   *  (returns 409 OVERRIDE_NEEDS_CONFIRMATION). Phase 2 (2026-05-20):
   *  callers can pass `acknowledgedRisk: true` to bypass the 409 after
   *  showing the merchant the warning modal. The API records a
   *  distinct `evidence_inclusion_overridden_with_warning` audit event
   *  in that case. */
  const toggleInclusionOverride = useCallback(
    async (
      field: string,
      value: "force_include" | "force_exclude" | null,
      options?: { acknowledgedRisk?: boolean },
    ) => {
      if (!data?.pack) return;
      const res = await fetch(
        `/api/packs/${data.pack.id}/inclusion-override`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            field,
            value,
            ...(options?.acknowledgedRisk
              ? { acknowledgedRisk: true }
              : {}),
          }),
        },
      );
      // Refetch even on failure so the UI reflects the unchanged
      // canonical state. The component is responsible for surfacing
      // 409 OVERRIDE_NEEDS_CONFIRMATION; this hook doesn't show toasts.
      void res;
      fetchAll();
    },
    [data?.pack, fetchAll],
  );

  // saveRebuttal + regenerateArgument removed 2026-05-16 — the legacy
  // text rebuttal engine is retired. The defence-package builder owns
  // bank-facing narrative now; regenerate happens via the
  // CompleteDefencePackageCard's own Regenerate button which calls
  // /api/defence-packages/[id]/regenerate.

  /** Flip `justSubmitted` from a child that owns its own submit POST
   *  (e.g. CompleteDefencePackageCard's defence-package submit, which
   *  hits /api/defence-packages/:id/submit instead of the pack-level
   *  save-to-shopify route). Pairs with an immediate `fetchAll` so the
   *  4s poll picks up `pack.savedToShopifyAt` once the job runs. Without
   *  this, the card would re-render against stale workspace data and the
   *  merchant would see the "Submit to Shopify" button reappear as if
   *  the click did nothing. */
  const markJustSubmitted = useCallback(() => {
    setClientState((s) => ({ ...s, justSubmitted: true }));
  }, []);

  const submitToShopify = useCallback(
    async (overrideReason?: string, overrideNote?: string) => {
      if (!data?.pack) return;
      setClientState((s) => ({ ...s, saving: true, showOverrideModal: false }));
      const body: Record<string, unknown> = { confirmWarnings: true };
      if (overrideReason) body.overrideReason = overrideReason;
      if (overrideNote) body.overrideNote = overrideNote;
      const excluded = Array.from(clientState.excludedFields);
      if (excluded.length > 0) body.excludedFields = excluded;

      const res = await fetch(`/api/packs/${data.pack.id}/save-to-shopify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // Mark as submitted immediately — don't wait for job runner
        setClientState((s) => ({ ...s, saving: false, justSubmitted: true }));
      } else {
        setClientState((s) => ({ ...s, saving: false }));
      }
    },
    [data?.pack, clientState.excludedFields],
  );

  const exportPdf = useCallback(async () => {
    if (!data?.pack) return;
    setClientState((s) => ({ ...s, rendering: true }));
    await fetch(`/api/packs/${data.pack.id}/render-pdf`, { method: "POST" });
    pollRef.current = setInterval(fetchAll, 3000);
    await fetchAll();
    setClientState((s) => ({ ...s, rendering: false }));
  }, [data?.pack, fetchAll]);

  const downloadPdf = useCallback(() => {
    if (!data?.pack) return;
    // The route now proxies the PDF bytes directly, so we can open the
    // route URL itself in a new tab. The Supabase signed URL never
    // crosses the wire to the browser — no token leakage in the address
    // bar or referrer header.
    window.open(`/api/packs/${data.pack.id}/download`, "_blank");
  }, [data?.pack]);

  const syncDispute = useCallback(async () => {
    await fetch(`/api/disputes/${disputeId}/sync`, { method: "POST" });
    await fetchAll();
  }, [disputeId, fetchAll]);

  /** Merchant review-lifecycle decision on a parked/weak dispute
   *  (2026-07-23): "hold" (watch until deadline), "approve" (submit on
   *  the deadline), "concede" (do not defend), or "clear" (undo). POSTs
   *  to /review then refetches so the action row + chip reflect the new
   *  reviewState. */
  const [reviewSaving, setReviewSaving] = useState(false);
  const setReviewDecision = useCallback(
    async (action: "hold" | "approve" | "concede" | "clear") => {
      if (reviewSaving) return;
      setReviewSaving(true);
      try {
        await fetch(`/api/disputes/${disputeId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        await fetchAll();
      } finally {
        setReviewSaving(false);
      }
    },
    [disputeId, fetchAll, reviewSaving],
  );

  const setActiveTab = useCallback((tab: 0 | 1 | 2) => {
    setClientState((s) => ({ ...s, activeTab: tab }));
  }, []);

  // Switch to the Evidence tab AND signal the Gorgias review card to
  // scroll-into-view + pulse its spotlight — the in-page equivalent of the
  // `?section=gorgias-comms` deep-link, used by the Overview attention
  // card's "Review communication" CTA. The nonce makes repeat clicks
  // re-fire the pulse.
  const focusGorgiasReview = useCallback(() => {
    setClientState((s) => ({
      ...s,
      activeTab: 1,
      focusSection: { key: "gorgias-comms", nonce: (s.focusSection?.nonce ?? 0) + 1 },
    }));
  }, []);

  const clearFocusSection = useCallback(() => {
    setClientState((s) => ({ ...s, focusSection: null }));
  }, []);

  const navigateToEvidence = useCallback((field: string) => {
    // Find which category contains this field
    const cat = EVIDENCE_CATEGORIES.find((c) => c.fields.includes(field));
    setClientState((s) => ({
      ...s,
      activeTab: 1,
      focusField: field,
      expandedCategories: cat
        ? new Set(s.expandedCategories).add(cat.key)
        : s.expandedCategories,
    }));
  }, []);

  const toggleSubmissionField = useCallback((fieldName: string) => {
    setClientState((s) => {
      const next = new Set(s.excludedFields);
      if (next.has(fieldName)) next.delete(fieldName);
      else next.add(fieldName);
      return { ...s, excludedFields: next };
    });
  }, []);

  const clearFocus = useCallback(() => {
    setClientState((s) => ({ ...s, focusField: null }));
  }, []);

  /* ── Derived state ── */

  const derived: DerivedState = (() => {
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
    const improvementHintText: Localized | null = caseStrength.improvementHintI18n
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
  })();

  return {
    data,
    clientState,
    derived,
    actions: {
      fetchAll,
      generatePack,
      dismissUploadSuccessNotice,
      uploadEvidence,
      regeneratePack,
      dismissRegeneratePrompt,
      dismissRebuildOutcome,
      waiveItem,
      unwaiveItem,
      toggleInclusionOverride,
      submitCardholderAcknowledgement,
      submitToShopify,
      markJustSubmitted,
      exportPdf,
      downloadPdf,
      syncDispute,
      setReviewDecision,
      reviewSaving,
      setActiveTab,
      focusGorgiasReview,
      clearFocusSection,
      navigateToEvidence,
      toggleSubmissionField,
      clearFocus,
      setShowOverrideModal: (show: boolean) =>
        setClientState((s) => ({ ...s, showOverrideModal: show })),
    },
  };
}
