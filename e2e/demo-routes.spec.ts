/**
 * Smoke check that every public demo route hydrates without a client-side
 * exception.
 *
 * Closes the exact regression class that broke prod on 2026-07-07: the
 * `/demo` dashboard re-uses the real embedded dashboard component and feeds
 * it fixture data (`lib/demo/fixtures/realDashboardStats.ts`). When the
 * dashboard gained new required `*Split` fields and the fixture wasn't
 * updated, `s.operationalSplit["new"]` hit `undefined["new"]` and threw
 * "Cannot read properties of undefined (reading 'new')" — the whole
 * dashboard failed to hydrate and rendered Next's "Application error"
 * fallback. build / lint / tsc / vitest all passed; only a real browser
 * loading the page surfaces a runtime hydration crash.
 *
 * This test loads each demo route and fails on ANY uncaught page error or
 * console error, so a future fixture/shape drift fails in CI instead of on
 * a live demo.
 *
 * No auth required; demo routes are public and served from static fixtures.
 */

import { test, expect, type ConsoleMessage } from "@playwright/test";
import { DEMO_DISPUTES } from "../lib/demo/fixtures/disputes";

// One representative dispute id from the fixtures so the detail route is
// covered without hard-coding an id that could be renamed.
const SAMPLE_DISPUTE_ID = DEMO_DISPUTES[0]?.id ?? "dp-2401";

const ROUTES: string[] = [
  "/demo",
  "/demo/disputes",
  `/demo/disputes/${SAMPLE_DISPUTE_ID}`,
  "/demo/coverage",
  "/demo/rules",
  "/demo/packs",
  "/demo/insights/initial-analysis",
];

// Third-party/analytics requests that fail in a headless context (blocked
// beacons, no consent) must not fail the test — they are not our bugs.
const IGNORED_CONSOLE = [
  /google-analytics/i,
  /googletagmanager/i,
  /net::ERR_ABORTED/i,
  /Failed to load resource/i,
];

function isRealConsoleError(msg: ConsoleMessage): boolean {
  if (msg.type() !== "error") return false;
  const text = msg.text();
  return !IGNORED_CONSOLE.some((re) => re.test(text));
}

test.describe("public demo routes hydrate without errors", () => {
  for (const path of ROUTES) {
    test(`${path} loads with no client-side exception`, async ({ page }) => {
      // Cold Next dev compiles each route on first hit, and the demo runs
      // GA beacons + a guided tour that keep the network busy — so
      // `networkidle` never settles. Use `domcontentloaded` + a fixed
      // settle window (a hydration crash surfaces well within it), and give
      // the whole test room for on-demand compilation.
      test.setTimeout(90_000);

      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];

      page.on("pageerror", (err) => pageErrors.push(String(err.stack || err.message || err)));
      page.on("console", (msg) => {
        if (isRealConsoleError(msg)) consoleErrors.push(msg.text());
      });

      const res = await page.goto(path, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      expect(res?.status(), `${path} returned ${res?.status()}`).toBe(200);

      // Give client effects (fetch shim → data render) time to run and,
      // crucially, time for a hydration error to surface.
      await page.waitForTimeout(2_500);

      // Next.js renders this text into the DOM when a client-side
      // exception escapes — the exact symptom the demo hit in prod.
      await expect(
        page.getByText("Application error: a client-side exception has occurred"),
      ).toHaveCount(0);

      expect(
        pageErrors,
        `${path} threw an uncaught page error (likely a fixture/shape drift — see lib/demo/fixtures):\n${pageErrors.join("\n")}`,
      ).toEqual([]);
      expect(
        consoleErrors,
        `${path} logged console errors:\n${consoleErrors.join("\n")}`,
      ).toEqual([]);
    });
  }
});
