# Visual regression baselines

Conservative Playwright screenshot coverage for stable UI surfaces. Catches
layout/CSS regressions from refactors without becoming a maintenance burden.

## Scope (current)

- `auth-signin.spec.ts` — `/auth/sign-in`. No auth required, fully static.

## Why so narrow

Most of DisputeDesk's high-value UI lives at `/app/*` (the embedded Shopify
admin app). Those routes require an App Bridge session token from a real
Shopify Admin host parameter and cannot be loaded by Playwright without
a test-mode session bridge. Adding that bridge is a separate, larger ticket
and is **deliberately out of scope** for this initial visual harness.

The portal pages at `/portal/*` use Supabase Auth and are reachable
(see `e2e/portal-sections.spec.ts` for the sign-in helper), but their
content is data-driven (KPI numbers, recent disputes) and would require
heavy masking to be deterministic. They are good candidates for a follow-up
spec once we have a stable seed-data fixture.

## Adding a new screenshot

1. Pick a route that is either fully static or where dynamic regions can
   be cleanly masked with `mask: [page.locator(...)]`.
2. Use a fixed viewport (`page.setViewportSize({ width: 1280, height: 800 })`).
3. `await page.waitForLoadState("networkidle")` before capturing.
4. `await expect(page).toHaveScreenshot("<name>.png", { fullPage: false })`.
5. Run `npm run test:visual -- --update-snapshots` to generate the baseline.
6. Commit the generated `*-snapshots/` PNGs alongside the spec.

## Running

```
npm run test:visual                       # compare against baselines
npm run test:visual -- --update-snapshots # regenerate baselines (after intentional UI changes)
```

## Baselines and platform

Playwright screenshots are platform-specific (font rendering, AA). Check in
the baselines from the OS that runs CI. Local macOS/Windows runs may show
trivial diffs against Linux baselines — that is expected, not a regression.
Re-baseline only on intentional UI changes, never to "make the test pass".
