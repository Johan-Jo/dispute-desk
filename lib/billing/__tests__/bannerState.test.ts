/**
 * Tests for `computeBillingBannerState` — the pure decision function
 * behind the Phase 4b banner machinery. The variant precedence and
 * dismissal-per-cycle rules are spec-load-bearing: a regression here
 * means a merchant either sees a stale yellow banner after they paid
 * the cycle off, OR misses a red banner because we silently picked
 * blue instead.
 */

import { describe, it, expect } from "vitest";
import {
  computeBillingBannerState,
  LOW_CREDITS_THRESHOLD,
  DISMISSAL_COLUMN,
} from "../bannerState";

const CYCLE_END = "2026-07-01T00:00:00Z";

describe("computeBillingBannerState — variant precedence", () => {
  it("expired → subscription_expired (sticky, not dismissible)", () => {
    const s = computeBillingBannerState({
      subscriptionState: "expired",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: null,
      remainingPacks: 0,
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("subscription_expired");
    expect(s.dismissible).toBe(false);
    expect(s.forCycleEnd).toBeNull();
  });

  it("cancelled → subscription_expired (sticky, not dismissible)", () => {
    const s = computeBillingBannerState({
      subscriptionState: "cancelled",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: null,
      remainingPacks: 75,
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("subscription_expired");
    expect(s.dismissible).toBe(false);
  });

  it("grace → grace (yellow, dismissible)", () => {
    const s = computeBillingBannerState({
      subscriptionState: "grace",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: null,
      remainingPacks: 50,
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("grace");
    expect(s.dismissible).toBe(true);
    expect(s.forCycleEnd).toBe(CYCLE_END);
  });

  it("grace dismissed for THIS cycle → none", () => {
    const s = computeBillingBannerState({
      subscriptionState: "grace",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: CYCLE_END,
      remainingPacks: 50,
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("none");
  });

  it("grace dismissed for a PRIOR cycle → still grace this cycle", () => {
    const s = computeBillingBannerState({
      subscriptionState: "grace",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: "2026-06-01T00:00:00Z",
      remainingPacks: 50,
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("grace");
  });
});

describe("computeBillingBannerState — low credits", () => {
  it("low_credits when remaining/limit < 10% on active", () => {
    const s = computeBillingBannerState({
      subscriptionState: "active",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: null,
      remainingPacks: 7, // 7/75 = 9.3% < 10%
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("low_credits");
    expect(s.dismissible).toBe(true);
    expect((s.context as { ratio: number }).ratio).toBeLessThan(
      LOW_CREDITS_THRESHOLD,
    );
  });

  it("low_credits also fires on trialing", () => {
    const s = computeBillingBannerState({
      subscriptionState: "trialing",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: null,
      remainingPacks: 1,
      monthlyPackLimit: 25,
    });
    expect(s.variant).toBe("low_credits");
  });

  it("does NOT fire when ratio is exactly 10%", () => {
    const s = computeBillingBannerState({
      subscriptionState: "active",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: null,
      remainingPacks: 8, // 8/75 = 10.67% > 10%
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("none");
  });

  it("dismissed for THIS cycle → none", () => {
    const s = computeBillingBannerState({
      subscriptionState: "active",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: CYCLE_END,
      graceBannerDismissedCycle: null,
      remainingPacks: 1,
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("none");
  });

  it("dismissed for PRIOR cycle → re-fires", () => {
    const s = computeBillingBannerState({
      subscriptionState: "active",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: "2026-06-01T00:00:00Z",
      graceBannerDismissedCycle: null,
      remainingPacks: 1,
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("low_credits");
  });

  it("does NOT fire on free plan (no monthly limit)", () => {
    const s = computeBillingBannerState({
      subscriptionState: "active",
      billingCycleEndsAt: null,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: null,
      remainingPacks: 0,
      monthlyPackLimit: null,
    });
    expect(s.variant).toBe("none");
  });

  it("does NOT fire when state is expired even with low credits", () => {
    // expired wins precedence; low_credits is irrelevant.
    const s = computeBillingBannerState({
      subscriptionState: "expired",
      billingCycleEndsAt: CYCLE_END,
      lowCreditsBannerDismissedCycle: null,
      graceBannerDismissedCycle: null,
      remainingPacks: 0,
      monthlyPackLimit: 75,
    });
    expect(s.variant).toBe("subscription_expired");
  });
});

describe("DISMISSAL_COLUMN registry", () => {
  it("maps grace → grace_banner_dismissed_cycle", () => {
    expect(DISMISSAL_COLUMN.grace).toBe("grace_banner_dismissed_cycle");
  });
  it("maps low_credits → low_credits_banner_dismissed_cycle", () => {
    expect(DISMISSAL_COLUMN.low_credits).toBe(
      "low_credits_banner_dismissed_cycle",
    );
  });
});
