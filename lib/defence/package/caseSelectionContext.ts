/**
 * Assembling "what is current for this case" for `selectFileablePackage`.
 *
 * ── WHY THE EXECUTOR CANNOT JUST PASS ITS DECISION ────────────────────
 *
 * The selector's staleness test compares three snapshots against three current
 * input hashes. An executor holds the decision it is acting on, but not the
 * PLAN — and it must not derive one itself, because automation may not import
 * argument internals (the branch boundary). So the join happens here, at
 * execution time, in a module both sides may depend on: it derives the current
 * plan through `derivePlanForCase` — the SAME bridge the build job wrote the
 * package with, which is what makes the two hashes comparable at all — and
 * returns it beside the decision the caller already has.
 *
 * ── WHY IT LOADS THE SAME ROWS THE BUILD JOB LOADED ───────────────────
 *
 * A plan derived from different inputs than the package was built from would
 * mark every package stale, so the inputs are the pack's `sections`, its
 * `evidence_items`, and the resolved reason-code module — exactly the build
 * job's list, in the same order. This is duplication of a query, deliberately,
 * rather than duplication of a derivation.
 *
 * ── FAILURE IS `null`, NOT A GUESS ────────────────────────────────────
 *
 * A missing pack, a missing dispute, a failed read: all produce `null`, which
 * the selector's caller turns into `no_package`. Nothing here invents a
 * permissive default, because every default in this position ends in "we could
 * not establish it was current, so we filed it".
 */

import type { getServiceClient } from "@/lib/supabase/server";
import type {
  CaseAutomationDecisionSnapshot,
  CurrentPipelineInputs,
} from "@/lib/pipeline/contracts";
import { assessmentFromPackRow } from "@/lib/automation/decision";
import { derivePlanForCase } from "@/lib/argument/plan";
import { classifyFacts, type ChecklistItemLike } from "@/lib/defence/factClassifier";
import {
  resolveReasonCodeModule,
  resolveReasonCodeModuleForContext,
} from "@/lib/defence/reasonCodes/registry";
import { isNonCardPaymentFamily } from "@/lib/disputes/paymentContext";
import { projectReviewItems } from "@/lib/evidence/model/merchantProjection";
import type { FileableSelectionContext } from "./loadFileableSelection";

type ServiceClient = ReturnType<typeof getServiceClient>;

/** The pack row shape this builder reads. Same columns the executors load. */
export interface SelectionContextPackRow {
  id: string;
  dispute_id: string | null;
  completeness_score: number | null;
  blockers: unknown;
  submission_readiness: unknown;
  pack_json: unknown;
  checklist_v2?: unknown;
}

export interface BuildSelectionContextArgs {
  sb: ServiceClient;
  caseId: string;
  pack: SelectionContextPackRow;
  /** The decision the executor is acting on. Never re-derived here. */
  decision: CaseAutomationDecisionSnapshot;
  /** `disputes.reason` / `disputes.network_reason_code`. */
  disputeReason: string | null;
  networkReasonCode: string | null;
  /** `defence_packages.reason_code_module` for the latest candidate. */
  reasonCodeModuleKey: string | null;
}

/**
 * The plan half, extracted and exported.
 *
 * PURE over already-loaded rows: same sections, items and module in, same plan
 * and hash out. It is exported for two reasons and both matter — the context
 * builder above is the production caller, and a TEST can compute the exact
 * `plan_input_hash` a package would have to carry to read current, instead of
 * hard-coding a hash that stops meaning anything the moment the derivation
 * changes. A fixture with a stale literal hash silently becomes a test that
 * only proves staleness detection works.
 */
