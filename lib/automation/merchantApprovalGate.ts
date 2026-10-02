/**
 * The merchant-approval gate for the deadline cron.
 *
 * Settings → Dispute handling offers "Require my approval before saving", and
 * its copy promises that DisputeDesk "waits for your approval before saving the
 * first evidence package to Shopify". A per-reason rule set to Review makes the
 * same promise for its disputes. The deadline cron is the one path that saves
 * without a merchant click, so it must keep that promise itself.
 *
 * It used to rely on `normalized_status = 'needs_review'` being excluded from
 * its query (2026-07-06). That status is not reliably written when the pipeline
 * parks a case — 6a8848-dd's parked disputes sat at `new` — and on 2026-10-01
 * dispute 16ece0c5 was auto-finalized and filed with no approval on a store set
 * to "Require my approval". The gate is now derived from the setting and the
 * rule themselves, never from a status column.
 *
 * Approval is `review_state = 'approved'` ("Submit on the deadline"). A merchant
 * who submits from the workspace never reaches this cron — the save happens at
 * once and `evidence_saved_to_shopify_at` takes the case out of its query.
 */

import { evaluateRules } from "@/lib/rules/evaluateRules";
import { REVIEW_STATES } from "@/lib/disputes/reviewState";

export interface ApprovalGateInput {
  /** `shop_settings.auto_save_enabled` — false = "Require my approval". */
  autoSaveEnabled: boolean;
  /** The mode the shop's rules resolve for this dispute. */
  ruleMode: "auto" | "review";
  reviewState: string | null | undefined;
}

/** True when filing would break the merchant's approval setting. */
export function awaitsMerchantApproval(input: ApprovalGateInput): boolean {
  if (input.reviewState === REVIEW_STATES.APPROVED) return false;
  return !input.autoSaveEnabled || input.ruleMode !== "auto";
}

/**
 * Resolve the rule mode and apply the gate. A rules failure resolves to
 * "review" — the same default `evaluateRules` uses when nothing matches — so a
 * broken lookup can never turn into a filing the merchant did not approve.
 */
export async function deadlineAwaitsMerchantApproval(
  dispute: {
    id: string;
    shop_id: string;
    reason: string | null;
    status: string | null;
    amount: number | string | null;
    phase?: string | null;
    review_state: string | null;
  },
  autoSaveEnabled: boolean,
): Promise<{ awaits: boolean; ruleMode: "auto" | "review" }> {
  let ruleMode: "auto" | "review" = "review";
  try {
    const phase = (dispute.phase ?? "").toLowerCase();
    const result = await evaluateRules({
      id: dispute.id,
      shop_id: dispute.shop_id,
      reason: dispute.reason,
      status: dispute.status,
      amount: dispute.amount != null ? Number(dispute.amount) : null,
      phase: phase === "inquiry" || phase === "chargeback" ? phase : null,
    });
    ruleMode = result.action.mode === "auto" ? "auto" : "review";
  } catch (err) {
    console.error("[approval gate] evaluateRules failed; treating as review", err);
  }
  return {
    awaits: awaitsMerchantApproval({
      autoSaveEnabled,
      ruleMode,
      reviewState: dispute.review_state,
    }),
    ruleMode,
  };
}
