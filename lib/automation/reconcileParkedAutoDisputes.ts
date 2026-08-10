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
 * It does not re-apply "the same gates" by re-listing them — it reads the ONE
 * canonical `CaseAutomationDecision` (CP-C), so it can only promote a case the
 * pipeline itself would have auto-filed. Its own pre-filter chain is gone: the
 * decision decides, this function executes.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { getShopSettings } from "./settings";
import { decideForPack } from "./decision";
import { finalizeAndEnqueueSave } from "./finalizeAndEnqueueSave";

export interface ReconcileResult {
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
export async function reconcileParkedAutoDisputes(
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

  const settings = await getShopSettings(shopId);

  // Candidate disputes: not yet saved, still open, with a READY evidence
  // pack. We only look at the latest pack per dispute.
  const { data: disputes } = await sb
    .from("disputes")
    .select("id, reason, status, amount, phase, due_at")
    .eq("shop_id", shopId)
    .eq("submission_state", "not_saved")
    .is("closed_at", null);

  if (!disputes || disputes.length === 0) return result;

  for (const dispute of disputes) {
    // Latest evidence pack for this dispute.
    const { data: pack } = await sb
      .from("evidence_packs")
      .select(
        "id, status, pack_json, shop_id, completeness_score, blockers, submission_readiness",
      )
      .eq("dispute_id", dispute.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!pack || pack.status !== "ready") continue;

    // Does the CURRENT rule set resolve this dispute to auto? Resolved BEFORE
    // the decision because the mode is one of the decision's inputs — the old
    // order asked the guards first and the rules second, which is how this
    // path came to own a pre-filter chain of its own.
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

    // THE decision. Coverage, fatal-loss, staleness, hard blocks, mode,
    // strength and completeness — one object, the same one the pipeline, the
    // defence build and the deadline cron read. This function no longer owns
    // an opinion about any of them; it only executes what the decision allows.
    const decision = decideForPack({
      caseId: dispute.id as string,
      pack: {
        id: pack.id as string,
        dispute_id: dispute.id as string,
        completeness_score: (pack.completeness_score as number | null) ?? null,
        blockers: pack.blockers,
        submission_readiness: pack.submission_readiness,
        pack_json: pack.pack_json,
      },
      settings,
      automationMode: mode,
      evidenceDueAt: (dispute.due_at as string | null) ?? null,
    });

    // `scanned` counts the cases this pass could plausibly promote — i.e. the
    // ones the decision authorises. Everything else legitimately stays parked
    // and is not this function's business.
    if (decision.action !== "auto_file") continue;

    result.scanned += 1;

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
