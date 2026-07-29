/**
 * §10 manual pass, automated — the embedded Automation page (`/app/rules`).
 *
 * WHY THIS EXISTS. `tsc`, `vitest` and `next build` were all green while
 * `/app/setup/store-profile` rendered a blank card. For this surface the
 * automated suite is not sufficient evidence, so the per-group override work
 * (PRs #448 / #451 / #452) carried a seven-step manual checklist. Steps 1-5 of
 * that checklist are mechanical — click, save, assert a `rules` row — and
 * mechanical checks belong in code. This spec is that checklist.
 *
 * WHAT IT DOES NOT COVER, and why the human pass still matters:
 *   - App Bridge. It only initialises inside the Shopify Admin iframe, so
 *     nothing here exercises it.
 *   - The `sameSite=none; partitioned` (CHIPS) cookie. Admin intermittently
 *     does not send it on in-app navigations — an in-iframe-only failure.
 *     This spec plants the shop cookie via `?shop=`, which is precisely the
 *     path that papers over it.
 *   - "Looks exactly as it did before" is a human judgement.
 * A green run says the group writer does not clobber rows. It does not say
 * the page works in Admin.
 *
 * HOW IT AUTHENTICATES. No session token is involved: `middleware.ts` resolves
 * `?shop=` against the DB (shop row + offline session) and injects `x-shop-id`
 * for the API calls, and `/api/automation/store` reads that header. So a plain
 * browser with `?shop=` is enough. See middleware.ts:784-800, :548-549 and
 * app/api/automation/store/route.ts:41-48.
 *
 * RUN IT (never in CI — it mutates a real shop's automation config):
 *   E2E_EMBEDDED_SHOP=surasvenne.myshopify.com \
 *   PLAYWRIGHT_BASE_URL=https://dev.disputedesk.app \
 *   npx playwright test e2e/embedded-automation-groups.spec.ts
 *
 * The shop's automation config is snapshotted in `beforeAll` and restored in
 * `afterAll` through the canonical PUT, so a run leaves no residue.
 *
 * Step 6 of the checklist (safeguard beats a group: a $900 fraud dispute still
 * reviews at a $500 threshold) is pure tier-engine behaviour with no UI in it.
 * It is covered by "the amount safeguard beats a group (tier-0 over tier-1)"
 * in lib/rules/__tests__/pickAutomationAction.test.ts and is not repeated here.
 */

