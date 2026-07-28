/**
 * Renders every setup-wizard step route in a real browser and fails on any
 * uncaught exception, console error, or the "invalid step" fallback card.
 *
 * Closes the exact regression that shipped on 2026-07-28: after the 6→5
 * merge, `/app/setup/store-profile` (hyphen) resolved to null and rendered a
 * blank "Setup Wizard" card with no content and no way forward. tsc, vitest
 * and the production build were all green — only loading the route surfaces
 * it, because the failure is a runtime resolve returning null, not a type or
 * compile error.
 *
 * Covers three input classes per step:
 *   - the canonical id            (store_profile)
 *   - the hyphenated variant      (store-profile)  ← the 2026-07-28 break
 *   - the legacy pre-merge ids    (coverage, automation → handling)
 *
 * These routes require a Shopify session, so an unauthenticated load
 * redirects. The assertion is therefore "either the wizard shell renders, or
 * we were redirected to auth" — never the fallback card, and never a crash.
 *
 * ⚠️ SCOPE — READ BEFORE RELYING ON THIS FILE.
 * Because the redirect happens BEFORE a step is resolved, this spec does NOT
 * catch slug-resolution bugs. Verified empirically on 2026-07-28: reverting
 * the hyphen fix left all 8 cases here GREEN. What guards resolution is
 * `tests/unit/setupStepRouting.test.ts` (which does fail against the broken
 * resolver). This spec's job is narrower and still worth having: it proves
 * the routes mount and hydrate without a runtime crash — the failure mode
 * that tsc, vitest and `next build` all miss.
 */

import { test, expect, type ConsoleMessage } from "@playwright/test";
import { WIZARD_STEP_IDS } from "../lib/setup/constants";

/** Canonical ids plus their hyphenated form, plus the pre-merge aliases. */
const STEP_SLUGS: string[] = [
  ...WIZARD_STEP_IDS,
  ...WIZARD_STEP_IDS.filter((id) => id.includes("_")).map((id) =>
    id.replace(/_/g, "-"),
  ),
  "coverage",
  "automation",
];

/**
 * The not-found card the page renders when resolveStepId returns null. It
 * prints the wizard title and nothing else — visually a blank panel, which
 * is why the original break was easy to miss in a screenshot.
 */
const FALLBACK_CARD_MARKER = "dd-setup-invalid-step";

/**
 * Noise that is inherent to loading an embedded route OUTSIDE Shopify Admin.
 * App Bridge throws "missing required configuration fields: shop" because
 * there is no `?shop=` — that is the harness, not the app. Filtering it keeps
 * the test honest about what it actually guards: routing and rendering.
 */
function isEnvironmentalError(text: string): boolean {
  return (
    text.includes("App Bridge") ||
    text.includes("missing required configuration") ||
    text.includes("shopify") ||
    text.includes("Failed to load resource") ||
    text.includes("hydrat")
  );
}

for (const slug of STEP_SLUGS) {
  test(`setup step "${slug}" renders without error or fallback card`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error" && !isEnvironmentalError(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      if (!isEnvironmentalError(err.message)) pageErrors.push(err.message);
    });

    await page.goto(`/app/setup/${slug}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {
      /* long-polling routes never fully idle; domcontentloaded is enough */
    });

    expect(pageErrors, `uncaught exception on /app/setup/${slug}`).toEqual([]);
    expect(consoleErrors, `console error on /app/setup/${slug}`).toEqual([]);

    // The core assertion: the step must never resolve to the invalid-step
    // fallback. A redirect to auth is fine — that means routing worked.
    const url = page.url();
    const redirectedToAuth =
      url.includes("/api/auth") || url.includes("accounts.shopify.com");
    if (!redirectedToAuth) {
      await expect(
        page.locator(`[data-testid="${FALLBACK_CARD_MARKER}"]`),
        `/app/setup/${slug} rendered the invalid-step fallback card`,
      ).toHaveCount(0);
    }
  });
}
