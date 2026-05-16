"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "next-intl";
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

/* ── WHY text for evidence items ── */

const WHY_TEXT: Record<string, string> = {
  order_confirmation: "Proves the transaction is legitimate \u2014 the foundation of every dispute response",
  shipping_tracking: "Shows the carrier confirmed shipment \u2014 required to win \u2018item not received\u2019 disputes",
  delivery_proof: "Confirms the customer received the package \u2014 strongest evidence against \u2018not received\u2019 claims",
  billing_address_match: "Matches the billing address to the order \u2014 critical for fraud disputes",
  avs_cvv_match: "Shows the card security checks passed \u2014 banks weigh this heavily in fraud cases",
  product_description: "Proves the product matched what was advertised \u2014 key defense for \u2018not as described\u2019 disputes",
  refund_policy: "Shows the customer agreed to your refund terms \u2014 protects against buyer\u2019s remorse claims",
  shipping_policy: "Documents your shipping commitments \u2014 supports delivery timeline disputes",
  cancellation_policy: "Proves the customer was informed of cancellation rules before purchase",
  customer_communication: "Shows you attempted to resolve the issue \u2014 banks favor merchants who engage",
  duplicate_explanation: "Explains why the charges are not duplicates \u2014 required for duplicate dispute responses",
  supporting_documents: "Additional proof that strengthens your case",
  activity_log: "Account activity that proves legitimate customer engagement",
};

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

const SOURCE_MAP: Record<string, string> = {
  order_confirmation: "From Shopify order data",
  billing_address_match: "From Shopify order data",
  avs_cvv_match: "From payment gateway",
  shipping_tracking: "From Shopify fulfillment data",
  delivery_proof: "From carrier tracking",
  customer_communication: "From order notes or upload",
  refund_policy: "From store policies page",
  shipping_policy: "From store policies page",
  cancellation_policy: "From store policies page",
  product_description: "Upload product listing",
  activity_log: "From Shopify customer data",
  supporting_documents: "Upload manually",
  duplicate_explanation: "Upload transaction records",
};

/* ── Per-field action metadata for merchant-addable items ── */

interface FieldAction {
  actionType: "upload" | "paste" | "note";
  ctaLabel: string;
  acceptedFormats: string;
  skipLabel: string;
}

const FIELD_ACTIONS: Record<string, FieldAction> = {
  supporting_documents: {
    actionType: "upload",
    ctaLabel: "Upload file",
    acceptedFormats: "Screenshot, PDF, or document",
    skipLabel: "Skip for now",
  },
  customer_communication: {
    actionType: "paste",
    ctaLabel: "Paste conversation or upload screenshot",
    acceptedFormats: "Pasted text, screenshot, or PDF",
    skipLabel: "Skip for now",
  },
  product_description: {
    actionType: "upload",
    ctaLabel: "Upload product listing screenshot",
    acceptedFormats: "Screenshot or PDF of product page",
    skipLabel: "Skip for now",
  },
  duplicate_explanation: {
    actionType: "paste",
    ctaLabel: "Upload transaction records",
    acceptedFormats: "Screenshot, PDF, or pasted text",
    skipLabel: "Skip for now",
  },
};

const DEFAULT_ACTION: FieldAction = {
  actionType: "upload",
  ctaLabel: "Upload proof",
  acceptedFormats: "Screenshot, PDF, or document",
  skipLabel: "Skip for now",
};

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

/** True when the merchant should see an upload affordance on a
 *  missing evidence row. Used by both the Overview tab "Add this
 *  evidence" CTA and the Evidence tab inventory + per-row Upload
 *  button so the policy is single-sourced.
 *
 *  Allows the merchant to act when the field is in the explicit
 *  `MERCHANT_ACTIONABLE_FIELDS` allowlist *or* the field is not
 *  strictly auto-collected (preserves the 2026-04-24 manual fallback
 *  for `conditional_auto` rows like AVS when payment data is
 *  missing). */
