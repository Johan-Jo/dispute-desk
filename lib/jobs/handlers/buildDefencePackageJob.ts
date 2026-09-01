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
import { generateNarrative, CURRENT_PROMPT_VERSION } from "@/lib/defence/narrativeWriter";
import { sendDefencePackageFailedAlert } from "@/lib/email/sendDefencePackageFailedAlert";
import {
  validateNarrative,
  validateComposedDocument,
  summariseComposedErrors,
  VALIDATOR_VERSION,
} from "@/lib/defence/validateNarrative";
import { suppressUnsupportedSections } from "@/lib/defence/suppressUnsupportedSections";
import { rankStrategies } from "@/lib/defence/strategies/registry";
import { composePdfBlocks } from "@/lib/defence/pdf/composePdfBlocks";
import { renderDefencePdf } from "@/lib/defence/renderDefencePdf";
import { uploadDefencePdf } from "@/lib/defence/storage";
import { computeEvidenceHash } from "@/lib/defence/computeEvidenceHash";
import { deriveOrderContext, merchantNameFromDomain } from "@/lib/defence/orderContext";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { finalizeAndEnqueueSave } from "@/lib/automation/finalizeAndEnqueueSave";
import { finalizeDedupeKey } from "@/lib/defence/finalizeRpc";
import { decideForPack } from "@/lib/automation/decision";
import { getShopSettings } from "@/lib/automation/settings";
import { canonicalPipelineEnabled } from "@/lib/pipeline/activation";
import {
  evaluateGenerationGuard,
  generationBlockPayload,
} from "@/lib/defence/latestPackageGenerationGuard";
import {
  derivePlanForCase,
  planHasSafeArgument,
  type PlanForCase,
} from "@/lib/argument/plan";
import {
  bankIncludedFacts,
  isBankIncludedManualEvidence,
} from "@/lib/defence/bankInclusion";
import {
  projectPackageFromPlan,
  selectPlanFacts,
  validatePackageDocument,
  type PackageProjection,
} from "@/lib/defence/package";
import { projectReviewItems } from "@/lib/evidence/model/merchantProjection";
import type {
  DefencePackageDocumentData,
} from "@/lib/defence/pdf/DefencePackageDocument";
import type {
  DefencePackageStatus,
  DefencePackageFailureCode,
  EvidenceFact,
  ValidationError,
} from "@/lib/defence/types";
import type { ClaimedJob, JobResult } from "../claimJobs";

/**
 * What every issuer-facing surface in this handler is built from.
 *
 * Named rather than spelled `EvidenceFact[]` at each site so the ONE
 * substitution this change makes — `classification.approved` becomes the
 * plan's bank-included facts on the canonical route — is a single assignment
 * with a reason next to it, not thirteen edits a reviewer has to diff.
 */
