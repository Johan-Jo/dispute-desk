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
  preflightIsContentBlock,
  preflightNamedCandidate,
  preflightReasons,
  preflightRetiredKeys,
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
 * Why this call did not finalize.
 *
 * The first revision collapsed every non-`safe` preflight outcome into
 * `blocked: true` AND called `markPackageReviewRequired` for all of them. So a
 * Supabase timeout, or a dispute whose package had not been built yet, raised
 * a merchant-facing "this package needs review — regenerate it" banner and was
 * counted by `reconcileParkedAutoDisputes` as a safety block. Neither is true,
 * and neither is fixed by regenerating.
 *
 *   content_block  the package really does carry an unsupported claim.
 *                  Park it, raise the banner, notify. Retrying is pointless.
 *   transient      a query or write failed. Retry. No banner.
 *   pending        no package exists yet. Defer. No banner.
 *   stale          a newer version exists; this one is moot. No mutation,
 *                  no banner — the newer candidate owns the decision.
 */
export type FinalizeFailureKind = "content_block" | "transient" | "pending" | "stale";

export interface FinalizeAndEnqueueSaveResult {
  ok: boolean;
  /** Present on every failure. */
  failure?: FinalizeFailureKind;
  reason?: string;
  /** Machine-readable preflight reason codes, when the preflight refused. */
  reasons?: string[];
  /** Retry is worthwhile. True for `transient` and `pending` only. */
  retriable?: boolean;
  /** A genuine content verdict — the ONLY failure that parks for review. */
  blocked?: boolean;
}

/**
 * Promote `packageId` (a draft) to final, supersede any prior final for the
 * same dispute, and enqueue a `save_to_shopify` job against `sourcePackId`.
 * Never throws — every failure is classified (see `FinalizeFailureKind`) so
 * the caller can tell a package problem from an infrastructure problem.
 */
export async function finalizeAndEnqueueSave(
  input: FinalizeAndEnqueueSaveInput,
): Promise<FinalizeAndEnqueueSaveResult> {
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
    const reasons = preflightReasons(preflight);
    const contentBlock = preflightIsContentBlock(preflight);

    // The audit row is written for EVERY refusal — including the transient
    // ones — because "we declined to finalize" is a fact worth keeping either
    // way. `outcome` distinguishes them in the trail.
    await logAuditEvent({
      shopId,
      disputeId,
      actorType: "system",
      eventType: "defence_package_blocked_unsafe_claim",
      eventPayload: {
        packageId,
        version: packageVersion,
        outcome: preflight.kind,
        contentBlock,
        reasons,
        retiredKeys: preflightRetiredKeys(preflight),
        trigger: "finalize_and_enqueue_save",
      },
    });

    // ONLY a content verdict parks the dispute for merchant review.
    if (contentBlock) {
      await markPackageReviewRequired(sb, { disputeId, packageId, reasons });
      return {
        ok: false,
        failure: "content_block",
        reason: `defence_package_unsafe_claim: ${reasons.join(", ")}`,
        reasons,
        retriable: false,
        blocked: true,
      };
    }

    const failure: FinalizeFailureKind =
      preflight.kind === "error" ? "transient" : preflight.kind === "missing" ? "pending" : "stale";
    return {
      ok: false,
      failure,
      reason: `defence_package_preflight_${preflight.kind}: ${reasons.join(", ")}`,
      reasons,
      retriable: failure !== "stale",
      blocked: false,
    };
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
    return { ok: false, failure: "transient", reason: finalErr.message, retriable: true, blocked: false };
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
    return { ok: false, failure: "transient", reason: jobErr.message, retriable: true, blocked: false };
  }

  return { ok: true };
}
