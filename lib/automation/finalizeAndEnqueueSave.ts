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
  preflightRevision,
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
export type FinalizeFailureKind =
  | "content_block"
  | "transient"
  | "pending"
  | "stale"
  /**
   * The candidate was not the eligible draft this caller believed it was, or
   * the guarded `draft → final` UPDATE matched zero rows because someone else
   * changed the lifecycle first. No side effect happened, and retrying THIS
   * invocation will not help: whoever won the transition owns the enqueue.
   */
  | "lifecycle";

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
  //    `requireFinalizable` additionally asserts the candidate is still the
  //    eligible DRAFT (validation ok, PDF rendered) this caller believes it
  //    is. Content safety alone said nothing about the lifecycle, so a package
  //    another actor had already finalized, invalidated or left PDF-less still
  //    reached the transition below.
  const preflight = await preflightNamedCandidate(
    sb,
    { packageId, disputeId },
    { requireFinalizable: true },
  );
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
      preflight.kind === "error"
        ? "transient"
        : preflight.kind === "missing"
          ? "pending"
          : preflight.kind === "not_fileable"
            ? "lifecycle"
            : "stale";
    return {
      ok: false,
      failure,
      reason: `defence_package_preflight_${preflight.kind}: ${reasons.join(", ")}`,
      reasons,
      retriable: failure === "transient" || failure === "pending",
      blocked: false,
    };
  }

  // ── The transaction ──────────────────────────────────────────────────
  //
  // Promotion, supersession and the enqueue are ONE database transaction, in
  // `finalize_defence_package`, under a `FOR UPDATE` lock on the parent
  // dispute. Three separate PostgREST calls could not express this contract
  // however carefully each one was guarded:
  //
  //   * currency was proven in TypeScript and could be invalidated by a newer
  //     version inserted before the promotion landed — the old row was still a
  //     draft, so a field-guarded update promoted a stale candidate;
  //   * the facts / narrative / PDF the preflight inspected could be rewritten
  //     in between, so the filed row was not the judged row;
  //   * a failed enqueue left the package `final`, the predecessor
  //     `superseded`, and a "retriable" result that could never retry — the
  //     rebuild refuses a non-draft, and reconciliation only looks at drafts.
  //
  // `contentRevision` is the database-enforced revision of exactly the four
  // fields the preflight read. The transaction refuses if it moved.
  const contentRevision = preflightRevision(preflight);
  if (!contentRevision) {
    // No revision means we cannot prove the inspected content is the content
    // being promoted. Unresolved, therefore refused.
    return {
      ok: false,
      failure: "lifecycle",
      reason: "defence_package_missing_content_revision",
      retriable: false,
      blocked: false,
    };
  }

  const { data: rpcData, error: rpcErr } = await sb.rpc("finalize_defence_package", {
    p_package_id: packageId,
    p_expected_revision: contentRevision,
    p_expected_version: packageVersion,
    p_enqueue_save: true,
  });
  if (rpcErr) {
    console.error("[finalizeAndEnqueueSave] finalize_defence_package failed", rpcErr);
    return {
      ok: false,
      failure: "transient",
      reason: rpcErr.message,
      retriable: true,
      blocked: false,
    };
  }

  const result = (rpcData ?? {}) as {
    outcome?: string;
    reason?: string;
    superseded_id?: string | null;
    superseded_version?: number | null;
    job_id?: string | null;
    enqueued?: boolean;
  };

  if (result.outcome === "conflict") {
    // Nothing was written — the whole transaction rolled back or never
    // mutated. The candidate is still the draft it was, so a rebuild can
    // genuinely start over.
    return {
      ok: false,
      failure: "lifecycle",
      reason: `defence_package_transition_conflict: ${result.reason ?? "unknown"}`,
      reasons: result.reason ? [result.reason] : undefined,
      retriable: false,
      blocked: false,
    };
  }

  if (result.outcome === "already_done") {
    // Idempotent replay: this exact revision was already promoted, and the
    // save job is guaranteed to exist by the RPC's dedupe key. Reporting a
    // lifecycle failure here would misclassify committed work as lost.
    return { ok: true };
  }

  // Audits are written only for an outcome the database actually committed.
  await logAuditEvent({
    shopId,
    disputeId,
    actorType: "system",
    eventType: "defence_package_finalized",
    eventPayload: {
      packageId,
      version: packageVersion,
      source: "finalize_and_enqueue_save",
      jobId: result.job_id ?? null,
    },
  });

  if (result.superseded_id) {
    await logAuditEvent({
      shopId,
      disputeId,
      actorType: "system",
      eventType: "defence_package_superseded",
      eventPayload: {
        supersededId: result.superseded_id,
        supersededVersion: result.superseded_version ?? null,
        replacedById: packageId,
        replacedByVersion: packageVersion,
      },
    });
  }

  return { ok: true };
}
