/**
 * Reads the workspace payload into the dispute record's inputs, for EVERY
 * state the page can show. The stage (where the dispute stands) is decided
 * here, once; `buildDisputeRecord` then words it in the one register.
 *
 * Read-only: nothing here writes, rebuilds or re-scores anything.
 */

import { RETURN_EVIDENCE_FIELD } from "@/lib/packs/returnEvidenceField";
import { recordStatusOf, stageOf } from "@/lib/disputes/workspacePayload/recordStage";
import {
  FACT_CATEGORY_FIELD,
  type RecordInputs,
  type RecordLine,
  type RecordStage,
  type RecordStatus,
} from "@/lib/disputes/disputeRecord";
import { bankIncludedFacts } from "@/lib/defence/bankInclusion";
import { letterCitations } from "@/lib/disputes/letterCitations";
import type { EvidenceFact } from "@/lib/defence/types";
import type { DecidedViewInputs } from "@/lib/disputes/decidedView";
import type { StorePatterns } from "@/lib/disputes/storePatterns";
import { attentionLabelKey } from "@/lib/disputes/presentation/labels";
import { resolveBuildAttempt, type ObservedAttemptRow } from "@/lib/disputes/presentation/resolveBuildAttempt";
import type { WorkspaceData } from "../workspace-components/types";

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

interface PackageRow {
  id?: string | null;
  version?: number | null;
  failure_code?: string | null;
  status?: string | null;
  generated_at?: string | null;
  validation_status?: string | null;
  pdf_path?: string | null;
  facts_json?: unknown;
  document_provenance_json?: unknown;
  narrative_json?: unknown;
  reason_code_module?: string | null;
}

function pkgRow(v: unknown): PackageRow | null {
  return rec(v) as PackageRow | null;
}

/** Workspace payloads served by a route that predates the store-pattern field carry none. */
export type WorkspaceWithPatterns = WorkspaceData & { recordStorePatterns?: StorePatterns | null };

/** Evidence payloads by field, from the pack. */
function packFacts(data: WorkspaceData): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [field, item] of Object.entries(data.pack?.evidenceItemsByField ?? {})) {
    const payload = rec((item as { payload?: unknown } | null)?.payload);
    if (payload) out[field] = payload;
  }
  return out;
}

