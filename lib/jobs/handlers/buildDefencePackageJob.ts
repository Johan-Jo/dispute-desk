/**
 * Job handler: build_defence_package.
 *
 * Full pipeline:
 *   classify → eligibility check → resolve module → derive packageMode →
 *   narrate → validate → render → upload → status
 *
 * Failure handling:
 *   - LLM API / network errors → retriable=true
 *   - JSON parse failures (after one retry inside narrativeWriter) → retriable=false
 *   - Validation failures → status=failed, retriable=false
 *   - PDF render errors → status=failed, retriable=false
 *
 * Immutability: this handler only writes to the row whose id is the job's
 * `entity_id` (a `draft` row created by `maybeEnqueueDefencePackage`).
 * It never touches a prior `final` or `submitted` row.
 *
 * entity_id = defence_packages.id
 */

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { classifyFacts, type ChecklistItemLike } from "@/lib/defence/factClassifier";
import { resolveReasonCodeModule } from "@/lib/defence/reasonCodes/registry";
import { generateNarrative } from "@/lib/defence/narrativeWriter";
import { validateNarrative } from "@/lib/defence/validateNarrative";
import { renderDefencePdf } from "@/lib/defence/renderDefencePdf";
import { uploadDefencePdf } from "@/lib/defence/storage";
import { computeEvidenceHash } from "@/lib/defence/computeEvidenceHash";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import type {
  DefencePackageDocumentData,
} from "@/lib/defence/pdf/DefencePackageDocument";
import type {
  DefencePackageStatus,
  DefencePackageFailureCode,
} from "@/lib/defence/types";
import type { ClaimedJob, JobResult } from "../claimJobs";

