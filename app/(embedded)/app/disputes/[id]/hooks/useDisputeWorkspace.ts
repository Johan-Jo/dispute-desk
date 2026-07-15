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
import {
  calculateCaseStrength,
  calculateImprovement,
  computeContributions,
  type CaseStrengthContributions,
} from "@/lib/argument/caseStrength";
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
  billing_address_match: "low",
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

/* ── Per-field action metadata for merchant-addable items ── */

interface FieldAction {
  actionType: "upload" | "paste" | "note";
}

// i18n-allow-block: these are the English fallback values used only
// when `disputes.fieldAction.<field>.*` is missing from the active
// locale. The render path in `deriveMissingItems` calls the next-intl
// translator first and falls back to these strings as a defence-in-
// depth measure. Keep them in sync with `messages/en.json
// disputes.fieldAction.*` (the canonical source).
// Per-field action type only. CTA text comes from i18n.
const FIELD_ACTIONS: Record<string, FieldAction> = {
  supporting_documents: { actionType: "upload" },
  customer_communication: { actionType: "paste" },
  product_description: { actionType: "upload" },
  duplicate_explanation: { actionType: "paste" },
};

const DEFAULT_ACTION: FieldAction = { actionType: "upload" };

/* Set of evidence fields the merchant can directly act on (upload or
 * paste). Derived from `FIELD_ACTIONS` so the allowlist stays in sync
 * with the per-field CTA config. Other fields (`avs_cvv_match`,
 * `billing_address_match`, `ip_location_check`, etc.) are gateway/
 * system signals where a manual upload doesn't make semantic sense.
 *
 * Why this is the gate (and `collectionType !== "auto"` is not):
 * `customer_communication` is marked `collection_type=auto` in the
 * checklist generator because Shopify *attempts* to pull it from
 * order notes — but it only becomes Strong via
 * `payload.customerConfirmsOrder === true`, which requires the
 * merchant to provide a conversation. Auto-collection is a
 * best-effort fallback there; merchant upload is the actual path to
 * strength, and the UI must surface it. */
export const MERCHANT_ACTIONABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(FIELD_ACTIONS),
);

/** Fields that are UNAMBIGUOUSLY system-derived: the data comes from a
 *  source outside the merchant's control (payment gateway, carrier,
 *  Shopify's risk engine, IPinfo, etc.). The merchant cannot upload
 *  these by definition — surfacing Upload/Mark-not-applicable buttons
 *  for them is misleading.
 *
 *  This list is the inverse of MERCHANT_ACTIONABLE_FIELDS for the
 *  fields the canonical registry knows about. Kept as an explicit
 *  allowlist (not derived) so a future template/registry change that
 *  inadvertently nulls `collectionType` cannot accidentally promote
 *  a system signal back to a merchant task. Same set as
 *  SOURCE_OUTSIDE_MERCHANT_CONTROL in lib/argument/evidenceLineItem.ts.
 */
export const SYSTEM_DERIVED_FIELDS: ReadonlySet<string> = new Set([
  "avs_cvv_match",
  "billing_address_match",
  "tds_authentication",
  "fraud_risk_screening",
  "ip_location_check",
  "device_session_consistency",
  "shipping_tracking",
  "delivery_proof",
  "order_confirmation",
  "customer_account_info",
  "activity_log",
  "product_description",
]);

/** True when the merchant should see an upload affordance on a
 *  missing evidence row. Used by both the Overview tab "Add this
 *  evidence" CTA and the Evidence tab inventory + per-row Upload
 *  button so the policy is single-sourced.
 *
 *  Precedence:
 *   1. `MERCHANT_ACTIONABLE_FIELDS` allowlist → always allow upload
 *      (e.g. `customer_communication` overrides any collectionType
 *      because uploads are the actual path to strength).
 *   2. `SYSTEM_DERIVED_FIELDS` denylist → always refuse, regardless
 *      of `collectionType`. Catches the case where a DB-backed
 *      template row doesn't carry `collection_type` and the prior
 *      fallback (`collectionType !== "auto"`) was too permissive.
 *   3. Otherwise: only allow when `collectionType` is explicitly
 *      `manual` or `conditional_auto`. An absent `collectionType`
 *      defaults to "no upload" (strict) so off-registry/template
 *      rows can't accidentally surface upload buttons. */