export function recordInputsFromWorkspace(data: WorkspaceWithPatterns, nowIso: string): RecordInputs {
  const d = data.dispute;
  const dv = data.decidedView ?? null;
  const p = data.presentation ?? null;
  const status: RecordStatus = recordStatusOf(data);
  const stage = stageOf(data, status);
  const decided = status !== "open";
  const facts = decided && dv ? dv.facts : packFacts(data);

  const lines: RecordLine[] = (data.evidenceLineItems ?? []).map((l) => ({
    field: l.field,
    hasEvidence: l.hasEvidence === true,
    method: String(l.submissionMethod ?? ""),
    strength: String(l.strengthContribution ?? ""),
  }));

  let view: DecidedViewInputs;
  if (dv) {
    view = dv;
  } else {
    const order = rec(facts.order_confirmation);
    const ship = rec(facts.shipping_tracking);
    const firstFulfillment = Array.isArray(ship?.fulfillments) ? rec((ship?.fulfillments as unknown[])[0]) : null;
    const risk = rec(facts.fraud_risk_screening);
    view = {
      outcome: status === "lost" ? "lost" : "won",
      phase: d.phase,
      reason: d.reason ?? null,
      amount: d.amount,
      currency: d.currency,
      openedAt: d.openedAt ?? null,
      dueAt: d.dueAt ?? null,
      closedAt: decided ? d.closedAt ?? null : null,
      response: null,
      order: {
        createdAt: str(order?.createdAt),
        fulfillmentStatus: str(order?.fulfillmentStatus),
        fulfilledAt: str(firstFulfillment?.createdAt),
        cancelledAt: str(order?.cancelledAt),
        riskRecommendation: str(risk?.recommendation),
      },
      lineItems: [],
      facts,
      fatalLossReason: data.workspaceAssessment?.caseStrength?.fatalLoss?.reason ?? null,
      firstPackAt: null,
      events: [],
      storePatterns: data.recordStorePatterns ?? null,
      // A parcel the carrier returned makes "no return was received" impossible (lib/packs/noReturnApplicability).
      // The loader computes this for decided disputes; here the same fact is the server's returned-to-sender gate.
      ...(data.workspaceAssessment?.caseStrength?.returnedToSender?.triggered === true
        ? { inapplicable: [RETURN_EVIDENCE_FIELD] }
        : {}),
    };
  }

  // Decided: the fields the SUBMITTED package carried as bank-eligible narrative.
  let bankCitedFields: string[] | null = null;
  const bank = pkgRow(data.defencePackage?.bankFacing);
  if (decided && bank && Array.isArray(bank.facts_json)) {
    const set = new Set<string>();
    // The one bank-inclusion predicate (lib/defence/bankInclusion.ts) decides what the bank was told.
    for (const fact of bankIncludedFacts(bank.facts_json as EvidenceFact[])) {
      const field = FACT_CATEGORY_FIELD[fact.category];
      if (field) set.add(field);
    }
    bankCitedFields = [...set];
  }

  const latest = pkgRow(data.defencePackage?.latest);

  // What the STORED letter cites. The same row the Review tab draws the letter
  // from (decided / saved: the package that was filed; otherwise the newest),
  // read through the same derivation as the letter's own Evidence Basis, under
  // the rule that package was built with. A decided dispute with no submitted
  // package has no letter of ours to describe (the page already says we did not
  // file), so `latest` is never borrowed for it; a failed or skipped build
  // printed no letter either (`letterCitations` returns null for those).
  const savedForLetter = stage === "saved" || stage === "under_review";
  const letterRow = decided ? bank : savedForLetter ? (bank ?? latest) : latest;
  const letter = letterRow ? letterCitations(letterRow) : null;

  const run = data.gorgiasComms?.latestRun ?? null;
  const sit = d.orderSituation ?? null;
  const responder = dv?.response?.responder ?? null;
  const savedStage = stage === "saved" || stage === "under_review";
  const version = decided
    ? typeof bank?.version === "number"
      ? bank.version
      : null
    : savedStage && typeof bank?.version === "number"
      ? bank.version
      : typeof latest?.version === "number"
        ? latest.version
        : null;

  const hasPackage = decided
    ? responder === "we" && typeof bank?.version === "number"
    : stage === "prepared" ||
      stage === "prepared_review" ||
      stage === "held" ||
      stage === "needs_attention" ||
      stage === "fatal" ||
      savedStage;

  // The latest defence-package attempt, read through the build-attempt owner (failed / capped / skipped).
  const attemptRow: ObservedAttemptRow | null = latest
    ? {
        id: latest.id ?? "",
        version: typeof latest.version === "number" ? latest.version : 0,
        status: (latest.status ?? "draft") as ObservedAttemptRow["status"],
        validationStatus: (latest.validation_status ?? null) as ObservedAttemptRow["validationStatus"],
        failureCode: latest.failure_code ?? null,
        hasValidatedArtifact: Boolean(latest.pdf_path) && latest.validation_status === "ok",
      }
    : null;
  const attempt = resolveBuildAttempt({
    readOk: true,
    jobReadOk: false,
    rows: attemptRow ? [attemptRow] : [],
    activeJob: null,
  });
  const build = latest
    ? {
        state: attempt.state,
        cause: attempt.cause,
        packageWritten: latest.status !== "failed" && latest.status !== "skipped",
        at: latest.generated_at ?? null,
      }
    : null;

  const attentionKey = p && p.attention !== "none" ? attentionLabelKey(p) : null;
  const decision = d.reviewState ?? null;

  return {
    status,
    view,
    now: nowIso,
    orderName: d.orderName?.trim() || null,
    customerName: d.customerName || null,
    cardholderName: d.cardholderName ?? null,
    cardNetwork: d.cardNetwork ?? null,
    cardLast4: d.cardLast4 ?? null,
    gateway: d.paymentGateway ?? null,
    strength: p?.strength ?? null,
    pkg: decided
      ? { version, preparedAt: null, filedAt: dv?.response?.filedAt ?? null }
      : { version, preparedAt: latest?.generated_at ?? null, filedAt: null },
    lines,
    bankCitedFields,
    letter,
    refund: sit?.refund === "none" || sit?.refund === "some" ? sit.refund : "unknown",
    timelineEvents: (d.timelineEvents ?? []).map((e) => ({ at: e.at, text: e.text })),
    gorgiasFoundNone: data.gorgiasComms?.integrationStatus === "connected" && run?.status === "no_matches",
    asks: data.asks ?? [],
    automationMode: decided ? null : p?.automationMode === "review" || data.appliedRule?.mode === "review" ? "review" : "auto",
    stage,
    packPrepared: p?.lifecycle === "pack_prepared",
    hasPackage,
    responder,
    sentAt: dv?.response?.sentAt ?? null,
    savedAt: data.pack?.savedToShopifyAt ?? d.submittedAt ?? null,
    reopenedAt: d.reopenedAt ?? d.reopenedAfterCloseAt ?? null,
    escalatedAt: d.escalatedFromInquiryAt ?? null,
    attentionKey,
    fatalReason: data.workspaceAssessment?.caseStrength?.fatalLoss?.reason ?? null,
    returns: (sit?.returns as RecordInputs["returns"] | undefined) ?? "unknown",
    returnOpenedAt: sit?.returnOpenedAt ?? null,
    customerAskedInSupport: data.returnSignals?.customerAskedInSupport === true,
    canDecide:
      !decided &&
      (p?.editable ?? false) &&
      (stage === "prepared_review" || stage === "held" || stage === "needs_attention"),
    decision: decision === "approved" || decision === "conceded" || decision === "in_review" ? decision : null,
    lifecycle: p?.lifecycle ?? null,
    blockingReason: p?.blockingReason ?? null,
    submissionState: d.submissionState ?? null,
    packStatus: data.pack?.status ?? null,
    packUpdatedAt: data.pack?.updatedAt ?? null,
    build,
    returnedToSender: data.workspaceAssessment?.caseStrength?.returnedToSender?.triggered === true,
  };
}
