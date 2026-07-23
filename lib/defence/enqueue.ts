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
import { computeEvidenceHash } from "./computeEvidenceHash";
import { classifyFacts } from "./factClassifier";
import {
  resolveReasonCodeModule,
  resolveReasonCodeModuleForContext,
} from "./reasonCodes/registry";
import { isNonCardPaymentFamily } from "@/lib/disputes/paymentContext";
import { JOB_PRIORITY_DEFAULT } from "@/lib/jobs/priorities";
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
  opts: { priority?: number } = {},
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
    .select("id, version, status, evidence_hash")
    .eq("dispute_id", pack.dispute_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = latest ? latest.version + 1 : 1;

  // Idempotent skip if latest is a draft with matching hash.
  if (
    latest &&
    latest.status === "draft" &&
    latest.evidence_hash === evidenceHash
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
        trigger: "pack_rebuild",
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

  // Enqueue the build job. The priority is inherited from the caller
  // (buildPackJob passes its own job's priority) so a chain started by
  // a merchant click stays interactive-tier end to end instead of
  // falling to the back of the shop's queue behind bulk work.
  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_defence_package",
    entity_id: inserted.id,
    priority: opts.priority ?? JOB_PRIORITY_DEFAULT,
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
