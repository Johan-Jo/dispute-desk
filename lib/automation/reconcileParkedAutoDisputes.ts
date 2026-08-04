/**
 * reconcileParkedAutoDisputes — re-drive disputes that were built and
 * PARKED under a review/moderate rule, and are now eligible to auto-save
 * because their reason's rule flipped to `auto`.
 *
 * Why this exists: `buildDefencePackageJob` decides finalize-vs-draft ONCE,
 * at build time, from the rule mode resolved then. If a merchant later flips
 * a reason's rule to auto (or lowers an amount safeguard), nothing re-runs
 * the build, so already-built Strong drafts sit at `status='draft'`,
 * `submission_state='not_saved'` forever — never auto-saved under the new
 * rule. This happened on blume-box: four Strong fraud disputes built Jul-22
 * ~03:00 (rule=review), then the fraud rule flipped to auto Jul-22 22:50,
 * and the drafts stayed stuck. See
 * [[project_llm_cap_defence_package_incident]] for the sibling "cap-failed
 * drafts never self-heal" class.
 *
 * Runs after any rule write: `writeStoreAutomation` (the store-wide switch
 * and its safeguard) and every custom-rule mutation — `POST /api/rules`,
 * `PATCH /api/rules/[id]`, `DELETE /api/rules/[id]`.
 *
 * It re-applies the SAME gates the auto path enforces — Coverage, Fatal-loss,
 * and PRD §9 strength (Strong only) — via
 * the shared `evaluateAutoSubmitGuards`, so it can ONLY promote a case the
 * pipeline itself would have auto-saved. It never touches
 * moderate/weak/insufficient, covered, or fatal-loss cases.
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

export interface ReconcileResult {
  scanned: number;
  reconciled: number;
  disputeIds: string[];
}

/**
 * Scan a shop's not-saved disputes and auto-finalize+save any that are now
 * eligible under the current rules. Safe to call repeatedly (idempotent:
 * a dispute with a pending save job or an already-final package is skipped).
 */
export async function reconcileParkedAutoDisputes(
  shopId: string,
): Promise<ReconcileResult> {
  const sb = getServiceClient();
  const result: ReconcileResult = { scanned: 0, reconciled: 0, disputeIds: [] };

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
    }
  }

  return result;
}
