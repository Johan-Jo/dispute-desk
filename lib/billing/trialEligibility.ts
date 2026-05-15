/**
 * Trial-eligibility check.
 *
 * Per Shopify policy + standard SaaS norms: a shop receives the
 * promotional trial exactly once. Plan changes (upgrade / downgrade),
 * cancellation followed by resubscribe, and reactivation from
 * expired all happen INSTANTLY at the new price — no fresh 14-day
 * trial is granted on top.
 *
 * The subscribe route uses this to decide whether to pass
 * `trialDays: plan.trialDays` or `trialDays: 0` to
 * `appSubscriptionCreate`. The callback uses it again as a
 * belt-and-suspenders check before granting `trial`-source credits,
 * so a future direct call to /billing/callback can't bypass the gate.
 *
 * Two signals are considered:
 *
 *   1. `plan_entitlements.trial_started_at` — set when the trial
 *      lifecycle email fires (Phase 4a). Authoritative when present.
 *
 *   2. Any historical `pack_credits_ledger` row with `source = 'trial'`
 *      — covers shops whose trial pre-dates the Phase 4a column.
 *
 * Either signal is sufficient. The function is pure SQL + read-only;
 * it never mutates and never throws (errors collapse to "treat as
 * already trialed" to fail closed — better to forfeit a real trial
 * than to mistakenly hand a second one out).
 */

import { getServiceClient } from "@/lib/supabase/server";

export interface TrialEligibilityCheck {
  /** When true, the shop is eligible for a brand-new trial. */
  eligible: boolean;
  /** Why the gate decided as it did — surfaced in audit_events so
   *  a later "why didn't I get a trial?" question is answerable. */
  reason:
    | "first_time_subscription"
    | "trial_started_at_set"
    | "prior_trial_credit"
    | "lookup_failed";
}

export async function checkTrialEligibility(
  shopId: string,
): Promise<TrialEligibilityCheck> {
  const sb = getServiceClient();

  try {
    // Phase 4a authoritative signal.
    const { data: entitlement } = await sb
      .from("plan_entitlements")
      .select("trial_started_at")
      .eq("shop_id", shopId)
      .maybeSingle();
    if (entitlement?.trial_started_at) {
      return { eligible: false, reason: "trial_started_at_set" };
    }

    // Pre-Phase-4a fallback: any prior trial-source credit grant.
    const { data: priorTrial } = await sb
      .from("pack_credits_ledger")
      .select("id")
      .eq("shop_id", shopId)
      .eq("source", "trial")
      .limit(1)
      .maybeSingle();
    if (priorTrial) {
      return { eligible: false, reason: "prior_trial_credit" };
    }

    return { eligible: true, reason: "first_time_subscription" };
  } catch {
    // Fail closed: a transient DB failure must not award a second
    // trial. The merchant gets the subscription at full price; if
    // they were genuinely eligible they can contact support and the
    // grant can be done by hand from a verified audit trail.
    return { eligible: false, reason: "lookup_failed" };
  }
}