import {
  test,
  expect,
  type Page,
  type Browser,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SHOP_DOMAIN = process.env.E2E_EMBEDDED_SHOP ?? "";

/** CLAUDE.md #0 — the linked/target project is never trusted blindly. */
const DEV_PROJECT_REF = "vrpkgudqmpyunekrkpnc";

const FRAUD_ROW = "__dd_setup__:group:fraud";
const SAFEGUARD_ROW = "__dd_setup__:safeguard:high_value";
const FRAUD_REASONS = ["FRAUDULENT", "UNRECOGNIZED"];
const GROUP_PRIORITY = 50;

/** Copy from messages/en.json → `rules.*`. The page renders in English on dev. */
const COPY = {
  fraud: "Card fraud",
  notAsDescribed: "Not as described",
  // Distinct from the "Always reviewed" heading on the Safeguards card, which
  // a looser pattern would also match.
  notAsDescribedLocked: /subjective quality claims/i,
  storeDefaultOption: "Store default",
  autoOption: "Automatic",
  reviewOption: "Review before submit",
  safeguardToggle: "Review high-value disputes before sending",
  safeguardAmount: "Minimum amount",
  save: "Save changes",
  customisedBadge: /customised/i,
};

interface StoreConfig {
  mode: "auto" | "review";
  safeguard: { enabled: boolean; amount: number };
  groups: Record<string, "auto" | "review">;
}

let sb: SupabaseClient;
let shopId: string;
let snapshot: StoreConfig;

// ─── Helpers ───────────────────────────────────────────────────────────

function openSb(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  }
  if (!url.includes(DEV_PROJECT_REF) && process.env.E2E_ALLOW_PROD_DB !== "true") {
    throw new Error(
      `Refusing to run: SUPABASE_URL is not the dev project (${DEV_PROJECT_REF}). ` +
        `This spec writes automation config. Set E2E_ALLOW_PROD_DB=true only if you mean it.`,
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** The `rules` row backing a group, or null when the group inherits. */
async function groupRow(name: string) {
  const { data } = await sb
    .from("rules")
    .select("name, match, action, priority, enabled")
    .eq("shop_id", shopId)
    .eq("name", name)
    .maybeSingle();
  return data;
}

async function readConfig(request: APIRequestContext): Promise<StoreConfig> {
  const res = await request.get(`/api/automation/store?shop_id=${shopId}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return {
    mode: body.mode === "auto" ? "auto" : "review",
    safeguard: {
      enabled: Boolean(body.safeguard?.enabled),
      amount: Number(body.safeguard?.amount) || 0,
    },
    groups: body.groups ?? {},
  };
}

async function writeConfig(request: APIRequestContext, config: StoreConfig) {
  const res = await request.put("/api/automation/store", {
    data: { shop_id: shopId, ...config },
  });
  expect(res.status()).toBe(200);
}

/**
 * Block Shopify's App Bridge CDN script.
 *
 * `/app/*` always asks the layout to load `app-bridge.js` (middleware.ts:669).
 * Loaded at top level rather than inside the Admin iframe, that script
 * immediately redirects the tab to
 * `admin.shopify.com/store/<handle>/apps/<key>/app/rules` — which is where an
 * un-blocked run lands, at a Shopify login page. Aborting the request is the
 * least invasive way in: no auth is bypassed and no cookie is forged, the page
 * simply renders without the piece this spec already declares out of scope.
 * `/app/rules` itself never calls App Bridge — its data path is plain `fetch`.
 */
async function blockAppBridge(target: Page | BrowserContext) {
  await target.route("**/app-bridge.js*", (route) => route.abort());
}

/** Load the page with `?shop=`, which is what plants the shop cookie. */
async function openRulesPage(page: Page) {
  await page.goto(`/app/rules?shop=${SHOP_DOMAIN}`);
  await expect(page.getByRole("heading", { name: "Automation" })).toBeVisible();
}

/**
 * An API context that middleware will accept.
 *
 * `/api/automation/store` is NOT open: middleware answers 401 SESSION_REQUIRED
 * unless the request carries the `shopify_shop_id` cookie, and only `/api/setup/*`
 * resolves a bare `?shop=` (middleware.ts:391, :524-536). So the cookie has to be
 * minted the way a browser mints it — by loading an `/app/*` page with `?shop=`,
 * which is the branch at middleware.ts:784-800 — and the resulting context's
 * request object inherits that jar.
 */
async function authedContext(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  await blockAppBridge(context);
  const page = await context.newPage();
  await openRulesPage(page);
  await page.close();
  return context;
}

const groupsToggle = (page: Page) => page.locator('button[aria-controls="automation-groups"]');

/** One row's three-way segmented control. */
const segment = (page: Page, group: string, option: string) =>
  page.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option });

/**
 * The page has ONE commit point, so every edit is a draft until this. Clicking
 * a segment or the safeguard no longer writes anything on its own.
 */
async function saveChanges(page: Page) {
  await expectSaved(page, () =>
    page.getByRole("button", { name: COPY.save }).click(),
  );
}

/** Perform `action` and wait for the PUT it triggers to come back 200. */
async function expectSaved(page: Page, action: () => Promise<unknown>) {
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/automation/store") && r.request().method() === "PUT",
    ),
    action(),
  ]);
  expect(res.status()).toBe(200);
}

// ─── Suite ─────────────────────────────────────────────────────────────

