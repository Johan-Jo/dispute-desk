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
 * blocking it would strand a viable defence. Same for product-family Strong
 * (a subjective merchandise claim the merchant may have context on).
 *
 * This function is PURE — no DB, no I/O, no side effects. Callers keep their
 * own side effects (the pipeline writes `evidence_packs.status`, the job
 * writes `defence_packages.status`), because those genuinely differ.
 * Extracting the effects too would produce a worse abstraction.
 *
 * Review mode never consults this function: review parks by definition.
 */

import { resolveReasonFamily } from "@/lib/argument/reasonFamily";

export type AutoSubmitParkReason = "moderate_strength" | "product_family_strong";

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
  /** `pack_json.disputeReason` — drives the product-family park. */
  disputeReason: string | null | undefined;
}

/**
 * Order of precedence: Coverage → Fatal-loss → strength (incl. the
 * product-family Strong park). Matches PRD §4 (coverage beats everything),
 * §5 (fatal-loss), and §9 (auto executes ONLY on Strong).
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

  // "Not as described" is a subjective merchandise-quality claim. We do NOT
  // auto-submit even a two-axis Strong product case — the merchant may know
  // context the evidence doesn't capture (the item genuinely was defective).
  // Removing this guard later opts product-Strong back into normal
  // auto-submit. (docs/plans/product-not-as-described-scoring.plan.md)
  if (strength === "strong" && resolveReasonFamily(input.disputeReason) === "product") {
    return {
      decision: "park",
      reason: "product_family_strong",
      message:
        "Auto-mode: 'not as described' cases are parked for merchant review even when Strong (subjective merchandise claim)",
    };
  }

  // Strong non-product, or a legacy pack with no case_strength recorded.
  return { decision: "proceed" };
}