export function canMerchantUpload(item: {
  field: string;
  collectionType?: string;
}): boolean {
  if (MERCHANT_ACTIONABLE_FIELDS.has(item.field)) return true;
  return item.collectionType !== "auto";
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
): MissingItemWithContext[] {
  return checklist
    .filter((c) => c.status === "missing")
    // Only merchant-actionable items appear as tasks.
    // System-derived evidence (auto/conditional_auto) is not something
    // the merchant can upload or fix — it should never appear as a CTA.
    .filter((c) => c.collectionType === "manual" || !c.collectionType)
    .map((c) => {
      const action = FIELD_ACTIONS[c.field] ?? DEFAULT_ACTION;
      return {
        field: c.field,
        label: c.label,
        priority: c.priority,
        impact: WHY_TEXT[c.field] ?? "Strengthens your dispute response",
        source: SOURCE_MAP[c.field] ?? "Upload or provide manually",
        effort: EFFORT_MAP[c.field] ?? ("medium" as const),
        recommendation: c.priority === "critical" ? "Would strengthen your case" : "Recommended if available",
        actionType: action.actionType,
        ctaLabel: action.ctaLabel,
        acceptedFormats: action.acceptedFormats,
        skipLabel: action.skipLabel,
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
  whyWins: WhyWinsResult;
  risk: RiskResult;
  improvement: ImprovementSignal | null;
  nextAction: NextAction;
  /** Backend-derived merchant-facing recommendation. Plan v3 §3.A.6.
   *  OverviewTab renders these strings verbatim — never reconstructs
   *  the recommendation logic in JSX. */
  recommendationText: string;
  recommendationHelperText: string | null;
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
}

export function useDisputeWorkspace(disputeId: string) {
  const locale = useLocale();

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

    // Stop polling if not building
    const isActive = json.pack?.status === "queued" || json.pack?.status === "building";
    if (!isActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  }, [disputeId, locale]);

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
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
      setClientState((s) => ({
        ...s,
        uploadingField: field,
        uploadSuccessNotice: null,
        failedFields: new Map([...s.failedFields].filter(([k]) => k !== field)),
      }));
      let serverMessage: string | null = null;
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
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            serverMessage = typeof body?.error === "string" && body.error.trim().length > 0
              ? body.error
              : null;
            throw new Error(serverMessage ?? "Upload failed");
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
    [data?.pack, fetchAll],
  );

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

  // saveRebuttal + regenerateArgument removed 2026-05-16 — the legacy
  // text rebuttal engine is retired. The defence-package builder owns
  // bank-facing narrative now; regenerate happens via the
  // CompleteDefencePackageCard's own Regenerate button which calls
  // /api/defence-packages/[id]/regenerate.

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

  const downloadPdf = useCallback(async () => {
    if (!data?.pack) return;
    const res = await fetch(`/api/packs/${data.pack.id}/download`);
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, "_blank");
    }
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
        caseStrength: { overall: "insufficient", score: 0, coveragePercent: 0, strongCount: 0, moderateCount: 0, supportingCount: 0, supportedClaims: 0, totalClaims: 0, improvementHint: null },
        whyWins: { strengths: [], weaknesses: [], overall: "insufficient" },
        risk: { expectedOutcome: "insufficient", risks: [] },
        improvement: null,
        nextAction: { label: "Loading...", description: "", severity: "info" },
        recommendationText: "",
        recommendationHelperText: null,
        contributions: { strong: [], moderate: [] },
        isReadOnly: false,
        isBuilding: false,
        isFailed: false,
        failureCode: null,
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
    const missingItems = deriveMissingItems(effectiveChecklist);

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
    // not synthesise these strings inline.
    const isReadOnly = (isSaved ?? false) || clientState.justSubmitted;
    const { text: recommendationText, helperText: recommendationHelperText } =
      generateRecommendation({
        submitted: isReadOnly,
        strength: caseStrength.overall,
        topMissing: missingItems[0] ?? null,
        submittedAt: pack?.savedToShopifyAt ?? null,
      });

    return {
      effectiveChecklist: items,
      categories,
      missingItems,
      submitOverrideGaps,
      readiness,
      blockerCount,
      warningCount,
      caseStrength,
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
      waiveItem,
      unwaiveItem,
      submitToShopify,
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
