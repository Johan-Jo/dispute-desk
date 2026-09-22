/**
 * Defence Package enqueue logic.
 *
 * Called from `lib/jobs/handlers/buildPackJob.ts` after a successful build,
 * and from regenerate routes. Owns version-bumping, stale detection, and
 * coverage-gated `skipped` row insertion.
 *
 * Immutability invariant: never mutates a prior `final` or `submitted`
 * row. Evidence changes after a `final` exists create a NEW draft at
 * `version=N+1`. The prior `final` is flipped to `superseded` only by
 * `app/api/defence-packages/[id]/finalize/route.ts`, after the new draft
 * itself reaches `final`.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { isDefencePackageBuilderEnabled } from "@/lib/featureFlags";
import {
  evaluateGenerationGuard,
  generationBlockPayload,
} from "./latestPackageGenerationGuard";
import { computeEvidenceHash } from "./computeEvidenceHash";
import { CURRENT_PROMPT_VERSION } from "./narrativeWriter";
import { VALIDATOR_VERSION } from "./validateNarrative";
import { COMPOSITION_VERSION } from "./pdf/thesisTemplates";
import { classifyFacts } from "./factClassifier";
import {
  resolveReasonCodeModule,
  resolveReasonCodeModuleForContext,
} from "./reasonCodes/registry";
import { isNonCardPaymentFamily } from "@/lib/disputes/paymentContext";
import type { DefencePackageStatus } from "./types";

export interface MaybeEnqueueResult {
  enqueued: boolean;
  reason: string;
  packageId: string | null;
  version: number | null;
  status: DefencePackageStatus | null;
}

/**
 * Inspect the latest defence_packages row for the dispute and decide what
 * to do. Cases (in priority order):
 *
 *   a) flag off → no-op.
 *   b) coverage-gated → insert `status=skipped` row, no job enqueued.
 *   c) latest is `draft` with matching hash → idempotent, no-op.
 *   d) latest is `draft` with diverging hash → flip that draft to `stale`,
 *      insert a NEW draft at version+1, enqueue build job.
 *   e) latest is `final` / `submitted` → DO NOT MUTATE. Insert a new draft
 *      at version+1, enqueue build job. Old final/submitted row stays
 *      immutable; supersession happens only in finalize route.
 *   f) latest is `superseded` / `failed` / `skipped` → treat like no
 *      prior; insert new draft at version+1.
 *   g) no prior row → insert draft at version=1.
 *
 * Stale-marking of an existing draft is allowed here (drafts are
 * mutable). The immutability trigger blocks anything trying to mutate a
 * final/submitted/superseded row.
 */