export function canMerchantUpload(item: {
  field: string;
  collectionType?: string;
}): boolean {
  if (MERCHANT_ACTIONABLE_FIELDS.has(item.field)) return true;
  if (SYSTEM_DERIVED_FIELDS.has(item.field)) return false;
  return item.collectionType === "manual" || item.collectionType === "conditional_auto";
}

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
  contributions: CaseStrengthContributions;
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
        const evidenceTitle =
          checklistRow?.label ?? field.replace(/_/g, " ");
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

  const setActiveTab = useCallback((tab: 0 | 1 | 2) => {
    setClientState((s) => ({ ...s, activeTab: tab }));
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
        caseStrength: {
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
        },
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

    // Readiness. A pack is "saved" when its status reflects a successful
    // save OR it carries a saved_to_shopify_at timestamp. The timestamp is
    // the authoritative signal: status can be overwritten on a rebuild, but
    // the save really did happen and the merchant must not be told "Not
    // submitted" in that case.
    const isSaved =
      pack?.status === "saved_to_shopify" ||
      pack?.status === "saved_to_shopify_unverified" ||
      pack?.status === "saved_to_shopify_verified" ||
      !!pack?.savedToShopifyAt;
    let readiness: SubmissionReadiness;
    if (isSaved) {
      readiness = "submitted";
    } else {
      const missingBlockers = effectiveChecklist.filter((c) => c.blocking && c.status === "missing");
      const missingCritical = effectiveChecklist.filter((c) => c.priority === "critical" && !c.blocking && c.status === "missing");
      readiness = missingBlockers.length > 0 ? "blocked" : missingCritical.length > 0 ? "ready_with_warnings" : "ready";
    }

    const blockerCount = effectiveChecklist.filter((c) => c.blocking && c.status === "missing").length;
    const warningCount = effectiveChecklist.filter((c) => c.priority === "critical" && !c.blocking && c.status === "missing").length;
    const submitOverrideGaps = effectiveChecklist
      .filter((c) => c.priority === "critical" && !c.blocking && c.status === "missing")
      .map((c) => ({ field: c.field, label: c.label }));

    // Pass the workspace's evidenceItemsByField map so the canonical
    // categorizer can read payloads (delivery proofType, AVS/CVV codes,
    // IP location flags) instead of falling back to default categories.
    // Plan v3 §P2 step 4.
    const payloadSource = data.pack?.evidenceItemsByField
      ? { kind: "byField" as const, map: data.pack.evidenceItemsByField }
      : undefined;
    // Coverage Gate input (PRD §4). Read from the workspace pack's
    // coverage summary; null when the order is not on Shopify Protect.
    const coverageInput = data.pack?.coverage
      ? {
          state: data.pack.coverage.state,
          shopifyProtectStatus: data.pack.coverage.shopifyProtectStatus,
        }
      : undefined;
    const caseStrength = calculateCaseStrength(effectiveChecklist, data.dispute.reason, payloadSource, coverageInput);
    // Resolve the strength tokens into branded `Localized` strings at
    // the hook boundary. UI consumers receive already-translated text
    // through `strengthReasonText` / `improvementHintText`; the raw
    // tokens stay on `caseStrength.*I18n` for any consumer that needs
    // them (tests, server callers).
    const strengthReasonText: Localized = resolveToken(tRoot, caseStrength.strengthReasonI18n);
    const improvementHintText: Localized | null = caseStrength.improvementHintI18n
      ? resolveToken(tRoot, caseStrength.improvementHintI18n)
      : null;
    const contributions = computeContributions(effectiveChecklist, payloadSource);
    const whyWins = generateWhyWins(effectiveChecklist, caseStrength.overall);
    const risk = generateRiskExplanation(effectiveChecklist, caseStrength.overall);
    const improvement = calculateImprovement(effectiveChecklist, data.dispute.reason, payloadSource);

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
      setActiveTab,
      navigateToEvidence,
      toggleSubmissionField,
      clearFocus,
      setShowOverrideModal: (show: boolean) =>
        setClientState((s) => ({ ...s, showOverrideModal: show })),
    },
  };
}
