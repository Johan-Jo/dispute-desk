/**
 * Tests for the Shopify-status → local-state mapper. The defensive
 * PENDING rule (PRD §5.1) is the load-bearing assertion here: a
 * non-trial pending charge must NEVER map to `trialing`.
 */

import { describe, it, expect } from "vitest";
import {
  mapShopifyStatusToState,
  automationAllowed,
  readOnlyAccessAllowed,
  SUBSCRIPTION_STATES,
} from "../subscriptionState";

const NOW = new Date("2026-06-01T00:00:00Z");
const TRIAL_OPEN = "2026-06-15T00:00:00Z"; // 14 days ahead
const TRIAL_PAST = "2026-05-15T00:00:00Z"; // 17 days behind

describe("mapShopifyStatusToState", () => {
  it("ACTIVE → active outside trial window", () => {
    expect(
      mapShopifyStatusToState({
        status: "ACTIVE",
        trialEndsAt: TRIAL_PAST,
        now: NOW,
      }),
    ).toBe("active");
  });

  it("ACTIVE → trialing inside trial window", () => {
    expect(
      mapShopifyStatusToState({
        status: "ACTIVE",
        trialEndsAt: TRIAL_OPEN,
        now: NOW,
      }),
    ).toBe("trialing");
  });

  it("FROZEN → grace", () => {
    expect(
      mapShopifyStatusToState({ status: "FROZEN", now: NOW }),
    ).toBe("grace");
  });

  it("CANCELLED → cancelled", () => {
    expect(
      mapShopifyStatusToState({ status: "CANCELLED", now: NOW }),
    ).toBe("cancelled");
  });

  it("EXPIRED → expired", () => {
    expect(
      mapShopifyStatusToState({ status: "EXPIRED", now: NOW }),
    ).toBe("expired");
  });

  it("DECLINED → expired", () => {
    expect(
      mapShopifyStatusToState({ status: "DECLINED", now: NOW }),
    ).toBe("expired");
  });

  describe("defensive PENDING mapping (PRD §5.1)", () => {
    it("PENDING + trial_ends_at in the future → trialing", () => {
      expect(
        mapShopifyStatusToState({
          status: "PENDING",
          trialEndsAt: TRIAL_OPEN,
          now: NOW,
        }),
      ).toBe("trialing");
    });

    it("PENDING + trial_ends_at in the past → expired (NOT trialing)", () => {
      expect(
        mapShopifyStatusToState({
          status: "PENDING",
          trialEndsAt: TRIAL_PAST,
          now: NOW,
        }),
      ).toBe("expired");
    });

    it("PENDING + null trial_ends_at → expired (NOT trialing)", () => {
      expect(
        mapShopifyStatusToState({
          status: "PENDING",
          trialEndsAt: null,
          now: NOW,
        }),
      ).toBe("expired");
    });

    it("PENDING + undefined trial_ends_at → expired", () => {
      expect(
        mapShopifyStatusToState({ status: "PENDING", now: NOW }),
      ).toBe("expired");
    });
  });
});

describe("automationAllowed", () => {
  it("permits automation in trialing/active/grace only", () => {
    expect(automationAllowed("trialing")).toBe(true);
    expect(automationAllowed("active")).toBe(true);
    expect(automationAllowed("grace")).toBe(true);
    expect(automationAllowed("expired")).toBe(false);
    expect(automationAllowed("cancelled")).toBe(false);
  });

  it("covers every documented state", () => {
    for (const s of SUBSCRIPTION_STATES) {
      // Must not throw — every state has a defined outcome.
      const _ = automationAllowed(s);
      expect(typeof _).toBe("boolean");
    }
  });
});

describe("readOnlyAccessAllowed — invariant", () => {
  it("returns true in every state (PRD §5.4)", () => {
    for (const s of SUBSCRIPTION_STATES) {
      expect(readOnlyAccessAllowed(s)).toBe(true);
    }
  });
});