export async function maybeEnqueueDefencePackage(
  packId: string,
): Promise<MaybeEnqueueResult> {
  if (!isDefencePackageBuilderEnabled()) {
    return { enqueued: false, reason: "flag_off", packageId: null, version: null, status: null };
  }

  const sb = getServiceClient();

  // Load pack + dispute + pack_json.
  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, pack_json, completeness_score")
    .eq("id", packId)
    .single();
  if (packErr || !pack) {
    return { enqueued: false, reason: "pack_not_found", packageId: null, version: null, status: null };
  }
  if (!pack.dispute_id) {
    return { enqueued: false, reason: "no_dispute", packageId: null, version: null, status: null };
  }
  if (pack.status !== "ready" && pack.status !== "saved_to_shopify" && pack.status !== "saving") {
    return { enqueued: false, reason: `pack_status_${pack.status}`, packageId: null, version: null, status: null };
  }

  const packJson = (pack.pack_json ?? {}) as Record<string, unknown>;
  const coverage = (packJson.coverage as { state?: string } | undefined)?.state ?? "not_covered";
  const fatalLoss =
    (packJson.fatal_loss as { triggered?: boolean; reason?: string | null } | undefined) ?? {
      triggered: false,
      reason: null,
    };
  const sections =
    ((packJson.sections as Array<{
      type: string;
      label: string;
      source: string;
      data: Record<string, unknown>;
      fieldsProvided: string[];
    }>) ?? []).map((s) => ({
      type: s.type,
      label: s.label,
      source: s.source,
      data: s.data ?? {},
      fieldsProvided: s.fieldsProvided ?? [],
    }));

  // Look up dispute for reason code.
  const { data: dispute } = await sb
    .from("disputes")
    .select("id, network_reason_code, reason")
    .eq("id", pack.dispute_id)
    .single();
  const reasonCode = dispute?.network_reason_code ?? null;
  // BNPL/local methods (Klarna, Affirm) have no network reason code; route
  // the module off the Shopify reason enum instead of collapsing to
  // generic_fallback. Card disputes keep routing on the network code.
  const paymentFamily =
    (packJson.payment_context as { family?: string } | undefined)?.family ?? null;
  const isNonCardPayment = isNonCardPaymentFamily(paymentFamily);
  const reasonCodeModule = isNonCardPayment
    ? resolveReasonCodeModuleForContext(reasonCode, dispute?.reason ?? null)
    : resolveReasonCodeModule(reasonCode);

  // Load evidence_items + manual rows + checklist for hash + classification.
  const { data: items } = await sb
    .from("evidence_items")
    .select("id, payload, source")
    .eq("pack_id", packId);
  const { data: checklistRows } = await sb
    .from("evidence_packs")
    .select("checklist_v2")
    .eq("id", packId)
    .single();
  const checklist =
    (checklistRows?.checklist_v2 as Array<{ field: string; status: string }> | null)?.map((c) => ({
      field: c.field,
      status: c.status as "available" | "waived" | "missing" | "not_applicable",
    })) ?? [];

  // Classify so we can hash the eligible facts. The classifier short-circuits
  // on covered_shopify, so we handle that case separately.
  if (coverage === "covered_shopify") {
    return await insertSkippedRow(sb, {
      packId,
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      reason: "covered_shopify",
      message: "Coverage gate: Shopify Protect is underwriting this dispute.",
    });
  }

  const classification = classifyFacts({
    packageId: "transient",
    sections,
    evidenceItems: (items ?? []).map((it) => ({
      id: it.id as string,
      payload: it.payload as (Record<string, unknown> & { fieldsProvided?: string[] }) | null,
      source: (it.source as string | null) ?? null,
    })),
    checklist,
    coverage: { state: "not_covered" },
    fatalLoss: {
      triggered: fatalLoss.triggered === true,
      reason: fatalLoss.reason ?? null,
    },
    caseStrength: "moderate",
    manualRows: [],
    reasonCodeModule,
  });

  const evidenceHash = computeEvidenceHash({
    approvedFacts: classification.approved,
    manualEvidence: classification.manual,
    reasonCode,
  });

  // Look at the latest existing row.
  const { data: latest } = await sb
    .from("defence_packages")
    .select(
      "id, version, status, evidence_hash, validation_status, failure_code, prompt_version, validator_version, composition_version",
    )
    .eq("dispute_id", pack.dispute_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  /* ── A FAILURE MAY BE RETRIED ONLY WHEN SOMETHING HAS CHANGED ────────
   *
   * Checked BEFORE the idempotent-draft branch and before `nextVersion` is
   * computed, because everything below this point either writes a row or
   * mutates one. On 2026-08-11 a case whose newest package was
   * `failed` / `validation_failed` was rebuilt: the function had no opinion
   * about failed rows, so it inserted the next version and enqueued a
   * regeneration that failed the same way.
   *
   * The guard stops that loop. What it must NOT do is outlive the defect: a
   * package that failed under rules we have since changed is a new attempt,
   * not a repeat, and blocking it leaves the case dead after the fix ships.
   * Measured 2026-08-12 that cost `#12936` three weeks past its deadline and
   * `#353605` its deadline outright.
   *
   * So the current generator version, validator version and evidence hash go
   * in, and the guard decides. All three come from this scope — the hash is
   * already computed above for the idempotency check, so there is no second
   * derivation and no second answer. */
  const guard = evaluateGenerationGuard(latest, {
    promptVersion: CURRENT_PROMPT_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    compositionVersion: COMPOSITION_VERSION,
    evidenceHash,
  });
  if (!guard.blocked && guard.retryBasis.length > 0) {
    /* A failed package is being retried. Audited explicitly — this is the one
     * path that writes over a prior failure, and an operator reading the trail
     * must see WHY it was allowed, not just that a new version appeared. */
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "defence_package_failure_retried",
      eventPayload: {
        previousPackageId: latest?.id ?? null,
        previousVersion: latest?.version ?? null,
        previousFailureCode: latest?.failure_code ?? null,
        retryBasis: guard.retryBasis,
        promptVersion: CURRENT_PROMPT_VERSION,
        validatorVersion: VALIDATOR_VERSION,
      },
    });
  }
  if (guard.blocked) {
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "defence_package_generation_skipped",
      eventPayload: generationBlockPayload(guard),
    });
    return {
      enqueued: false,
      reason: guard.reason as string,
      packageId: guard.blockingPackageId,
      version: guard.blockingVersion,
      status: (latest?.status as DefencePackageStatus | null) ?? null,
    };
  }

  const nextVersion = latest ? latest.version + 1 : 1;

  /* ── IDEMPOTENT ONLY WHEN *NOTHING* HAS MOVED ────────────────────────
   *
   * The skip used to compare evidence alone, so a draft with an unchanged
   * hash was unrebuildable through EVERY caller — the pack-rebuild path and
   * the merchant's Regenerate button both funnel through this function, and
   * neither had a way past this branch. A prompt or validator release
   * therefore never reached existing drafts: on 2026-08-16 one of two
   * post-fix verification rebuilds was silently eaten here (no audit event,
   * `enqueued: false`), and during activation this same branch would have
   * left every draft stranded on prompt 15 with no path to a verdict.
   *
   * The failure-retry guard above already answers the identical question for
   * `failed` rows — "has prompt, validator or evidence moved since this row
   * was built?" — so the draft branch now asks about the same three inputs
   * rather than one of them. A draft built under older guidance falls
   * through: the branch below marks it stale and versions a fresh build,
   * exactly as if the evidence had moved. NULL versions on pre-versioning
   * rows read as "not recorded", which counts as moved — the guard's own
   * precedent (#565).
   */
  if (
    latest &&
    latest.status === "draft" &&
    latest.evidence_hash === evidenceHash &&
    latest.prompt_version === CURRENT_PROMPT_VERSION &&
    latest.validator_version === VALIDATOR_VERSION
  ) {
    return {
      enqueued: false,
      reason: "idempotent_match",
      packageId: latest.id,
      version: latest.version,
      status: "draft",
    };
  }

  // If latest is a `draft` with diverging hash, mark it stale.
  if (latest && latest.status === "draft") {
    await sb
      .from("defence_packages")
      .update({ status: "stale", updated_at: new Date().toISOString() })
      .eq("id", latest.id);
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "defence_package_stale",
      eventPayload: {
        packageId: latest.id,
        version: latest.version,
        previousHash: latest.evidence_hash,
        newHash: evidenceHash,
        /* A guidance refresh reaches this branch with previousHash ===
         * newHash, which an operator would otherwise read as a bug. Name
         * which inputs actually moved. */
        trigger:
          latest.evidence_hash === evidenceHash ? "guidance_refresh" : "pack_rebuild",
        promptVersionMoved: latest.prompt_version !== CURRENT_PROMPT_VERSION,
        validatorVersionMoved: latest.validator_version !== VALIDATOR_VERSION,
      },
    });
  }

  // Insert new draft row at nextVersion.
  const { data: inserted, error: insertErr } = await sb
    .from("defence_packages")
    .insert({
      dispute_id: pack.dispute_id,
      shop_id: pack.shop_id,
      source_pack_id: packId,
      version: nextVersion,
      status: "draft",
      generated_by: "system",
      evidence_hash: evidenceHash,
      reason_code_module: reasonCodeModule.key,
    })
    .select("id, version")
    .single();
  if (insertErr || !inserted) {
    throw new Error(`Failed to insert defence_packages row: ${insertErr?.message ?? "unknown"}`);
  }

  // Enqueue the build job.
  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_defence_package",
    entity_id: inserted.id,
  });
  if (jobErr) {
    throw new Error(`Failed to enqueue build_defence_package: ${jobErr.message}`);
  }

  return {
    enqueued: true,
    reason: "new_draft",
    packageId: inserted.id,
    version: inserted.version,
    status: "draft",
  };
}

