/**
 * Billing banner state machine (Phase 4b).
 *
 * Pure function over the persisted billing state. The UI fetches
 * `GET /api/billing/banner` and renders the returned variant; the API
 * route is the only consumer that does I/O. Keeping the decision
 * logic pure lets us assert the matrix in one tight test file
 * instead of mocking React + Supabase together.
 *
 * Banner variants and their precedence (highest first):
 *
 *   1. `subscription_expired` — red, sticky.
 *      State ∈ {expired, cancelled}. Cannot be dismissed.
 *      The merchant must reactivate.
 *
 *   2. `grace` — yellow, dismissible-per-cycle.
 *      State = grace. Auto-build still runs, payment is being retried.
 *
 *   3. `low_credits` — blue, dismissible-per-cycle.
 *      State ∈ {trialing, active} AND remaining/limit < 0.10.
 *      Informational nudge; no automation impact.
 *
 *   4. `none` — no banner.
 *
 * The PRD § 5.4 invariant says "in-app banners are NEVER throttled" —
 * that applies to the billing-blocked email throttle, not to per-cycle
 * dismissals. Dismissals here only suppress the banner FOR THE
 * CURRENT CYCLE; a new cycle automatically un-dismisses.
 */

import type { SubscriptionState } from "./subscriptionState";

export type BillingBannerVariant =
  | "subscription_expired"
  | "grace"
  | "low_credits"
  | "free_out_of_packs"
  | "none";

export interface BillingBannerState {
  variant: BillingBannerVariant;
  /** When `true`, the UI should render a dismiss button that POSTs to
   *  `/api/billing/banner/dismiss` with the variant. */
  dismissible: boolean;
  /** When the banner is shown, the cycle_end the merchant must dismiss
   *  AGAINST. The dismissal API writes this exact string into the
   *  corresponding `*_dismissed_cycle` column so future cycles re-show. */
  forCycleEnd: string | null;
  /** Diagnostic payload — never rendered to the merchant, but carries
   *  enough context for the UI to populate counts ("12 of 100 packs
   *  remaining") without a second round-trip. */
  context: Record<string, unknown>;
}

export interface BannerStateInput {
  subscriptionState: SubscriptionState;
  billingCycleEndsAt: string | null;
  lowCreditsBannerDismissedCycle: string | null;
  graceBannerDismissedCycle: string | null;
  /** From the pack_balance view; null when there's no row yet. */
  remainingPacks: number | null;
  /** From the active plan; null on the free plan (no monthly limit). */
  monthlyPackLimit: number | null;
  /** The shop's plan id. Distinguishes a free shop (lifetime pack floor,
   *  no monthly cycle) from a paid shop so the free-tier wall can fire
   *  when a free shop exhausts its lifetime packs. */
  planId: string;
}

/** Threshold below which the low-credits banner appears. PRD §5.6 sets
 *  this at "less than 10%"; encoded as a constant so future tuning is
 *  a one-line change AND the test suite can pin it. */
export const LOW_CREDITS_THRESHOLD = 0.1;

export function computeBillingBannerState(
  input: BannerStateInput,
): BillingBannerState {
  // 1. Sticky red — overrides everything.
  if (
    input.subscriptionState === "expired" ||
    input.subscriptionState === "cancelled"
  ) {
    return {
      variant: "subscription_expired",
      dismissible: false,
      forCycleEnd: null,
      context: { subscriptionState: input.subscriptionState },
    };
  }

  // 2. Yellow grace — dismissible per cycle, but the cycle resets the
  // dismissal automatically.
  if (input.subscriptionState === "grace") {
    const dismissedThisCycle =
      input.graceBannerDismissedCycle != null &&
      input.billingCycleEndsAt != null &&
      input.graceBannerDismissedCycle === input.billingCycleEndsAt;
    if (!dismissedThisCycle) {
      return {
        variant: "grace",
        dismissible: true,
        forCycleEnd: input.billingCycleEndsAt,
        context: {
          subscriptionState: input.subscriptionState,
          billingCycleEndsAt: input.billingCycleEndsAt,
        },
      };
    }
  }

  // 3. Blue low-credits — only for healthy states, and ONLY when the
  // balance is actually KNOWN. `remainingPacks == null` means the
  // pack_balance view has no row yet (fresh cycle / no grant recorded)
  // — an unknown balance is not "almost out", and defaulting it to 0
  // fired a false "Almost out of packs" banner on shops with zero
  // usage (dev report 2026-07-26).
  const activeStates: SubscriptionState[] = ["trialing", "active"];
  if (activeStates.includes(input.subscriptionState) && input.remainingPacks != null) {
    const remaining = input.remainingPacks;
    const limit = input.monthlyPackLimit ?? 0;
    if (limit > 0) {
      const ratio = remaining / limit;
      if (ratio < LOW_CREDITS_THRESHOLD) {
        const dismissedThisCycle =
          input.lowCreditsBannerDismissedCycle != null &&
          input.billingCycleEndsAt != null &&
          input.lowCreditsBannerDismissedCycle === input.billingCycleEndsAt;
        if (!dismissedThisCycle) {
          return {
            variant: "low_credits",
            dismissible: true,
            forCycleEnd: input.billingCycleEndsAt,
            context: {
              remaining,
              limit,
              ratio: Number(ratio.toFixed(3)),
              billingCycleEndsAt: input.billingCycleEndsAt,
            },
          };
        }
      }
    }
  }

  // 4. Free-tier wall — a free shop that has exhausted its lifetime pack
  // floor. Free plans carry no monthly limit (monthlyPackLimit === null),
  // so the low_credits branch above never fires for them; without this a
  // free shop at 0 packs would see NO banner. Non-dismissible: it is the
  // actionable wall (they cannot build/submit more packs), not a nudge —
  // and free is lifetime, so there is no cycle to reset a dismissal
  // against. Only fires for the free plan; paid shops reach 0 via their
  // cycle and get low_credits/expired handling instead.
  if (
    input.planId === "free" &&
    input.monthlyPackLimit == null &&
    input.remainingPacks != null &&
    input.remainingPacks <= 0
  ) {
    return {
      variant: "free_out_of_packs",
      dismissible: false,
      forCycleEnd: null,
      context: { remaining: input.remainingPacks, planId: input.planId },
    };
  }

  return {
    variant: "none",
    dismissible: false,
    forCycleEnd: null,
    context: {},
  };
}

/** Per-variant DB column used to record the dismissed cycle. */
export const DISMISSAL_COLUMN: Record<
  Extract<BillingBannerVariant, "grace" | "low_credits">,
  "grace_banner_dismissed_cycle" | "low_credits_banner_dismissed_cycle"
> = {
  grace: "grace_banner_dismissed_cycle",
  low_credits: "low_credits_banner_dismissed_cycle",
};
