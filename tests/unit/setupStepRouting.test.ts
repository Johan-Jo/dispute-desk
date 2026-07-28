/**
 * Step-slug resolution for the wizard route.
 *
 * These assert the RESOLVER, which is what actually decides whether
 * `/app/setup/<slug>` renders a step or the blank invalid-step card.
 *
 * Why a dedicated file: the e2e spec that loads these routes cannot cover
 * this, because an unauthenticated load redirects to Shopify auth BEFORE the
 * page resolves a step — so the e2e passes whether or not resolution works.
 * (Verified 2026-07-28 by reverting the fix: e2e still passed, these fail.)
 * The browser test guards rendering; this guards routing.
 *
 * Regression: `/app/setup/store-profile` (hyphen) resolved to null after the
 * 6→5 merge and rendered a blank "Setup Wizard" card with no way forward.
 * tsc, vitest and the production build were all green.
 */

import { describe, it, expect } from "vitest";
import { resolveStepId, STEP_IDS, WIZARD_STEP_IDS } from "@/lib/setup/constants";
import { normalizeSetupStepParam } from "@/lib/setup/normalizeStepParam";

/** Exactly what `app/(embedded)/app/setup/[step]/page.tsx` computes. */
function resolveRouteSlug(raw: string | string[] | undefined) {
  return resolveStepId(normalizeSetupStepParam(raw));
}

describe("wizard route slug resolution (page pipeline)", () => {
  it("resolves every canonical step id", () => {
    for (const id of WIZARD_STEP_IDS) {
      expect(resolveRouteSlug(id), `canonical "${id}"`).toBe(id);
    }
  });

  it("resolves every step id in its hyphenated form", () => {
    // THE 2026-07-28 REGRESSION. Closes the class: any future step id
    // containing an underscore is covered automatically.
    for (const id of WIZARD_STEP_IDS) {
      const hyphenated = id.replace(/_/g, "-");
      expect(resolveRouteSlug(hyphenated), `hyphenated "${hyphenated}"`).toBe(id);
    }
  });

  it("resolves the pre-merge legacy slugs to handling", () => {
    expect(resolveRouteSlug("coverage")).toBe("handling");
    expect(resolveRouteSlug("automation")).toBe("handling");
  });

  it("survives the Shopify Admin ampersand-in-path quirk", () => {
    // normalizeSetupStepParam exists because Admin produces
    // `/app/setup/handling&dd_debug=1`. Combined with hyphens, both layers
    // of tolerance must compose.
    expect(resolveRouteSlug("handling&dd_debug=1")).toBe("handling");
    expect(resolveRouteSlug("store-profile&foo=1")).toBe("store_profile");
    expect(resolveRouteSlug("store_profile?x=1")).toBe("store_profile");
  });

  it("tolerates casing and stray whitespace", () => {
    expect(resolveRouteSlug("Store-Profile")).toBe("store_profile");
    expect(resolveRouteSlug("  HANDLING  ")).toBe("handling");
  });

  it("still rejects genuinely unknown slugs", () => {
    // Tolerance must not become "resolve anything" — an unknown slug should
    // reach the invalid-step card, not silently render some other step.
    expect(resolveRouteSlug("nonexistent")).toBeNull();
    expect(resolveRouteSlug("")).toBeNull();
    expect(resolveRouteSlug(undefined)).toBeNull();
    expect(resolveRouteSlug("store")).toBeNull();
    expect(resolveRouteSlug("profile")).toBeNull();
  });

  it("no canonical id resolves to a DIFFERENT canonical id", () => {
    // Guards against an over-eager normalisation collapsing two real steps
    // onto one another.
    for (const id of STEP_IDS) {
      expect(resolveRouteSlug(id)).toBe(id);
    }
  });
});
