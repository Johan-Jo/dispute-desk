/**
 * The parked-auto reconcile pass as production runs it TODAY, moved verbatim.
 *
 * PR 2 rewrites `reconcileParkedAutoDisputes` onto the canonical
 * `CaseAutomationDecision` and deletes its own pre-filter chain, but ships it
 * DARK (`lib/pipeline/activation.ts`). The rewrite is not a no-op: the shipped
 * pass hard-filters `strength === "strong"` BEFORE counting `scanned`, and
 * asks the guards before the rules; the canonical one resolves the mode first
 * and lets one decision answer everything. `scanned` therefore counts a
 * different population in each, which is visible in the returned result.
 *
 * So the OFF path is the SAME CODE, from the kickoff baseline `58e15806`, with
 * two mechanical edits: the entry point is renamed, and `ReconcileResult` is no
 * longer re-exported (it is exported from the live module and a second public
 * copy of one shape is exactly what this delivery exists to remove).
 *
 * PR 3 deletes this file together with the switch's `false` branch.
 */


import { getServiceClient } from "@/lib/supabase/server";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { evaluateAutoSubmitGuards } from "./autoSubmitGuards";
import { finalizeAndEnqueueSave } from "./finalizeAndEnqueueSave";

interface PackJson {
  case_strength?: { overall?: string } | null;
  disputeReason?: string | null;
  coverage?: { state?: string } | null;
  fatal_loss?: { triggered?: boolean } | null;
}

interface ReconcileResult {
  scanned: number;
  reconciled: number;
  /** PR-C1: candidates refused on a CONTENT verdict — the package really does
   *  carry an unsupported or uninspectable claim. NOT counted as reconciled:
   *  a blocked dispute has not been handled, it has been deliberately left for
   *  the merchant. Transient failures and not-yet-built packages are counted
   *  separately below; folding them in here reported an outage as a fleet of
   *  unsafe packages. */
  blocked: number;
  /** Refused for a reason that is not the package's fault — a query failure,
   *  or no package built yet. These are retried on the next reconcile. */
  deferred: number;
  disputeIds: string[];
}

/**
 * Scan a shop's not-saved disputes and auto-finalize+save any that are now
 * eligible under the current rules. Safe to call repeatedly (idempotent:
 * a dispute with a pending save job or an already-final package is skipped).
 */
export async function reconcileParkedAutoDisputesLegacy(
  shopId: string,
): Promise<ReconcileResult> {
  const sb = getServiceClient();
  const result: ReconcileResult = {
    scanned: 0,
    reconciled: 0,
    blocked: 0,
    deferred: 0,
    disputeIds: [],
  };

  // Candidate disputes: not yet saved, still open, with a READY evidence
  // pack. We only look at the latest pack per dispute.
  const { data: disputes } = await sb
    .from("disputes")
    .select("id, reason, status, amount, phase")
    .eq("shop_id", shopId)
    .eq("submission_state", "not_saved")
    .is("closed_at", null);

  if (!disputes || disputes.length === 0) return result;

  for (const dispute of disputes) {
    // Latest evidence pack for this dispute.
    const { data: pack } = await sb
      .from("evidence_packs")
      .select("id, status, pack_json, shop_id")
      .eq("dispute_id", dispute.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!pack || pack.status !== "ready") continue;

    const packJson = (pack.pack_json ?? {}) as PackJson;
    const strength = packJson.case_strength?.overall ?? null;
    // PRD §9: auto saves ONLY Strong. Anything else legitimately parks.
    // Checked up front so `scanned` counts only Strong candidates, and so a
    // legacy pack with no recorded strength is never promoted here (the
    // shared guards let `null` proceed for the build paths, but promoting a
    // never-scored pack after the fact is not this function's job).
    if (strength !== "strong") continue;

    result.scanned += 1;

    // Coverage / fatal-loss / strength — the SAME decision the pipeline and
    // the defence-build job apply. Shared so the three paths can never drift
    // apart. See lib/automation/autoSubmitGuards.ts.
    const verdict = evaluateAutoSubmitGuards({
      coverageState: packJson.coverage?.state,
      fatalLoss: packJson.fatal_loss,
      caseStrength: strength,
      // Previously omitted (P5, 2026-08-04). This path only promotes Strong
      // packs, so a credited case already passed via the floor — but the gate
      // set must be identical across all four call sites or "the SAME decision
      // the pipeline applies" in the comment above stops being true.
      creditAlreadyIssued:
        (packJson as { credit_already_issued?: { triggered?: boolean; coversDisputedAmount?: boolean } })
          .credit_already_issued ?? null,
    });
    if (verdict.decision !== "proceed") continue;

    // Does the CURRENT rule set resolve this dispute to auto? If the rule
    // is still review, the merchant wants to approve manually — leave it.
    let mode: "auto" | "review" = "review";
    try {
      const evalResult = await evaluateRules({
        id: dispute.id,
        shop_id: shopId,
        reason: (dispute.reason as string | null) ?? null,
        status: (dispute.status as string | null) ?? null,
        amount: (dispute.amount as number | null) ?? null,
        phase: (dispute.phase as "inquiry" | "chargeback" | null | undefined) ?? null,
      });
      mode = evalResult.action.mode;
    } catch (err) {
      console.error("[reconcileParkedAuto] evaluateRules failed", err);
      continue;
    }
    if (mode !== "auto") continue;

    // Latest defence package must be a finalize-able draft: draft +
    // validation ok + pdf present. Anything else (cap-failed, no PDF,
    // already final/submitted) is not our job to fix here.
    const { data: dpkg } = await sb
      .from("defence_packages")
      .select("id, version, status, validation_status, pdf_path")
      .eq("dispute_id", dispute.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      !dpkg ||
      dpkg.status !== "draft" ||
      dpkg.validation_status !== "ok" ||
      !dpkg.pdf_path
    ) {
      continue;
    }

    // Idempotency: skip if a save job is already in flight for this pack.
    const { data: pendingSave } = await sb
      .from("jobs")
      .select("id")
      .eq("job_type", "save_to_shopify")
      .eq("entity_id", pack.id)
      .in("status", ["queued", "running", "pending"])
      .limit(1)
      .maybeSingle();
    if (pendingSave) continue;

    const outcome = await finalizeAndEnqueueSave({
      sb,
      shopId,
      disputeId: dispute.id,
      packageId: dpkg.id,
      packageVersion: dpkg.version,
      sourcePackId: pack.id,
    });
    if (outcome.ok) {
      result.reconciled += 1;
      result.disputeIds.push(dispute.id);
    } else if (outcome.failure === "content_block") {
      // finalizeAndEnqueueSave refused on a CONTENT verdict: it finalized
      // nothing, superseded nothing and enqueued nothing, and it has already
      // audited the refusal and raised the review-required attention state.
      // Counting it as reconciled would report an unsafe historical draft as
      // promoted.
      result.blocked += 1;
    } else {
      // Transient / pending / stale. Not the package's fault, no merchant
      // banner raised, and the next reconcile pass retries it.
      result.deferred += 1;
    }
  }

  return result;
}