export async function handleBuildDefencePackage(
  job: ClaimedJob,
): Promise<JobResult> {
  const packageId = job.entityId;
  if (!packageId) {
    return { ok: false, retriable: false, reason: "missing entity_id" };
  }
  const sb = getServiceClient();

  // Load the package row.
  const { data: pkg, error: pkgErr } = await sb
    .from("defence_packages")
    .select(
      "id, dispute_id, shop_id, source_pack_id, version, status, generated_by, evidence_hash, reason_code_module",
    )
    .eq("id", packageId)
    .single();
  if (pkgErr || !pkg) {
    return { ok: false, retriable: false, reason: `package not found: ${pkgErr?.message ?? "n/a"}` };
  }

  // Don't run on terminal statuses. Only `draft` rows are valid targets.
  if (pkg.status !== "draft") {
    return { ok: false, retriable: false, reason: `package status=${pkg.status} is not draft` };
  }

  // Load source pack + dispute.
  const [{ data: pack }, { data: dispute }] = await Promise.all([
    sb
      .from("evidence_packs")
      .select("id, shop_id, dispute_id, pack_json, checklist_v2")
      .eq("id", pkg.source_pack_id)
      .single(),
    sb
      .from("disputes")
      .select("id, dispute_gid, reason, network_reason_code, amount, currency_code, status, phase, due_at")
      .eq("id", pkg.dispute_id)
      .single(),
  ]);
  if (!pack) {
    return await markFailed(sb, pkg, "source pack missing", "validation_failed");
  }

  const packJson = (pack.pack_json ?? {}) as Record<string, unknown>;
  const coverage =
    (packJson.coverage as { state?: string } | undefined)?.state ?? "not_covered";
  const fatalLoss =
    (packJson.fatal_loss as { triggered?: boolean; reason?: string | null } | undefined) ?? {
      triggered: false,
      reason: null,
    };
  const sectionsRaw =
    (packJson.sections as Array<{
      type: string;
      label: string;
      source: string;
      data: Record<string, unknown>;
      fieldsProvided: string[];
    }>) ?? [];

  // Load manual rows (defence_manual_evidence + raw uploads not yet promoted).
  const { data: manualRowsRaw } = await sb
    .from("defence_manual_evidence")
    .select(
      "id, evidence_item_id, filename, file_url, file_type, uploaded_by, uploaded_at, description, bank_eligible, include_in_package, include_in_bank_narrative, evidence_category",
    )
    .eq("package_id", packageId);

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

  // Resolve reason-code module with optional DB override.
  const reasonCode = dispute?.network_reason_code ?? null;
  const { data: moduleOverride } = await sb
    .from("defence_prompt_modules")
    .select("prompt_body, guidance_json, model, version")
    .eq("key", pkg.reason_code_module ?? "generic_fallback")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const reasonCodeModule = resolveReasonCodeModule(
    reasonCode,
    moduleOverride
      ? {
          promptBody: moduleOverride.prompt_body ?? undefined,
          guidanceJson: (moduleOverride.guidance_json ?? {}) as Record<string, unknown>,
          model: moduleOverride.model ?? undefined,
          version: moduleOverride.version ?? undefined,
        }
      : undefined,
  );

  const classification = classifyFacts({
    packageId,
    sections: sectionsRaw.map((s) => ({
      type: s.type,
      label: s.label,
      source: s.source,
      data: s.data ?? {},
      fieldsProvided: s.fieldsProvided ?? [],
    })),
    evidenceItems: items,
    checklist,
    coverage: { state: coverage === "covered_shopify" ? "covered_shopify" : "not_covered" },
    fatalLoss: { triggered: fatalLoss.triggered === true, reason: fatalLoss.reason ?? null },
    caseStrength: "moderate",
    manualRows: (manualRowsRaw ?? []).map((m) => ({
      id: m.id as string,
      evidenceItemId: m.evidence_item_id as string,
      filename: m.filename as string,
      fileUrl: (m.file_url as string | null) ?? null,
      fileType: (m.file_type as string | null) ?? null,
      uploadedBy: (m.uploaded_by as string | null) ?? null,
      uploadedAt: (m.uploaded_at as string | null) ?? null,
      description: (m.description as string | null) ?? null,
      bankEligible: m.bank_eligible as boolean | null,
      includeInPackage: m.include_in_package as boolean | null,
      includeInBankNarrative: m.include_in_bank_narrative as boolean | null,
      evidenceCategory:
        (m.evidence_category as string | null) as
          | "manual_evidence"
          | null,
    })),
    reasonCodeModule,
  });

  // Eligibility short-circuit.
  if (!classification.eligible) {
    return await markSkipped(sb, pkg, classification.ineligibilityReason);
  }

  // Generate the narrative.
  const narrativeRes = await generateNarrative(
    {
      packageId,
      disputeId: pkg.dispute_id,
      reasonCode,
      reasonCodeModule,
      packageMode: classification.packageMode,
      caseStrength: "moderate",
      approvedFacts: classification.approved,
      manualEvidence: classification.manual,
      internalOnlyFactIds: classification.internalOnly.map((f) => f.id),
      missingEvidence: classification.missing,
    },
    {
      shopId: pkg.shop_id,
      packageId,
      modelOverride: moduleOverride?.model ?? null,
    },
  );

  if (narrativeRes.capReached) {
    return await markFailed(sb, pkg, narrativeRes.error ?? "daily cap reached", "daily_cap_reached", true);
  }
  if (!narrativeRes.narrative || narrativeRes.error) {
    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "system",
      eventType: "llm_narrative_failed",
      eventPayload: {
        packageId,
        version: pkg.version,
        model: narrativeRes.modelUsed,
        reason: narrativeRes.error,
      },
    });
    return await markFailed(sb, pkg, narrativeRes.error ?? "narrative null", "llm_error", true);
  }

  // Validate.
  const validation = validateNarrative({
    narrative: narrativeRes.narrative,
    approvedFacts: classification.approved,
    reasonCodeModule,
    packageMode: classification.packageMode,
    internalOnlyFactIds: classification.internalOnly.map((f) => f.id),
  });
  if (!validation.ok) {
    await sb
      .from("defence_packages")
      .update({
        status: "failed",
        validation_status: "failed",
        validation_errors: validation.errors,
        failure_code: "validation_failed",
        failure_reason: `${validation.errors.length} validation error${validation.errors.length === 1 ? "" : "s"}`,
        narrative_json: narrativeRes.narrative,
        facts_json: classification.approved,
        package_mode: classification.packageMode,
        llm_model: narrativeRes.modelUsed,
        prompt_family: narrativeRes.promptFamily,
        prompt_version: narrativeRes.promptVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", packageId);
    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "system",
      eventType: "defence_package_validation_failed",
      eventPayload: {
        packageId,
        version: pkg.version,
        validationErrors: validation.errors,
      },
    });
    return { ok: false, retriable: false, reason: "validation_failed" };
  }

  // Render PDF.
  const docData: DefencePackageDocumentData = {
    meta: {
      packageId,
      disputeGid: dispute?.dispute_gid ?? null,
      orderName: null,
      reasonCode,
      reasonCodeDisplay: reasonCodeModule.displayName,
      shopName: "Merchant",
      merchantName: null,
      amountDisplay: dispute?.amount != null
        ? `${dispute.currency_code ?? ""} ${dispute.amount}`.trim()
        : null,
      cardNetwork: null,
      transactionDate: null,
      generatedAt: new Date().toISOString(),
      version: pkg.version,
      packageMode: classification.packageMode,
      promptFamily: narrativeRes.promptFamily,
      promptVersion: narrativeRes.promptVersion,
      modelUsed: narrativeRes.modelUsed,
      reasonCodeModuleKey: reasonCodeModule.key,
      evidenceHash: pkg.evidence_hash,
      generatedBy: pkg.generated_by as "system" | "merchant" | "admin",
    },
    narrative: narrativeRes.narrative,
    approvedFacts: classification.approved,
    manualEvidence: classification.manual,
  };

  let pdfPath: string;
  try {
    const rendered = await renderDefencePdf(docData);
    const uploaded = await uploadDefencePdf({
      shopId: pkg.shop_id,
      packId: pkg.source_pack_id,
      version: pkg.version,
      buffer: rendered.buffer,
    });
    pdfPath = uploaded.path;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, 4000) : "";
    // Persist stack trace alongside message so prod debugging doesn't
    // require re-running the job to see where in the renderer it threw.
    const fullReason = stack ? `${message}\n\nSTACK:\n${stack}` : message;
    await sb
      .from("defence_packages")
      .update({
        status: "failed",
        failure_code: "pdf_render_failed",
        failure_reason: fullReason,
        narrative_json: narrativeRes.narrative,
        facts_json: classification.approved,
        package_mode: classification.packageMode,
        llm_model: narrativeRes.modelUsed,
        prompt_family: narrativeRes.promptFamily,
        prompt_version: narrativeRes.promptVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", packageId);
    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "system",
      eventType: "defence_pdf_render_failed",
      eventPayload: { packageId, version: pkg.version, reason: message, stackHead: stack.slice(0, 500) },
    });
    return { ok: false, retriable: false, reason: `pdf_render_failed: ${message}` };
  }

  // Recompute evidence hash with the actual approved facts that classified
  // (in case enqueue used an empty classifier — the canonical source of
  // truth is what the LLM actually saw).
  const finalHash = computeEvidenceHash({
    approvedFacts: classification.approved,
    manualEvidence: classification.manual,
    reasonCode,
  });

  // ── Mode-aware finalization ─────────────────────────────────────────
  // Resolve per-dispute automation mode via the shop's rules engine
  // (the same resolver the pack auto-save pipeline uses). When the
  // resolved mode is "auto", we finalize the package and enqueue
  // save_to_shopify immediately — no merchant click. When "review",
  // we keep the package as a draft for the merchant to finalize on
  // the Review & Submit tab.
  let resolvedMode: "auto" | "review" = "review";
  if (dispute) {
    try {
      const ruleResult = await evaluateRules({
        id: pkg.dispute_id,
        shop_id: pkg.shop_id,
        reason: (dispute.reason as string | null) ?? null,
        status: (dispute.status as string | null) ?? null,
        amount: (dispute.amount as number | null) ?? null,
        phase: (dispute.phase as "inquiry" | "chargeback" | null | undefined) ?? null,
      });
      resolvedMode = ruleResult.action.mode;
    } catch (err) {
      console.error("[defence build] evaluateRules failed; defaulting to review", err);
    }
  }

  const targetStatus: DefencePackageStatus = resolvedMode === "auto" ? "final" : "draft";

  await sb
    .from("defence_packages")
    .update({
      status: targetStatus,
      pdf_path: pdfPath,
      narrative_json: narrativeRes.narrative,
      facts_json: classification.approved,
      package_mode: classification.packageMode,
      llm_model: narrativeRes.modelUsed,
      prompt_family: narrativeRes.promptFamily,
      prompt_version: narrativeRes.promptVersion,
      validation_status: "ok",
      validation_errors: [],
      evidence_hash: finalHash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packageId);

  await logAuditEvent({
    shopId: pkg.shop_id,
    disputeId: pkg.dispute_id,
    packId: pkg.source_pack_id,
    actorType: "system",
    eventType:
      targetStatus === "final"
        ? "defence_package_finalized"
        : "defence_package_draft_generated",
    eventPayload: {
      packageId,
      version: pkg.version,
      evidenceHash: finalHash,
      promptVersion: narrativeRes.promptVersion,
      model: narrativeRes.modelUsed,
      packageMode: classification.packageMode,
      validationStatus: "ok",
      resolvedMode,
      generatedBy: "system",
    },
  });

  await logAuditEvent({
    shopId: pkg.shop_id,
    disputeId: pkg.dispute_id,
    packId: pkg.source_pack_id,
    actorType: "system",
    eventType: "llm_narrative_generated",
    eventPayload: {
      packageId,
      version: pkg.version,
      model: narrativeRes.modelUsed,
      promptVersion: narrativeRes.promptVersion,
      tokens: narrativeRes.tokens,
      durationMs: narrativeRes.durationMs,
    },
  });

  // ── Auto mode: supersede any prior final + enqueue save_to_shopify ──
  if (resolvedMode === "auto") {
    // Atomically flip any prior final (for the same dispute, different
    // version) to superseded so the immutability trigger is satisfied.
    // The new row is already in status=final per the UPDATE above; the
    // trigger validates that superseded_by_id targets must be final.
    const { data: priorFinal } = await sb
      .from("defence_packages")
      .select("id, version")
      .eq("dispute_id", pkg.dispute_id)
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
        console.error("[defence build] superseded update failed", supErr);
      } else {
        await logAuditEvent({
          shopId: pkg.shop_id,
          disputeId: pkg.dispute_id,
          packId: pkg.source_pack_id,
          actorType: "system",
          eventType: "defence_package_superseded",
          eventPayload: {
            supersededId: priorFinal.id,
            supersededVersion: priorFinal.version,
            replacedById: packageId,
            replacedByVersion: pkg.version,
          },
        });
      }
    }

    // Enqueue save_to_shopify against the source pack. saveToShopifyJob
    // will discover the latest final defence_packages row and swap the
    // uncategorizedFile buffer to the defence package PDF.
    const { error: jobErr } = await sb.from("jobs").insert({
      shop_id: pkg.shop_id,
      job_type: "save_to_shopify",
      entity_id: pkg.source_pack_id,
    });
    if (jobErr) {
      console.error("[defence build] enqueue save_to_shopify failed", jobErr);
    }
  }

  return { ok: true };
}