type EvidenceFactList = EvidenceFact[];

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
    // LOST-RESPONSE REPLAY. An auto build can finalize, enqueue the save and
    // commit, then lose its reply; the worker retries the whole handler. The
    // package is no longer a draft, and this used to be recorded as a
    // non-retriable failure — committed work reported as lost.
    //
    // The durable proof that the auto transaction committed is the save job it
    // inserted under `dpkg-finalize:<package_id>`. With that marker present,
    // converge on success: no rebuild, no re-audit, no second enqueue. Without
    // it, a `final` package is NOT assumed to be a committed auto-finalization
    // (a merchant may have approved it by hand), and the original refusal
    // stands.
    if (pkg.status === "final" || pkg.status === "submitted") {
      const { data: marker, error: markerErr } = await sb
        .from("jobs")
        .select("id")
        .eq("dedupe_key", finalizeDedupeKey(packageId))
        .maybeSingle();
      // A FAILED lookup is not proof of absence. Discarding the error turned a
      // transient blip into a permanent "this package is not a draft" failure
      // for work that had in fact committed.
      if (markerErr) {
        return {
          ok: false,
          retriable: true,
          reason: `commit_marker_lookup_failed: ${markerErr.message}`,
        };
      }
      if (marker) return { ok: true };
    }
    return { ok: false, retriable: false, reason: `package status=${pkg.status} is not draft` };
  }

  // Load source pack + dispute + shop.
  const [{ data: pack }, { data: dispute }, { data: shop }] = await Promise.all([
    sb
      .from("evidence_packs")
      // `completeness_score` / `blockers` / `submission_readiness` are inputs
      // to the canonical automation decision (CP-C). This handler used to run
      // its own guard call and never looked at them.
      .select(
        "id, shop_id, dispute_id, pack_json, checklist_v2, completeness_score, blockers, submission_readiness",
      )
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

  /* ── DEFENSIVE RE-CHECK: a job may predate the guard ────────────────
   *
   * `maybeEnqueueDefencePackage` declines to CREATE a draft over a
   * human-gated rejection, but a draft inserted before that guard existed —
   * or by any future path — already has a job pointing at it, and the
   * non-draft refusal above does not catch it: THIS row is a valid draft; the
   * rejection is on the version beneath it.
   *
   * Same predicate, evaluated against the newest OTHER version. Declines
   * without marking this row failed: it is not defective, it should not have
   * been created, and turning it into a second failure would deepen the state
   * the guard exists to protect. Not retriable — retrying re-reads the same
   * rejection.
   *
   * THE SAME QUESTION, WITH THE SAME INPUTS (2026-08-12). This re-check must
   * be given the current generator/validator/evidence versions, exactly as the
   * enqueue site is. Called without them the predicate falls back to "cannot
   * answer, therefore block", and the worker then refuses the very job the
   * enqueue site had just decided was a legitimate retry — leaving an empty
   * draft stranded above the real failure. That is what happened to #352513,
   * #352511 and #352555 on the first self-heal run: three `build_pack` jobs
   * succeeded, three drafts were created, and all three defence builds died on
   * `generation_blocked: latest_package_failed`.
   *
   * A defensive re-check that asks a DIFFERENT question from the decision it
   * is re-checking is not defence — it is a second, contradictory decision. */
  const { data: priorLatest } = await sb
    .from("defence_packages")
    .select(
      "id, version, status, validation_status, failure_code, prompt_version, validator_version, evidence_hash",
    )
    .eq("dispute_id", pkg.dispute_id)
    .neq("id", pkg.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorGuard = evaluateGenerationGuard(priorLatest, {
    promptVersion: CURRENT_PROMPT_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    /* The draft under construction carries the hash the enqueue site computed,
     * so the comparison is against the same evidence that decision used. */
    evidenceHash: typeof pkg.evidence_hash === "string" ? pkg.evidence_hash : null,
  });
  if (priorGuard.blocked) {
    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "system",
      eventType: "defence_package_generation_skipped",
      eventPayload: {
        ...generationBlockPayload(priorGuard),
        detected_at: "worker",
        abandoned_draft_id: pkg.id,
        abandoned_draft_version: pkg.version,
      },
    });
    return {
      ok: false,
      retriable: false,
      reason: `generation_blocked: ${priorGuard.reason}`,
    };
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

  /* ── THE CANONICAL ARGUMENT PLAN (CP-B) ──────────────────────────────
   *
   * Derived BEFORE anything issuer-facing exists. That ordering is the whole
   * design: a `review_required`, unverified, adverse or merchant-only record is
   * removed from the argument before the language model is shown anything, so
   * the model is never given a fact it may not cite. Filtering generated prose
   * afterwards is the failure mode this ordering prevents — prose written
   * around a fact does not survive that fact's removal, it merely loses its
   * support and keeps its sentence.
   *
   * Dark until PR 3. With the switch off, `plan` stays null and every branch
   * below falls through to `classification.approved`, exactly as shipped.
   */
  const canonical = canonicalPipelineEnabled();
  let planFacts: EvidenceFactList = classification.approved;

  /* ── DERIVATION IS UNCONDITIONAL; CONSUMPTION IS GATED ────────────────
   *
   * Activation step 1 (docs/plans/canonical-pipeline-activation.plan.md §3).
   *
   * The canonical identity — `plan_input_hash` and its four siblings — used to
   * be written only when the switch was ON, which made activation impossible
   * to stage: identity could never exist before the flip, and at the flip every
   * package without one reads `snapshot_absent`, non-fileable and deliberately
   * not grandfathered. Measured 2026-08-14: 0 of 398 packages carried a hash.
   * Flipping would have made all of them unfileable at once.
   *
   * So the plan is now derived on every build and STAMPED on the row, while
   * every consumer of it stays gated. `derivePlanForCase` is pure — evidence
   * model, candidates, hash — with no IO and no model call, so deriving it
   * while dark costs nothing and changes nothing.
   *
   * `activePlan` is the plan AS AN INPUT TO BEHAVIOUR. It is null while dark,
   * so fact selection, the skip decision, the projection, the document
   * validation and `reviewRequiredCount` all keep the legacy path byte for
   * byte. `planned` is the plan as IDENTITY, and feeds nothing but the columns.
   * Reading the wrong one is the difference between a dark change and a live
   * one, which is why they have different names.
   */
  let planned: PlanForCase | null = null;
  try {
    planned = derivePlanForCase({
      caseId: pkg.dispute_id as string,
      model: {
        disputeId: pkg.dispute_id as string,
        reason: (dispute?.reason as string | null) ?? null,
        packId: pack.id as string,
        sections: sectionsRaw,
        evidenceItems: items,
        coverage: { state: coverage },
        networkReasonCode: reasonCode,
      },
      reasonCodeModule,
      approvedFacts: planFacts,
      // F4. Phase 4R is not built, so nothing writes a review flag yet and this
      // list is empty on live data — but it is a real INPUT rather than a
      // hardcoded zero, and everything downstream reads the count off the
      // plan's own exclusions. `deadline_only` is therefore reachable the
      // moment a writer exists, instead of being structurally impossible.
      reviewItems: [],
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    /* While dark the identity is best-effort: a derivation that throws must
     * never break a build that would otherwise succeed on the legacy path.
     * Once the switch is on the plan IS the build, so the same failure is real
     * and must surface rather than silently fall back to legacy fact
     * selection. */
    if (canonical) throw err;
    console.warn(
      `[buildDefencePackage] dark identity derivation failed for ${pkg.dispute_id}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  /** The plan as an INPUT TO BEHAVIOUR — null while dark. See above. */
  const activePlan = canonical ? planned : null;

  if (activePlan) {
    /* ── F5 — a fatally-lost case produces no fileable argument, and it is
     * refused HERE, before a document exists.
     *
     * The fatal-loss gate already capped strength and blocked auto-mode, but
     * the build still generated a full letter: the LLM was called, the PDF was
     * rendered and a validated draft was persisted for a case that is
     * structurally unwinnable. That draft is a fileable-looking candidate, and
     * the deadline path is exactly the path that used to pick one up without
     * consulting any gate at all.
     *
     * `markSkipped` writes `status = skipped` with the reason, which the
     * selector reads as `no_safe_argument` — never a draft, never a candidate.
     * The reason stays MERCHANT-facing only: bank text may never cite a
     * fatal-loss reason, and nothing here composes any.
     */
    if (fatalLoss.triggered === true) {
      return await markSkipped(sb, pkg, "no_bank_eligible_facts");
    }

    /* No safe argument survives the exclusions. An honest product outcome, not
     * an error — and specifically not a reason to lower the bar and generate
     * something weaker. Refused before generation for the same reason. */
    if (!planHasSafeArgument(activePlan.plan)) {
      return await markSkipped(sb, pkg, "no_bank_eligible_facts");
    }

    /* ── F1 / F3 / F6 — what the argument may be built from ─────────────
     *
     * TWO filters, both required, in this order:
     *
     *   1. `plan.included` — argument authority. Nothing outside it may reach
     *      an issuer, and nothing downstream re-decides that.
     *   2. `bankIncludedFacts` — bank eligibility. The plan answers "does this
     *      belong in THIS argument"; the classifier answers "may an issuer see
     *      it at all". They are different questions and both have to be asked.
     *
     * This is also where C-1 converges on the canonical route: the LLM payload
     * filter (`reachesLlmPayloadLegacy`) is strictly weaker than
     * `isBankIncludedFact`, so the model could be argued from a fact the PDF's
     * Evidence Basis table suppresses. On this route the model, the thesis, the
     * chronology, the Evidence Basis and Case Details all receive the SAME
     * list. The legacy route keeps the weaker filter untouched.
     */
    planFacts = bankIncludedFacts(
      selectPlanFacts(activePlan.plan, activePlan.factsByRecordId).includedFacts,
    );

    // Everything the plan authorised was bank-ineligible. Same honest answer:
    // no document, no draft, no candidate.
    if (planFacts.length === 0) {
      return await markSkipped(sb, pkg, "no_bank_eligible_facts");
    }
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
      approvedFacts: planFacts,
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
  // Drop argument sections whose every supporting fact is withheld from the
  // Evidence Basis, BEFORE validating. Measured on the 50 decided prod
  // disputes: 51 such sections across 27 cases. Blocking them would mean
  // status:"failed" and no PDF at all, so the letter loses the paragraph
  // instead of the merchant losing the filing.
  const suppression = suppressUnsupportedSections({
    narrative: narrativeRes.narrative,
    approvedFacts: planFacts,
    internalOnlyFactIds: classification.internalOnly.map((f) => f.id),
  });
  narrativeRes.narrative = suppression.narrative;

  let validation = validateNarrative({
    narrative: narrativeRes.narrative,
    approvedFacts: planFacts,
    reasonCodeModule,
    packageMode: classification.packageMode,
    internalOnlyFactIds: classification.internalOnly.map((f) => f.id),
    extraHardPhrases: hardPhrases,
    guardedPhrases: reasonCodeFamily.guardedBankPhrases,
  });
  // Non-blocking findings are recorded whether or not the package passes.
  // Without this the rule is invisible on live traffic, and "detect first,
  // block later" needs the detection to actually land somewhere.
  // Removing content from a filed document is not something to do silently.
  if (suppression.suppressed.length > 0 || suppression.declinedToEmptyLetter) {
    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "system",
      eventType: "defence_package_section_suppressed",
      eventPayload: {
        packageId,
        version: pkg.version,
        suppressed: suppression.suppressed,
        // True means every argument rested on withheld facts, so nothing was
        // removed and the warnings stand. Worth seeing: it is the population
        // the citability rule could never be promoted for.
        declinedToEmptyLetter: suppression.declinedToEmptyLetter,
      },
    });
  }

  const validationWarnings = validation.warnings ?? [];
  if (validationWarnings.length > 0) {
    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "system",
      eventType: "defence_package_validation_warning",
      eventPayload: {
        packageId,
        version: pkg.version,
        warnings: validationWarnings,
      },
    });
  }

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
        approvedFacts: planFacts,
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
      // The retry output needs the same treatment; without this a retried
      // package keeps the unsupported section the first pass had removed.
      const retrySuppression = suppressUnsupportedSections({
        narrative: retryRes.narrative,
        approvedFacts: planFacts,
        internalOnlyFactIds: classification.internalOnly.map((f) => f.id),
      });
      retryRes.narrative = retrySuppression.narrative;
      suppression.suppressed = retrySuppression.suppressed;
      suppression.declinedToEmptyLetter = retrySuppression.declinedToEmptyLetter;

      const retryValidation = validateNarrative({
        narrative: retryRes.narrative,
        approvedFacts: planFacts,
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
        facts_json: planFacts,
        package_mode: classification.packageMode,
        llm_model: narrativeRes.modelUsed,
        prompt_family: narrativeRes.promptFamily,
        prompt_version: narrativeRes.promptVersion,
        /* WHICH RULES REJECTED IT. Without this the next rebuild cannot tell
         * "failed under rules we have since fixed" from "failed under the rules
         * still in force", so the guard blocks both and the case never
         * recovers — the state fourteen disputes were in on 2026-08-12. */
        validator_version: VALIDATOR_VERSION,
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
    void notifyDefencePackageFailed(
      sb,
      pkg,
      "validation_failed",
      `${validation.errors.length} validation error${validation.errors.length === 1 ? "" : "s"} (after one retry)`,
      validation.errors,
      narrativeRes.promptVersion,
    );
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
  /* ── F1 / F2 — the document as a PROJECTION of the plan ──────────────
   *
   * On the canonical route the blocks are not composed from a narrative and
   * then checked; the narrative is REBUILT against `plan.included` first, so a
   * section that cites a record the plan removed is dropped whole before any
   * composition happens. `composePdfBlocks` then runs inside the projection,
   * over the plan's bank-included facts only — which is what makes the
   * templated thesis (F1) and the chronology (F2) re-render from the surviving
   * support instead of from whatever the model was given.
   *
   * Section granularity is deliberate: when a section cites an excluded
   * record the WHOLE section goes, not the offending clause. Sub-sentence
   * surgery needs to know which words a fact supports, which nothing here
   * knows, and a partial edit that leaves the topic sentence standing is the
   * orphaned claim again in a smaller box.
   */
  let projection: PackageProjection | null = null;
  let documentFailureCodes: readonly string[] = [];

  /**
   * The projection as IDENTITY — derived from `planned`, never from
   * `activePlan`, and never allowed to reach `composedBlocks`.
   *
   * ── THE SECOND DEADLOCK, AND WHY THIS MIRRORS THE FIRST ───────────────
   *
   * Step 1 made the plan derive while dark so `plan_input_hash` could exist
   * before activation. It deliberately left `document_validation_passed` null,
   * on the correct reasoning that stamping a verdict for a check that never
   * ran is a lie in the one column `selectFileablePackage` rung 9 trusts.
   *
   * What nobody then checked was rung 9 itself. It refuses
   * `validationPassed !== true`, so on 2026-08-15 — with all 55 open cases
   * stamped and drained — flipping the switch would have returned
   * `validation_failed` for every one of them. Same shape as blocker 1.1: the
   * data the flip needs can only be written after the flip.
   *
   * The fix is not to stamp `true` anyway, and not to teach rung 9 to tolerate
   * null. It is to RUN THE CHECK. `validatePackageDocument` is pure and
   * synchronous — no IO, no model call — so running it dark costs CPU and
   * makes the stamped verdict honest: we really did validate the document the
   * canonical route would compose.
   *
   * The one hazard is that the projection is not pure IDENTITY the way the
   * plan is — `composedBlocks` reads `projection?.blocks`, so un-gating the
   * existing variable would change bank-facing PDF output while claiming to be
   * dark. Hence a separate variable that nothing downstream may read.
   */
  let darkProjection: ReturnType<typeof projectPackageFromPlan> | null = null;
  /**
   * The fact list the CANONICAL route would use, recomputed darkly.
   *
   * Not `planFacts`. That variable is only reassigned inside `if (activePlan)`
   * (see the `bankIncludedFacts(selectPlanFacts(…))` block above), so while
   * dark it still holds the LEGACY selection. Projecting the canonical plan
   * over legacy facts would produce a hybrid document belonging to neither
   * route, and the verdict stamped from it would not predict what rung 9 reads
   * after the flip — which is the entire purpose of stamping it.
   */
  let darkPlanFacts: typeof planFacts | null = null;
  if (planned) {
    try {
      darkPlanFacts = bankIncludedFacts(
        selectPlanFacts(planned.plan, planned.factsByRecordId).includedFacts,
      );
      /* Empty is not a failure here. On the canonical route this returns
       * `markSkipped(no_bank_eligible_facts)`; darkly there is simply no
       * document to judge, so the verdict stays null — "not assessed", which
       * rung 9 refuses correctly. */
      darkProjection = darkPlanFacts.length
        ? projectPackageFromPlan({
            plan: planned.plan,
            narrative: narrativeRes.narrative,
            factsByRecordId: planned.factsByRecordId,
            bankIncludedFacts: darkPlanFacts,
            packageMode: classification.packageMode,
            familyKey: reasonCodeFamily.key,
            moduleKey: reasonCodeModule.key,
            fulfillmentStatus: orderContext.fulfillmentStatus,
          })
        : null;
    } catch (err) {
      /* Same contract as the dark plan derivation: best-effort while dark,
       * real once the switch is on (where `activePlan` drives the real
       * projection below and this variable is not consulted). */
      if (canonical) throw err;
      console.warn(
        `[buildDefencePackage] dark projection failed for ${pkg.dispute_id}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  if (activePlan) {
    projection = projectPackageFromPlan({
      plan: activePlan.plan,
      narrative: narrativeRes.narrative,
      factsByRecordId: activePlan.factsByRecordId,
      // The intersection the document is actually composed from — plan
      // authority AND bank eligibility. See `ProjectPackageInput`.
      bankIncludedFacts: planFacts,
      packageMode: classification.packageMode,
      familyKey: reasonCodeFamily.key,
      moduleKey: reasonCodeModule.key,
      fulfillmentStatus: orderContext.fulfillmentStatus,
    });
  }

  const composedBlocks =
    projection?.blocks ??
    composePdfBlocks({
      narrative: narrativeRes.narrative,
      approvedFacts: planFacts,
      packageMode: classification.packageMode,
      familyKey: reasonCodeFamily.key,
      moduleKey: reasonCodeModule.key,
      fulfillmentStatus: orderContext.fulfillmentStatus,
    });

  /* F2's second half — DETERMINISTIC document validation, run after
   * composition and covering what only exists once the plan is in the picture:
   * orphaned claims, plan/fact mismatch, an empty document, a retired delivery
   * key, plus the whole composed-prose contract. A failure makes the package
   * NON-FILEABLE — never a warning, never a score, never something a caller
   * may weigh against a deadline. */
  const composedValidation =
    activePlan && projection
      ? (() => {
          const verdict = validatePackageDocument({
            plan: activePlan.plan,
            blocks: projection.blocks,
            includedFacts: planFacts,
            orphaned: projection.orphaned,
            missingRecordIds: projection.missingRecordIds,
            packageMode: classification.packageMode,
            extraHardPhrases: hardPhrases,
            guardedPhrases: reasonCodeFamily.guardedBankPhrases,
          });
          documentFailureCodes = verdict.failureCodes;
          return {
            ok: verdict.passed,
            // The machine codes ARE the verdict on this route — they are the
            // vocabulary `deadlineExecutionConditions` reads for P-6's
            // `noUnsupportedArgument`. They are widened to `ValidationError`
            // only so the existing failure-persistence branch below keeps
            // writing the same column shape; the CODE is what carries meaning
            // and `message` deliberately restates it rather than inventing
            // prose the selector would then have to parse back.
            errors: verdict.failureCodes.map((rule) => ({
              section: "global" as const,
              rule: rule as ValidationError["rule"],
              message: rule,
            })),
          };
        })()
      : validateComposedDocument({
          blocks: composedBlocks,
          approvedFacts: planFacts,
          packageMode: classification.packageMode,
          extraHardPhrases: hardPhrases,
          guardedPhrases: reasonCodeFamily.guardedBankPhrases,
        });

  /**
   * The document verdict as IDENTITY — the real result of a check we really
   * ran, on the document the canonical route would compose.
   *
   * Read `planned` and `darkProjection`, never `activePlan`/`projection`: this
   * must produce the same answer whether the switch is on or off, because it is
   * what rung 9 will read after the flip. When the switch IS on, the live
   * `composedValidation` above has already run the identical check on the
   * identical inputs, so the two agree by construction.
   *
   * `null` only when no plan or no projection could be derived — genuinely
   * "not assessed", which rung 9 correctly refuses.
   */
  let darkDocumentPassed: boolean | null = null;
  let darkDocumentFailureCodes: readonly string[] = [];
  if (planned && darkProjection && darkPlanFacts) {
    try {
      const darkVerdict = validatePackageDocument({
        plan: planned.plan,
        blocks: darkProjection.blocks,
        // The canonical fact list, for the same reason the projection uses it.
        includedFacts: darkPlanFacts,
        orphaned: darkProjection.orphaned,
        missingRecordIds: darkProjection.missingRecordIds,
        packageMode: classification.packageMode,
        extraHardPhrases: hardPhrases,
        guardedPhrases: reasonCodeFamily.guardedBankPhrases,
      });
      darkDocumentPassed = darkVerdict.passed;
      darkDocumentFailureCodes = darkVerdict.failureCodes;
    } catch (err) {
      if (canonical) throw err;
      console.warn(
        `[buildDefencePackage] dark document validation failed for ${pkg.dispute_id}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
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
        facts_json: planFacts,
        package_mode: classification.packageMode,
        llm_model: narrativeRes.modelUsed,
        prompt_family: narrativeRes.promptFamily,
        prompt_version: narrativeRes.promptVersion,
        /* Same reason as the narrative-validation branch above: the failure has
         * to say which rules produced it, or it cannot be retried when they
         * change. */
        validator_version: VALIDATOR_VERSION,
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
    void notifyDefencePackageFailed(
      sb,
      pkg,
      "validation_failed",
      summary,
      composedValidation.errors,
      narrativeRes.promptVersion,
    );
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
    approvedFacts: planFacts,
    // F3. `classification.manual` is the full merchant-visible list, and the
    // renderer used to select from it on `includeInPackage` — a routing flag
    // that has never meant "the issuer may see this". On the canonical route
    // the list handed to the document is already bank-filtered, and the
    // renderer drops the internal "Inclusion" column with it.
    manualEvidence: canonical
      ? classification.manual.filter(isBankIncludedManualEvidence)
      : classification.manual,
    issuerSafeSupportingIndex: canonical,
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
        facts_json: planFacts,
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
    approvedFacts: planFacts,
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

  // THE canonical automation decision (CP-C). This handler used to run its own
  // `evaluateRules` + guard call — a second ladder that BLOCKED on Moderate
  // while the pack pipeline PARKED on it, so the same dispute got a different
  // audit trail depending on which path evaluated it. It now reads the same
  // object every other entry point reads.
  //
  // Our only lever here is `resolvedMode`, so every non-`auto_file` outcome
  // demotes to "review" (the package stays a draft); the decision's reason
  // codes are recorded so park and block stay distinguishable in the trail.
  const caseStrengthOverall =
    (packJson.case_strength as { overall?: string } | undefined)?.overall ?? null;
  if (resolvedMode === "auto") {
    const settings = await getShopSettings(pkg.shop_id);
    const decision = decideForPack({
      caseId: pkg.dispute_id as string,
      pack: {
        id: pack.id as string,
        dispute_id: pkg.dispute_id as string,
        completeness_score: (pack.completeness_score as number | null) ?? null,
        blockers: pack.blockers,
        submission_readiness: pack.submission_readiness,
        pack_json: pack.pack_json,
      },
      settings,
      automationMode: "auto",
      // The ABSOLUTE deadline. This handler never computes a window from it.
      evidenceDueAt: (dispute?.due_at as string | null) ?? null,
      /* F4 — the count comes from the PLAN'S ACTUAL EXCLUSIONS.
       *
       * `assessmentFromPackRow` defaults it to 0, and every caller took the
       * default, so `review_required_present` could not fire anywhere and
       * `deadline_only` was unreachable by construction — the state was
       * specified, contracted, given merchant copy in six locales, and then
       * made impossible by a hardcoded zero.
       *
       * `projectReviewItems` reads `plan.excluded` where the reason is
       * `review_required`. It is the same projection the merchant surface
       * renders, so the number automation acts on and the number the merchant
       * is shown cannot disagree. On the legacy route `planned` is null and
       * the count is 0 — which is what shipped.
       */
      reviewRequiredCount: projectReviewItems(activePlan?.plan ?? null).length,
    });
    if (decision.action !== "auto_file") {
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
          reasons: decision.reasonCodes,
          decision: decision.action,
          verdict_reason: decision.reasonCodes[0],
          decision_input_hash: decision.freshness.inputHash,
          case_strength: caseStrengthOverall,
          coverage,
          fatal_loss: fatalLoss.triggered === true ? fatalLoss.reason : null,
          source: "defence_build",
        },
      });
    }
  }

  // ── Persist the rendered package as a DRAFT, always ─────────────────
  //
  // This used to write `final` directly in auto mode and log
  // `defence_package_finalized` immediately, THEN call
  // finalizeAndEnqueueSave — whose whole job is to refuse an unsafe or
  // unverifiable candidate. By the time the preflight ran, the package was
  // already final and the successful-finalization audit already existed, so a
  // refusal produced a dispute whose newest candidate was final-but-unfileable
  // with an audit trail claiming it had been approved. The helper's return
  // value was also discarded, and the job returned `{ ok: true }` regardless.
  //
  // Finalization is an authorization step. It happens in exactly one place —
  // `finalizeAndEnqueueSave`, after the preflight — for every caller.
  const targetStatus: DefencePackageStatus = "draft";

  /* ── CANONICAL IDENTITY ────────────────────────────────────────────────
   *
   * What makes this row comparable against the CURRENT pipeline inputs later.
   * Without it `selectFileablePackage` has to treat every candidate as current,
   * which is exactly the "take the newest and hope" behaviour it exists to
   * replace.
   *
   * Written whenever a plan was derived — which since activation step 1 is
   * every build, dark or not — and explicitly NULLED otherwise, not
   * omitted-and-left-alone. A rebuild that could not derive a plan must CLEAR a
   * previous build's identity rather than let this row keep claiming a plan it
   * was not projected from. `null` reads as `snapshot_absent`, which is
   * non-fileable, and that is the correct answer for a package no plan was
   * derived for.
   *
   * THE DOCUMENT VERDICT IS A RECORDED RESULT, NEVER AN ASSUMPTION.
   *
   * Originally this column was gated on `activePlan`, so it was null while
   * dark — on the correct reasoning that stamping `true` for a check that never
   * ran is a lie in the column rung 9 trusts. The consequence went unnoticed
   * until 2026-08-15: rung 9 refuses `validationPassed !== true`, so with all
   * 55 open cases stamped and drained, the flip would have answered
   * `validation_failed` for every one. The verdict could only be written after
   * the flip that required it — blocker 1.1's shape, one column over.
   *
   * Resolved by RUNNING THE CHECK rather than by asserting its result:
   * `validatePackageDocument` is pure and synchronous, so it now executes
   * while dark against `darkProjection` and this column carries its real
   * answer. `null` survives for the case where no plan or projection could be
   * derived — genuinely "not assessed", which rung 9 still refuses, correctly.
   */
  const canonicalIdentityColumns =
    planned
      ? {
          plan_json: planned.plan,
          plan_input_hash: planned.planInputHash,
          plan_policy_version: planned.policyVersion,
          plan_deadline_only: planned.plan.deadlineOnly,
          plan_no_safe_argument: planned.plan.noSafeArgument,
          // On the canonical route this line is reached only after
          // `composedValidation.ok`, so `true` is already established; the dark
          // verdict ran the identical check on identical inputs and agrees by
          // construction. Reading the dark value in BOTH cases keeps one
          // source for the column instead of two that could drift. The codes
          // are carried beside it because P-6's `noUnsupportedArgument` reads
          // THEM, not the boolean — folding the two together is the collapse
          // contract revision 1 undid.
          document_validation_passed: darkDocumentPassed,
          document_failure_codes: darkDocumentPassed === null ? null : darkDocumentFailureCodes,
        }
      : {
          plan_json: null,
          plan_input_hash: null,
          plan_policy_version: null,
          plan_deadline_only: null,
          plan_no_safe_argument: null,
          document_validation_passed: null,
          document_failure_codes: null,
        };

  await sb
    .from("defence_packages")
    .update({
      status: targetStatus,
      pdf_path: pdfPath,
      narrative_json: narrativeRes.narrative,
      facts_json: planFacts,
      package_mode: classification.packageMode,
      llm_model: narrativeRes.modelUsed,
      prompt_family: narrativeRes.promptFamily,
      prompt_version: narrativeRes.promptVersion,
      validation_status: "ok",
      validation_errors: [],
      evidence_hash: finalHash,
      /* Written on success too, not only on failure: the column must describe
       * the rules this row was last built under, whatever the outcome. A
       * success carrying a stale version would make the NEXT failure look
       * older than it is. */
      validator_version: VALIDATOR_VERSION,
      updated_at: new Date().toISOString(),
      ...canonicalIdentityColumns,
    })
    .eq("id", packageId);

  await logAuditEvent({
    shopId: pkg.shop_id,
    disputeId: pkg.dispute_id,
    packId: pkg.source_pack_id,
    actorType: "system",
    // Always the draft event. A finalization audit is written by
    // `finalizeAndEnqueueSave` only after the candidate has been inspected.
    eventType: "defence_package_draft_generated",
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

  // ── Auto mode: inspect, then finalize + supersede + enqueue ─────────
  //
  // The canonical sequence, the identical one `reconcileParkedAutoDisputes`
  // runs: preflight the exact candidate, and only then promote it to final,
  // supersede the prior final, and enqueue the save. The row is still a draft
  // at this point, so a refusal leaves a validated draft the merchant can
  // regenerate — never a final package the worker will not file.
  //
  // The outcome is HANDLED, not discarded. A build that could not save is not
  // a successful build-and-save.
  if (resolvedMode === "auto") {
    const outcome = await finalizeAndEnqueueSave({
      sb,
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packageId,
      packageVersion: pkg.version,
      sourcePackId: pkg.source_pack_id,
    });

    if (!outcome.ok) {
      switch (outcome.failure) {
        case "content_block":
          // The package built correctly; we deliberately withheld the filing
          // and parked it for merchant review. Retrying the BUILD would
          // produce the same package, so the job is done, not failed.
          return { ok: true };
        case "stale":
          // A newer version landed while this one rendered. That version owns
          // the save decision; re-running this build would not change
          // anything. Reported honestly rather than as a successful save.
          return {
            ok: false,
            retriable: false,
            reason: `defence_package_superseded_before_save: ${outcome.reason ?? "not_current"}`,
          };
        case "lifecycle":
          // The guarded draft→final transition matched zero rows: another
          // actor changed the lifecycle between the render and the promotion,
          // and whoever won it owns the enqueue. Nothing was finalized,
          // superseded or queued here. Retrying this build would re-render the
          // same package and lose the race again, so it is not retriable.
          return {
            ok: false,
            retriable: false,
            reason: `defence_package_transition_conflict: ${outcome.reason ?? "zero rows"}`,
          };
        case "transient":
        case "pending":
        default:
          // A query or write failed (or, contradictorily, the row we just
          // wrote could not be found). Retriable: the package is fine and the
          // build is idempotent on an existing version.
          return {
            ok: false,
            retriable: true,
            reason: `defence_package_finalize_deferred: ${outcome.reason ?? "unknown"}`,
          };
      }
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

/**
 * Load the context an operator needs and send the failed-package alert.
 *
 * ONE notifier for every failure path, so a new branch cannot ship without the
 * alarm — the omission that let fourteen disputes accumulate silently.
 *
 * Swallows everything. The caller is already on a failure path; an alert that
 * throws would replace a diagnosable build failure with an email error.
 */
async function notifyDefencePackageFailed(
  sb: ReturnType<typeof getServiceClient>,
  pkg: { id: string; dispute_id: string; shop_id: string; version: number },
  failureCode: string,
  failureReason: string,
  validationErrors?: Array<{ rule?: string; section?: string; message?: string }>,
  promptVersion?: number | null,
): Promise<void> {
  try {
    const [{ data: dispute }, { data: shop }] = await Promise.all([
      sb
        .from("disputes")
        .select("order_name, due_at")
        .eq("id", pkg.dispute_id)
        .maybeSingle(),
      sb.from("shops").select("shop_domain").eq("id", pkg.shop_id).maybeSingle(),
    ]);
    await sendDefencePackageFailedAlert({
      shopDomain: (shop?.shop_domain as string | null) ?? null,
      orderName: (dispute?.order_name as string | null) ?? null,
      disputeId: pkg.dispute_id,
      packageId: pkg.id,
      version: pkg.version,
      failureCode,
      failureReason,
      validationErrors,
      dueAt: (dispute?.due_at as string | null) ?? null,
      promptVersion: promptVersion ?? null,
      validatorVersion: VALIDATOR_VERSION,
    });
  } catch (err) {
    console.error("[defence] failed-package alert could not be sent", err);
  }
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
  /**
   * The generator version that produced this failure, when one ran. Absent for
   * failures raised before generation (cap reached, LLM transport error).
   */
  promptVersion?: number | null,
): Promise<JobResult> {
  /* THE VERSIONS ARE PART OF THE FAILURE RECORD.
   *
   * A failure that does not say which rules produced it cannot be distinguished
   * later from one produced under rules we have since fixed, so
   * `evaluateGenerationGuard` has to block both and the case never recovers.
   * That is what stranded fourteen disputes on 2026-08-12 — `#12936` for three
   * weeks past its deadline. `validator_version` is written unconditionally
   * because the validator is the thing most likely to change underneath a
   * failure; `prompt_version` only when a generation actually ran. */
  await sb
    .from("defence_packages")
    .update({
      status: "failed",
      failure_code: failureCode,
      failure_reason: reason,
      validator_version: VALIDATOR_VERSION,
      ...(typeof promptVersion === "number" ? { prompt_version: promptVersion } : {}),
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
  /* TELL SOMEONE. An audit row that nothing reads is not a notification — it
   * is how fourteen disputes reached a failed latest package unnoticed, two of
   * them past their deadline. Not awaited into the failure path: a build that
   * already failed must not fail differently because an email did. */
  void notifyDefencePackageFailed(sb, pkg, failureCode, reason);
  return { ok: false, retriable, reason };
}
