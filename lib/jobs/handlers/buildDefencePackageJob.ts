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
import {
  resolveReasonCodeModule,
  resolveReasonCodeModuleForContext,
  familyKeyForModule,
} from "@/lib/defence/reasonCodes/registry";
import { getFamily } from "@/lib/defence/reasonCodes/familyRegistry";
import { isNonCardPaymentFamily } from "@/lib/disputes/paymentContext";
import type { KlarnaSubProduct } from "@/lib/disputes/paymentContext";
import { klarnaDisputeCategoryDisplay } from "@/lib/defence/klarnaDisputeCategory";
import { paymentOverlayFor } from "@/lib/defence/paymentOverlays";
import { generateNarrative } from "@/lib/defence/narrativeWriter";
import {
  validateNarrative,
  validateComposedDocument,
  summariseComposedErrors,
} from "@/lib/defence/validateNarrative";
import { rankStrategies } from "@/lib/defence/strategies/registry";
import { composePdfBlocks } from "@/lib/defence/pdf/composePdfBlocks";
import { renderDefencePdf } from "@/lib/defence/renderDefencePdf";
import { uploadDefencePdf } from "@/lib/defence/storage";
import { computeEvidenceHash } from "@/lib/defence/computeEvidenceHash";
import { deriveOrderContext, merchantNameFromDomain } from "@/lib/defence/orderContext";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { finalizeAndEnqueueSave } from "@/lib/automation/finalizeAndEnqueueSave";
import { evaluateAutoSubmitGuards } from "@/lib/automation/autoSubmitGuards";
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

  // Load source pack + dispute + shop.
  const [{ data: pack }, { data: dispute }, { data: shop }] = await Promise.all([
    sb
      .from("evidence_packs")
      .select("id, shop_id, dispute_id, pack_json, checklist_v2")
      .eq("id", pkg.source_pack_id)
      .single(),
    sb
      .from("disputes")
      .select("id, dispute_gid, reason, network_reason_code, amount, currency_code, status, phase, due_at, customer_display_name")
      .eq("id", pkg.dispute_id)
      .single(),
    sb
      .from("shops")
      .select("id, shop_domain")
      .eq("id", pkg.shop_id)
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
  // BNPL/local methods (Klarna, Affirm) carry no network reason code —
  // route the module off the Shopify reason enum so they reuse the right
  // reason module instead of generic_fallback. Card path is unchanged.
  const paymentContext =
    (packJson.payment_context as { family?: string } | undefined) ?? null;
  const isNonCardPayment = isNonCardPaymentFamily(paymentContext?.family ?? null);
  const { data: moduleOverride } = await sb
    .from("defence_prompt_modules")
    .select("prompt_body, guidance_json, model, version")
    .eq("key", pkg.reason_code_module ?? "generic_fallback")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const moduleOverrideInput = moduleOverride
    ? {
        promptBody: moduleOverride.prompt_body ?? undefined,
        guidanceJson: (moduleOverride.guidance_json ?? {}) as Record<string, unknown>,
        model: moduleOverride.model ?? undefined,
        version: moduleOverride.version ?? undefined,
      }
    : undefined;
  const reasonCodeModule = isNonCardPayment
    ? resolveReasonCodeModuleForContext(reasonCode, dispute?.reason ?? null, moduleOverrideInput)
    : resolveReasonCodeModule(reasonCode, moduleOverrideInput);

  // Resolve the family (Phase 1). One family per module today; the
  // family's overlayPromptBody fills in cross-cutting rules that span
  // multiple modules — empty in Phase 1, populated as patterns emerge.
  const reasonCodeFamily = getFamily(familyKeyForModule(reasonCodeModule.key));

  // Persist family_key early so every subsequent failure path captures
  // it in defence_packages — admin tooling groups runs by family for
  // rollback investigation.
  await sb
    .from("defence_packages")
    .update({ family_key: reasonCodeFamily.key })
    .eq("id", packageId);

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

  // Phase 3 — rank strategy submodules for this dispute. Empty result
  // (family has no strategies yet) is fine; the narrative writer
  // simply doesn't emit the 4th cached system block.
  const strategies = rankStrategies({
    familyKey: reasonCodeFamily.key,
    predicateEvaluations: classification.predicateEvaluations,
    packageMode: classification.packageMode,
  });

  // Payment-method overlay (BNPL / Klarna / Affirm). Non-null only for
  // non-card disputes; reframes the narrative to the actual method and
  // supplies the card-term phrases that validateNarrative hard-rejects.
  // For Klarna we pass the dispute reason + sub-product so the overlay is
  // category-aware (Goods-Not-Received → POD/MPP guidance, etc.).
  const klarnaSubProduct =
    (packJson.payment_context as { klarnaSubProduct?: KlarnaSubProduct | null } | undefined)
      ?.klarnaSubProduct ?? null;
  const { overlay: paymentOverlay, prohibitedPhrases: paymentProhibited } =
    paymentOverlayFor(paymentContext?.family ?? null, {
      shopifyReason: dispute?.reason ?? null,
      subProduct: klarnaSubProduct,
    });

  // Generate the narrative.
  const narrativeRes = await generateNarrative(
    {
      packageId,
      disputeId: pkg.dispute_id,
      reasonCode,
      reasonCodeModule,
      familyOverlay: reasonCodeFamily.overlayPromptBody || null,
      paymentOverlay,
      strategies,
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

  // Validate. If a fact-grounding guard fires (e.g. the LLM wrote
  // "dispatched" in chronologyArgument without a delivery fact), we
  // retry the narrative call ONCE with the validator errors fed back
  // into the user payload. The LLM treats `retryGuidance` as priority
  // context and corrects much more reliably than expecting it to
  // re-read the rules list on the next regenerate.
  // Merge family-level banned phrases with payment-method banned phrases
  // (BNPL disputes must never cite card-network artifacts).
  const hardPhrases = [
    ...reasonCodeFamily.prohibitedBankPhrases,
    ...paymentProhibited,
  ];
  let validation = validateNarrative({
    narrative: narrativeRes.narrative,
    approvedFacts: classification.approved,
    reasonCodeModule,
    packageMode: classification.packageMode,
    internalOnlyFactIds: classification.internalOnly.map((f) => f.id),
    extraHardPhrases: hardPhrases,
    guardedPhrases: reasonCodeFamily.guardedBankPhrases,
  });
  if (!validation.ok) {
    const feedback = validation.errors.map(
      (e) =>
        `${e.section ?? "narrative"}: ${e.message ?? "validation failed"}`,
    );
    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "system",
      eventType: "defence_package_validation_retry",
      eventPayload: {
        packageId,
        version: pkg.version,
        attemptNumber: 2,
        validationErrors: validation.errors,
      },
    });
    const retryRes = await generateNarrative(
      {
        packageId,
        disputeId: pkg.dispute_id,
        reasonCode,
        reasonCodeModule,
        familyOverlay: reasonCodeFamily.overlayPromptBody || null,
        paymentOverlay,
        strategies,
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
        validationFeedback: feedback,
      },
    );
    if (retryRes.capReached) {
      return await markFailed(sb, pkg, retryRes.error ?? "daily cap reached", "daily_cap_reached", true);
    }
    if (!retryRes.narrative || retryRes.error) {
      // Retry attempt errored or returned no narrative. Fall through
      // with the original validation failure — that's what the
      // merchant needs to act on.
    } else {
      // Re-validate the retry output. If it still fails, persist the
      // retry result (closer to correct than the first attempt) along
      // with its errors.
      const retryValidation = validateNarrative({
        narrative: retryRes.narrative,
        approvedFacts: classification.approved,
        reasonCodeModule,
        packageMode: classification.packageMode,
        internalOnlyFactIds: classification.internalOnly.map((f) => f.id),
        extraHardPhrases: hardPhrases,
        guardedPhrases: reasonCodeFamily.guardedBankPhrases,
      });
      // Reassign so the rest of the pipeline uses the better output.
      // We track token totals on the original `narrativeRes` for ops
      // visibility, but the narrative + validation we act on is the
      // retry's.
      narrativeRes.narrative = retryRes.narrative;
      narrativeRes.modelUsed = retryRes.modelUsed;
      narrativeRes.tokens.prompt += retryRes.tokens.prompt;
      narrativeRes.tokens.completion += retryRes.tokens.completion;
      narrativeRes.tokens.cached += retryRes.tokens.cached;
      narrativeRes.durationMs += retryRes.durationMs;
      validation = retryValidation;
    }
  }

  if (!validation.ok) {
    await sb
      .from("defence_packages")
      .update({
        status: "failed",
        validation_status: "failed",
        validation_errors: validation.errors,
        failure_code: "validation_failed",
        failure_reason: `${validation.errors.length} validation error${validation.errors.length === 1 ? "" : "s"} (after one retry)`,
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
        retryAttempted: true,
      },
    });
    return { ok: false, retriable: false, reason: "validation_failed" };
  }

  // Derive order/payment/timeline context from the pack once — the PDF
  // renderer + the workspace API both consume this shape. Before this
  // call, the meta object hardcoded `null` for 8 fields the case-details
  // table needs (card network, last 4, transaction date, gateway,
  // financial/fulfillment status, order name, cardholder name) even
  // though the data was already in `pack_json`.
  const orderContext = deriveOrderContext(
    sectionsRaw.map((s) => ({
      type: s.type,
      label: s.label,
      source: s.source,
      data: s.data ?? {},
      fieldsProvided: s.fieldsProvided ?? [],
    })),
  );

  const merchantDisplayName =
    merchantNameFromDomain(shop?.shop_domain ?? null) ?? "Merchant";

  // Phase 1.5 — composed-document validation. Every byte of
  // argumentative prose that the renderer will write into the PDF
  // (thesis blockquotes + LLM section bodies + deterministic fallback
  // prose) passes through the same forbidden-phrase + claim-guard
  // machinery as the LLM output already does. Fails closed; offending
  // layer is reported in failure_reason.
  //
  // Phase 4: thesisText now comes from fact-templated thesis
  // (renderThesis) — a thesis can no longer claim a fact that isn't
  // in approvedFacts because the required-token gate short-circuits to
  // "" when any token resolves null.
  const composedBlocks = composePdfBlocks({
    narrative: narrativeRes.narrative,
    approvedFacts: classification.approved,
    packageMode: classification.packageMode,
    familyKey: reasonCodeFamily.key,
    moduleKey: reasonCodeModule.key,
    fulfillmentStatus: orderContext.fulfillmentStatus,
  });
  const composedValidation = validateComposedDocument({
    blocks: composedBlocks,
    approvedFacts: classification.approved,
    packageMode: classification.packageMode,
    extraHardPhrases: hardPhrases,
    guardedPhrases: reasonCodeFamily.guardedBankPhrases,
  });
  if (!composedValidation.ok) {
    const summary = summariseComposedErrors(composedValidation.errors);
    await sb
      .from("defence_packages")
      .update({
        status: "failed",
        validation_status: "failed",
        validation_errors: composedValidation.errors,
        failure_code: "validation_failed",
        failure_reason: summary,
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
        validationErrors: composedValidation.errors,
        composed: true,
      },
    });
    return { ok: false, retriable: false, reason: `validation_failed:composed (${summary})` };
  }

  // Render PDF — driven by the validated composedBlocks. The
  // renderer is presentational over those blocks (Phase 4); it
  // never composes prose.
  const docData: DefencePackageDocumentData = {
    meta: {
      packageId,
      disputeGid: dispute?.dispute_gid ?? null,
      orderName: orderContext.orderName,
      reasonCode,
      // For non-card (Klarna/BNPL) disputes, NEVER print a Visa/Mastercard
      // reason code — Klarna has no network code and the funding card is
      // structurally unavailable. Show Klarna's own dispute category
      // instead (derived from the Shopify reason enum). Card disputes keep
      // the module's network reference label unchanged.
      reasonCodeDisplay: isNonCardPayment
        ? klarnaDisputeCategoryDisplay(dispute?.reason ?? null)
        : reasonCodeModule.displayName,
      claimType: reasonCodeModule.claimType,
      shopName: merchantDisplayName,
      merchantName: merchantDisplayName,
      amountDisplay: dispute?.amount != null
        ? `${dispute.currency_code ?? ""} ${dispute.amount}`.trim()
        : null,
      cardNetwork: orderContext.cardNetwork,
      cardLast4: orderContext.cardLast4,
      paymentGateway: orderContext.paymentGateway,
      financialStatus: orderContext.financialStatus,
      fulfillmentStatus: orderContext.fulfillmentStatus,
      cardholderName:
        orderContext.cardholderName ?? (dispute?.customer_display_name as string | null) ?? null,
      transactionDate: orderContext.transactionDate,
      timelineEvents: orderContext.timelineEvents,
      lineItemsFromContext: orderContext.lineItems,
      generatedAt: new Date().toISOString(),
      version: pkg.version,
      packageMode: classification.packageMode,
      promptFamily: narrativeRes.promptFamily,
      promptVersion: narrativeRes.promptVersion,
      modelUsed: narrativeRes.modelUsed,
      reasonCodeModuleKey: reasonCodeModule.key,
      reasonCodeFamilyKey: reasonCodeFamily.key,
      evidenceHash: pkg.evidence_hash,
      generatedBy: pkg.generated_by as "system" | "merchant" | "admin",
    },
    composedBlocks,
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

  // Pre-flight guards: even when rules say "auto", the same gates the pack
  // pipeline applies (Coverage / Fatal-loss / PRD §9 strength) must prevent
  // auto-finalize + save-to-Shopify enqueue here. Without this, the pack
  // pipeline can correctly block at sync
  // time and then this handler — re-resolving rules independently — silently
  // saves a Weak / Fatal-loss / Covered pack a few minutes later, bypassing
  // the gate.
  //
  // The decision itself lives in lib/automation/autoSubmitGuards.ts, shared
  // with the pipeline and reconcileParkedAutoDisputes. Before that extraction
  // this handler BLOCKED on Moderate while the pipeline PARKED on it — same
  // net effect (both leave a draft) but two different audit trails, which is
  // why the drift went unnoticed. Our only lever is targetStatus, so a park
  // and a block both demote to "review"; the verdict is recorded so they stay
  // distinguishable in the audit trail.
  const caseStrengthOverall =
    (packJson.case_strength as { overall?: string } | undefined)?.overall ?? null;
  if (resolvedMode === "auto") {
    const verdict = evaluateAutoSubmitGuards({
      coverageState: coverage,
      fatalLoss,
      caseStrength: caseStrengthOverall,
      // Previously omitted (P5, 2026-08-04). A fully-credited case reaches
      // "strong" through the strength FLOOR, so the verdict was the same —
      // but its REASON read `strong` here and `credit_already_issued` in the
      // pipeline, for one dispute. The audit trail now agrees with itself.
      creditAlreadyIssued:
        (packJson.credit_already_issued as
          | { triggered?: boolean; coversDisputedAmount?: boolean }
          | undefined) ?? null,
    });
    if (verdict.decision !== "proceed") {
      resolvedMode = "review";
      // Raw insert (bypasses typed logEvent helper) because
      // `auto_save_blocked` is not in the typed EventType union — the
      // pack pipeline writes it the same way at lib/automation/pipeline.ts.
      await sb.from("audit_events").insert({
        shop_id: pkg.shop_id,
        dispute_id: pkg.dispute_id,
        pack_id: pkg.source_pack_id,
        actor_type: "system",
        event_type: "auto_save_blocked",
        event_payload: {
          reasons: [verdict.message],
          decision: verdict.decision,
          verdict_reason: verdict.reason,
          case_strength: caseStrengthOverall,
          coverage,
          fatal_loss: fatalLoss.triggered === true ? fatalLoss.reason : null,
          source: "defence_build",
        },
      });
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
  // The row was already flipped to final by the UPDATE above (targetStatus).
  // finalizeAndEnqueueSave is idempotent on the final flip (it only acts on
  // a `draft` row) — here it just supersedes any prior final and enqueues
  // the save, the identical tail that reconcileParkedAutoDisputes runs so
  // there is ONE finalize+save path, not two that can drift.
  if (resolvedMode === "auto") {
    await finalizeAndEnqueueSave({
      sb,
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packageId,
      packageVersion: pkg.version,
      sourcePackId: pkg.source_pack_id,
    });
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