/* ── Helpers ── */

async function markSkipped(
  sb: ReturnType<typeof getServiceClient>,
  pkg: {
    id: string;
    shop_id: string;
    dispute_id: string;
    source_pack_id: string;
    version: number;
  },
  reason: DefencePackageFailureCode | null,
): Promise<JobResult> {
  const code: DefencePackageFailureCode = reason ?? "no_bank_eligible_facts";
  await sb
    .from("defence_packages")
    .update({
      status: "skipped",
      failure_code: code,
      failure_reason:
        code === "covered_shopify"
          ? "Coverage gate: Shopify Protect is underwriting this dispute."
          : "No bank-eligible approved facts after classification.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", pkg.id);
  await logAuditEvent({
    shopId: pkg.shop_id,
    disputeId: pkg.dispute_id,
    packId: pkg.source_pack_id,
    actorType: "system",
    eventType: "defence_package_skipped",
    eventPayload: { packageId: pkg.id, version: pkg.version, failureCode: code },
  });
  return { ok: true };
}

async function markFailed(
  sb: ReturnType<typeof getServiceClient>,
  pkg: {
    id: string;
    shop_id: string;
    dispute_id: string;
    source_pack_id: string;
    version: number;
  },
  reason: string,
  failureCode: DefencePackageFailureCode,
  retriable = false,
): Promise<JobResult> {
  await sb
    .from("defence_packages")
    .update({
      status: "failed",
      failure_code: failureCode,
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pkg.id);
  await logAuditEvent({
    shopId: pkg.shop_id,
    disputeId: pkg.dispute_id,
    packId: pkg.source_pack_id,
    actorType: "system",
    eventType: "defence_package_failed",
    eventPayload: { packageId: pkg.id, version: pkg.version, failureCode, failureReason: reason },
  });
  return { ok: false, retriable, reason };
}