async function insertSkippedRow(
  sb: ReturnType<typeof getServiceClient>,
  args: {
    packId: string;
    shopId: string;
    disputeId: string;
    reason: "covered_shopify" | "no_bank_eligible_facts";
    message: string;
  },
): Promise<MaybeEnqueueResult> {
  const { data: latest } = await sb
    .from("defence_packages")
    .select("version")
    .eq("dispute_id", args.disputeId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = latest ? latest.version + 1 : 1;

  const { data: inserted, error } = await sb
    .from("defence_packages")
    .insert({
      dispute_id: args.disputeId,
      shop_id: args.shopId,
      source_pack_id: args.packId,
      version: nextVersion,
      status: "skipped",
      generated_by: "system",
      evidence_hash: `skipped_${args.reason}`,
      failure_code: args.reason,
      failure_reason: args.message,
    })
    .select("id, version")
    .single();
  if (error || !inserted) {
    throw new Error(`Failed to insert skipped defence row: ${error?.message ?? "unknown"}`);
  }

  await logAuditEvent({
    shopId: args.shopId,
    disputeId: args.disputeId,
    packId: args.packId,
    actorType: "system",
    eventType: "defence_package_skipped",
    eventPayload: {
      packageId: inserted.id,
      version: inserted.version,
      failureCode: args.reason,
      failureReason: args.message,
    },
  });

  return {
    enqueued: false,
    reason: args.reason,
    packageId: inserted.id,
    version: inserted.version,
    status: "skipped",
  };
}
