/**
 * finalizeAndEnqueueSave — the single canonical "promote a ready draft to
 * final and enqueue the Shopify save" sequence.
 *
 * This is the exact tail that `buildDefencePackageJob` runs when a build
 * resolves to auto mode (finalize draft → final, supersede any prior final,
 * enqueue `save_to_shopify`). It is extracted here so a SECOND caller —
 * `reconcileParkedAutoDisputes`, which handles disputes that were built and
 * parked BEFORE their reason's rule flipped to auto — drives the identical
 * path instead of re-implementing it. Fix the class, not the instance:
 * there is one finalize+save sequence, not two that can drift.
 *
 * It does NOT re-run the build or re-render the PDF — the caller must have
 * already confirmed the draft is complete (validation_status='ok', a
 * pdf_path is present). The save gate in `saveToShopifyJob` re-checks
 * `status='final'` + `pdf_path`, so a bad input fails safe at save time.
 */

import type { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  preflightBlocks,
  preflightNamedCandidate,
  preflightReasons,
} from "@/lib/defence/packageSafety";
import { markPackageReviewRequired } from "./packageReviewRequired";

type ServiceClient = ReturnType<typeof getServiceClient>;

export interface FinalizeAndEnqueueSaveInput {
  sb: ServiceClient;
  shopId: string;
  disputeId: string;
  /** The defence_packages row to promote (must be an eligible draft). */
  packageId: string;
  packageVersion: number;
  /** evidence_packs.id — the entity_id the save job runs against. */
  sourcePackId: string;
}

/**
 * Promote `packageId` (a draft) to final, supersede any prior final for the
 * same dispute, and enqueue a `save_to_shopify` job against `sourcePackId`.
 * Returns `{ ok }` and never throws — enqueue/supersede failures are logged
 * and surfaced via `ok:false` so the caller can decide whether to retry.
 * `blocked:true` distinguishes a PR-C1 safety refusal (no side effect
 * happened, and retrying will not help) from a transient failure.
 */
export async function finalizeAndEnqueueSave(
  input: FinalizeAndEnqueueSaveInput,
): Promise<{ ok: boolean; reason?: string; blocked?: boolean }> {
  const { sb, shopId, disputeId, packageId, packageVersion, sourcePackId } =
    input;

  // 0. PR-C1 candidate-safety preflight on the EXACT package about to be
  //    promoted — before the finalize, before the supersede, before the
  //    enqueue. Assessing later would leave an unsafe row promoted to `final`
  //    and a prior good row superseded by it, with only the worker refusing to
  //    file: a dispute whose newest candidate is final-but-unfileable and
  //    whose previous candidate has been retired.
  const preflight = await preflightNamedCandidate(sb, { packageId, disputeId });
  if (preflightBlocks(preflight)) {
    await logAuditEvent({
      shopId,
      disputeId,
      actorType: "system",
      eventType: "defence_package_blocked_unsafe_claim",
      eventPayload: {
        packageId,
        version: packageVersion,
        reasons: preflightReasons(preflight),
        retiredKeys: preflight.verdict.retiredKeys,
        isCurrent: preflight.isCurrent,
        trigger: "finalize_and_enqueue_save",
      },
    });
    await markPackageReviewRequired(sb, {
      disputeId,
      packageId,
      reasons: preflightReasons(preflight),
    });
    return { ok: false, reason: `defence_package_unsafe_claim: ${preflightReasons(preflight).join(", ")}`, blocked: true };
  }

  // 1. Promote this draft → final. Guarded on status='draft' so it is a
  //    no-op when the caller (e.g. buildDefencePackageJob) already flipped
  //    the row to final — in that case we skip the duplicate audit log and
  //    fall through to supersede + enqueue.
  const { data: flipped, error: finalErr } = await sb
    .from("defence_packages")
    .update({ status: "final", updated_at: new Date().toISOString() })
    .eq("id", packageId)
    .eq("status", "draft")
    .select("id");
  if (finalErr) {
    console.error("[finalizeAndEnqueueSave] finalize failed", finalErr);
    return { ok: false, reason: finalErr.message };
  }

  if (flipped && flipped.length > 0) {
    await logAuditEvent({
      shopId,
      disputeId,
      actorType: "system",
      eventType: "defence_package_finalized",
      eventPayload: {
        packageId,
        version: packageVersion,
        source: "finalize_and_enqueue_save",
      },
    });
  }

  // 2. Supersede any prior final (same dispute, different version) so the
  //    immutability trigger — which requires superseded_by_id to target a
  //    status=final row — is satisfied.
  const { data: priorFinal } = await sb
    .from("defence_packages")
    .select("id, version")
    .eq("dispute_id", disputeId)
    .eq("status", "final")
    .neq("id", packageId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorFinal) {
    const { error: supErr } = await sb
      .from("defence_packages")
      .update({
        status: "superseded",
        superseded_by_id: packageId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", priorFinal.id);
    if (supErr) {
      // The new row is already final; a concurrent mutation can be retried
      // later. Log and continue — the save still targets the new final.
      console.error("[finalizeAndEnqueueSave] supersede failed", supErr);
    } else {
      await logAuditEvent({
        shopId,
        disputeId,
        actorType: "system",
        eventType: "defence_package_superseded",
        eventPayload: {
          supersededId: priorFinal.id,
          supersededVersion: priorFinal.version,
          replacedById: packageId,
          replacedByVersion: packageVersion,
        },
      });
    }
  }

  // 3. Enqueue the save. saveToShopifyJob re-checks status='final' + pdf_path.
  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: shopId,
    job_type: "save_to_shopify",
    entity_id: sourcePackId,
  });
  if (jobErr) {
    console.error("[finalizeAndEnqueueSave] enqueue save_to_shopify failed", jobErr);
    return { ok: false, reason: jobErr.message };
  }

  return { ok: true };
}