export function derivePlanIdentityForPack(args: {
  caseId: string;
  packId: string;
  packJson: unknown;
  evidenceItems: Array<{
    id: string;
    payload: (Record<string, unknown> & { fieldsProvided?: string[] }) | null;
    source: string | null;
  }>;
  checklist: ChecklistItemLike[];
  disputeReason: string | null;
  networkReasonCode: string | null;
}) {
  const packJson = (args.packJson ?? {}) as Record<string, unknown>;
  const sections =
    (packJson.sections as Array<{
      type: string;
      label: string;
      source: string;
      data: Record<string, unknown>;
      fieldsProvided: string[];
    }>) ?? [];
  const coverage =
    (packJson.coverage as { state?: string } | undefined)?.state ?? "not_covered";
  const fatalLoss =
    (packJson.fatal_loss as { triggered?: boolean; reason?: string | null } | undefined) ?? {
      triggered: false,
      reason: null,
    };

  const paymentContext =
    (packJson.payment_context as { family?: string } | undefined) ?? null;
  const isNonCardPayment = isNonCardPaymentFamily(paymentContext?.family ?? null);
  const reasonCodeModule = isNonCardPayment
    ? resolveReasonCodeModuleForContext(
        args.networkReasonCode,
        args.disputeReason,
        undefined,
      )
    : resolveReasonCodeModule(args.networkReasonCode, undefined);

  // The classifier's facts are needed for `alwaysAdmissible` resolution and the
  // record→fact map, exactly as at build time. Its ELIGIBILITY verdict is not
  // consulted: whether a package may be filed is the selector's answer, and
  // re-asking a build-time question at execution would be a second gate.
  const classification = classifyFacts({
    packageId: args.packId,
    sections: sections.map((s) => ({
      type: s.type,
      label: s.label,
      source: s.source,
      data: s.data ?? {},
      fieldsProvided: s.fieldsProvided ?? [],
    })),
    evidenceItems: args.evidenceItems,
    checklist: args.checklist,
    coverage: {
      state: coverage === "covered_shopify" ? "covered_shopify" : "not_covered",
    },
    fatalLoss: {
      triggered: fatalLoss.triggered === true,
      reason: fatalLoss.reason ?? null,
    },
    caseStrength: "moderate",
    manualRows: [],
    reasonCodeModule,
  });

  return derivePlanForCase({
    caseId: args.caseId,
    model: {
      disputeId: args.caseId,
      reason: args.disputeReason,
      packId: args.packId,
      sections,
      evidenceItems: args.evidenceItems,
      coverage: { state: coverage },
      networkReasonCode: args.networkReasonCode,
    },
    reasonCodeModule,
    approvedFacts: classification.approved,
    reviewItems: [],
    // Audit only, never hashed. This value is not stored by the selection path.
    computedAt: "1970-01-01T00:00:00.000Z",
  });
}

export async function buildFileableSelectionContext(
  args: BuildSelectionContextArgs,
): Promise<FileableSelectionContext | null> {
  const { sb, caseId, pack, decision } = args;

  const { data: itemsRaw } = await sb
    .from("evidence_items")
    .select("id, payload, source")
    .eq("pack_id", pack.id);
  const items = (itemsRaw ?? []).map((it) => ({
    id: it.id as string,
    payload: it.payload as (Record<string, unknown> & { fieldsProvided?: string[] }) | null,
    source: (it.source as string | null) ?? null,
  }));

  const checklist: ChecklistItemLike[] =
    (pack.checklist_v2 as Array<{ field: string; status: string }> | null)?.map((c) => ({
      field: c.field,
      status: c.status as ChecklistItemLike["status"],
    })) ?? [];

  const planned = derivePlanIdentityForPack({
    caseId,
    packId: pack.id,
    packJson: pack.pack_json,
    evidenceItems: items,
    checklist,
    disputeReason: args.disputeReason,
    networkReasonCode: args.networkReasonCode,
  });

  const assessment = assessmentFromPackRow(
    {
      id: pack.id,
      dispute_id: pack.dispute_id,
      completeness_score: pack.completeness_score,
      blockers: pack.blockers,
      submission_readiness: pack.submission_readiness,
      pack_json: pack.pack_json,
    },
    {
      caseId,
      // F4 again, at the execution end: the count the decision's
      // `review_required_present` reads comes from the plan's own exclusions,
      // through the same projection the merchant surface renders.
      reviewRequiredCount: projectReviewItems(planned.plan).length,
    },
  );

  const current: CurrentPipelineInputs = {
    assessmentInputHash: assessment.freshness.inputHash,
    planInputHash: planned.planInputHash,
    decisionInputHash: decision.freshness.inputHash,
    // ONE policy version across the comparison. The plan's is authoritative
    // because it is the only one persisted on the candidate row; the decision
    // and assessment are derived live and are fresh by construction.
    policyVersion: planned.policyVersion,
  };

  return { assessment, decision, plan: planned.plan, current };
}