test.describe("embedded /app/rules — per-group overrides (§10 steps 1-5)", () => {
  // One shop, one config: these steps build on each other and must not interleave.
  test.describe.configure({ mode: "serial" });

  test.skip(
    !SHOP_DOMAIN,
    "Set E2E_EMBEDDED_SHOP to a shop that exists in the target DB with an offline session.",
  );

  test.beforeAll(async ({ browser, baseURL }) => {
    sb = openSb();
    const { data, error } = await sb
      .from("shops")
      .select("id")
      .eq("shop_domain", SHOP_DOMAIN)
      .single();
    if (error || !data) throw new Error(`Shop ${SHOP_DOMAIN} not found in the target DB`);
    shopId = data.id;

    const context = await authedContext(browser, baseURL);
    snapshot = await readConfig(context.request);
    // Start from a known floor: store default Review, no overrides, no
    // safeguard. Step 1 asserts what a merchant who has never customised sees.
    await writeConfig(context.request, {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: {},
    });
    await context.close();
  });

  test.afterAll(async ({ browser, baseURL }) => {
    if (!snapshot) return;
    const context = await authedContext(browser, baseURL);
    await writeConfig(context.request, snapshot);
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await blockAppBridge(page);
  });

  test("1 — with no overrides the page reads exactly as it did before", async ({ page }) => {
    await openRulesPage(page);

    // The card renders at all. This is the blank-card class of failure that
    // tsc/vitest/build cannot see.
    await expect(page.getByRole("heading", { name: "Safeguards" })).toBeVisible();

    const toggle = groupsToggle(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The "{n} customised" badge is hidden entirely at zero, not rendered as "0".
    await expect(toggle.getByText(COPY.customisedBadge)).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: COPY.fraud })).toHaveCount(0);
  });

  test("2 — Fraud → Automatic writes one group row at priority 50", async ({ page }) => {
    await openRulesPage(page);
    await groupsToggle(page).click();

    // Starts on "Store default", which is the ABSENCE of an override.
    await expect(segment(page, COPY.fraud, COPY.storeDefaultOption)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await segment(page, COPY.fraud, COPY.autoOption).click();
    // Nothing is written until Save — the page has one commit point.
    expect(await groupRow(FRAUD_ROW), "a segment click must not write on its own").toBeNull();
    await saveChanges(page);

    const row = await groupRow(FRAUD_ROW);
    expect(row, "the fraud group row must exist after selecting Automatic").toBeTruthy();
    expect(row!.match?.reason).toEqual(FRAUD_REASONS);
    expect(row!.priority).toBe(GROUP_PRIORITY);
    expect(row!.action?.mode).toBe("auto");
    expect(row!.enabled).toBe(true);

    await expect(groupsToggle(page).getByText(COPY.customisedBadge)).toBeVisible();
  });

  test("3 — THE BLOCKER: saving the safeguard must not delete the group row", async ({
    page,
  }) => {
    // The regression PR #448 exists to prevent: `writeStoreAutomation` used to
    // delete every `__dd_setup__:%` row before rewriting the ones it knew
    // about, so an unrelated safeguard save silently dropped the groups.
    expect(await groupRow(FRAUD_ROW), "precondition: step 2 left a fraud row").toBeTruthy();

    await openRulesPage(page);
    await page.getByLabel(COPY.safeguardToggle).check();
    const amount = page.getByLabel(COPY.safeguardAmount);
    await amount.fill("500");
    await saveChanges(page);

    const row = await groupRow(FRAUD_ROW);
    expect(row, "the fraud group row must SURVIVE a safeguard save").toBeTruthy();
    expect(row!.action?.mode).toBe("auto");
    expect(row!.match?.reason).toEqual(FRAUD_REASONS);

    // And the safeguard itself landed, so this is not passing by no-op.
    // `__dd_setup__:safeguard:high_value` — NOT the legacy `__dd_safeguard__:`
    // name, which is read-and-delete only (storeAutomationNames.ts:13,19).
    const safeguard = await sb
      .from("rules")
      .select("name, match")
      .eq("shop_id", shopId)
      .eq("name", SAFEGUARD_ROW)
      .maybeSingle();
    expect(safeguard.data, "the safeguard row must have been written").toBeTruthy();
    expect(safeguard.data!.match?.amount_range?.min).toBe(500);
  });

  test("4 — back to Store default removes the row", async ({ page }) => {
    await openRulesPage(page);
    // The section auto-opens when overrides already exist.
    await expect(groupsToggle(page)).toHaveAttribute("aria-expanded", "true");

    await expect(segment(page, COPY.fraud, COPY.autoOption)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await segment(page, COPY.fraud, COPY.storeDefaultOption).click();
    await saveChanges(page);

    expect(await groupRow(FRAUD_ROW), "inheriting means no row at all").toBeNull();
    await expect(groupsToggle(page).getByText(COPY.customisedBadge)).toHaveCount(0);
  });

  test("5 — not_as_described is a fact, not a control, and the API enforces it", async ({
    page,
  }) => {
    await openRulesPage(page);
    await groupsToggle(page).click();

    // A greyed-out control reads as "you can't afford this" — the plan-gate
    // idiom already on this page. A badge reads as a fact.
    await expect(page.getByRole("radiogroup", { name: COPY.notAsDescribed })).toHaveCount(0);
    await expect(page.getByText(COPY.notAsDescribedLocked)).toBeVisible();

    // The lock is enforced server-side too: the UI is not the only gate.
    // `page.request` shares the page's cookie jar, so middleware accepts it.
    const res = await page.request.put("/api/automation/store", {
      data: {
        shop_id: shopId,
        mode: "review",
        safeguard: { enabled: false, amount: 0 },
        groups: { not_as_described: "auto" },
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("not_as_described");

    expect(await groupRow("__dd_setup__:group:not_as_described")).toBeNull();
  });
});
