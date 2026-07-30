/**
 * autoSubmitGuards — the ONE place that decides whether an auto-mode case
 * may actually be submitted.
 *
 * Why this exists: this decision was implemented three times and two of the
 * implementations disagreed.
 *
 *   - `lib/automation/pipeline.ts` (evaluateAndMaybeAutoSave) PARKED on
 *     Moderate strength.
 *   - `lib/jobs/handlers/buildDefencePackageJob.ts` BLOCKED on Moderate,
 *     lumping it in with weak/insufficient.
 *   - `lib/automation/reconcileParkedAutoDisputes.ts` hand-rolled the same
 *     coverage / fatal-loss / strength / product-family checks a third time.
 *
 * The same dispute therefore got a different audit trail depending on which
 * path evaluated it. Net merchant impact was nil (a park and a block both
 * leave the package a draft), which is precisely why the drift went
 * unnoticed — so the fix is to make the drift structurally impossible.
 *
 * Canonical semantics: **Moderate PARKS, it does not block.** A moderate
 * case has a usable draft the merchant can review and submit manually;
 * blocking it would strand a viable defence.
 *
 * A product-family ("not as described") Strong case used to park here too,
 * on the theory that the merchant might know the item genuinely WAS
 * defective. Removed 2026-07-30 — the theory does not survive three facts:
 *   1. Shopify auto-compiles and files its own order data on the due date
 *      when no evidence is submitted, so parking never withheld a rebuttal;
 *      it substituted a worse one.
 *   2. There is no penalty for losing a representment. VDMP/VAMP score the
 *      dispute ratio off disputes RECEIVED, fixed when the chargeback lands.
 *   3. We ship no way to edit the generated narrative, so the merchant could
 *      not act on that private context even when they had it.
 * The park also cost a pack credit, which is consumed at BUILD (see
 * lib/disputes/reviewState.ts), so it charged the merchant and then withheld
 * the thing they paid for.
 *
 * This function is PURE — no DB, no I/O, no side effects. Callers keep their
 * own side effects (the pipeline writes `evidence_packs.status`, the job
 * writes `defence_packages.status`), because those genuinely differ.
 * Extracting the effects too would produce a worse abstraction.
 *
 * Review mode never consults this function: review parks by definition.
 */

export type AutoSubmitParkReason = "moderate_strength";

export type AutoSubmitBlockReason =
  | "covered_shopify"
  | "fatal_loss"
  | "weak"
  | "insufficient";

export type AutoSubmitVerdict =
  | { decision: "proceed" }
  | { decision: "park"; reason: AutoSubmitParkReason; message: string }
  | { decision: "block"; reason: AutoSubmitBlockReason; message: string };

export interface AutoSubmitGuardInput {
  /** `pack_json.coverage.state` */
  coverageState: string | null | undefined;
  /** `pack_json.fatal_loss` */
  fatalLoss:
    | { triggered?: boolean; reason?: string | null; message?: string | null }
    | null
    | undefined;
  /**
   * `pack_json.case_strength.overall`. Null for packs built before the field
   * existed — those fall through to `proceed`, preserving the pre-existing
   * gate-only behaviour in every caller.
   */
  caseStrength: string | null | undefined;
}

/**
 * Order of precedence: Coverage → Fatal-loss → strength. Matches PRD §4
 * (coverage beats everything), §5 (fatal-loss), and §9.
 */
export function evaluateAutoSubmitGuards(
  input: AutoSubmitGuardInput,
): AutoSubmitVerdict {
  // PRD §4 — Shopify Protect is underwriting this dispute. Highest priority
  // routing decision; there is no merchant workflow at all.
  if (input.coverageState === "covered_shopify") {
    return {
      decision: "block",
      reason: "covered_shopify",
      message: "Covered by Shopify Protect — no auto-submit",
    };
  }

  // PRD §5 — structurally unwinnable (already refunded, or INR on an order
  // that was never fulfilled).
  if (input.fatalLoss?.triggered === true) {
    return {
      decision: "block",
      reason: "fatal_loss",
      message:
        input.fatalLoss.message ??
        `Auto-submit blocked — fatal-loss condition (${input.fatalLoss.reason ?? "unknown"}) per PRD §5`,
    };
  }

  const strength = input.caseStrength ?? null;

  // PRD §9 — auto mode executes ONLY on Strong.
  if (strength === "moderate") {
    return {
      decision: "park",
      reason: "moderate_strength",
      message:
        "Auto-mode case strength is Moderate — parked for merchant review per PRD §9",
    };
  }

  if (strength === "weak" || strength === "insufficient") {
    return {
      decision: "block",
      reason: strength,
      message: `Auto-mode case strength is ${strength === "weak" ? "Weak" : "Insufficient"} — auto-submit blocked per PRD §9`,
    };
  }

  // Strong (any family, product included), or a legacy pack with no
  // case_strength recorded.
  return { decision: "proceed" };
}
