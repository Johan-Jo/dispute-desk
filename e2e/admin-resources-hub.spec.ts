import { test, expect } from "@playwright/test";

test.setTimeout(60_000);

const ADMIN_SMOKE_EMAIL =
  process.env.ADMIN_SMOKE_EMAIL ?? process.env.E2E_TEST_EMAIL;
const ADMIN_SMOKE_PASSWORD =
  process.env.ADMIN_SMOKE_PASSWORD ?? process.env.E2E_TEST_PASSWORD;

/** Pages that do not require a dynamic content id. */
const RESOURCES_HUB_PATHS = [
  "/admin/resources",
  "/admin/resources/list",
  "/admin/resources/backlog",
  "/admin/resources/calendar",
  "/admin/resources/queue",
  "/admin/resources/archive",
  "/admin/resources/settings",
];

async function adminLogin(page: import("@playwright/test").Page) {
  await page.goto("/auth/sign-in?continue=/admin");
  await page.locator('input[type="email"]').fill(ADMIN_SMOKE_EMAIL!);
  await page.locator('input[type="password"]').first().fill(ADMIN_SMOKE_PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/admin/, { timeout: 60_000 });
}

test.describe("Admin Resources Hub smoke", () => {
  test.skip(
    !ADMIN_SMOKE_EMAIL || !ADMIN_SMOKE_PASSWORD,
    "Set ADMIN_SMOKE_EMAIL / ADMIN_SMOKE_PASSWORD (or E2E_TEST_*) in .env.local; user must have internal_admin_grants.",
  );

  test("authenticated navigation returns 200 for hub pages", async ({ page }) => {
    await adminLogin(page);

    for (const path of RESOURCES_HUB_PATHS) {
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(
        response?.ok(),
        `${path} should return 2xx, got ${response?.status()}`
      ).toBeTruthy();
      await expect(page.locator("body")).toBeVisible({ timeout: 15_000 });
    }
  });

  test("editor loads when at least one content item exists", async ({ page }) => {
    await adminLogin(page);

    const listRes = await page.request.get(
      "/api/admin/resources/content?pageSize=1&page=1"
    );
    expect(listRes.ok()).toBeTruthy();
    const data = (await listRes.json()) as {
      items?: Array<{ id: string }>;
    };
    const id = data.items?.[0]?.id;
    if (!id) {
      test.skip();
      return;
    }

    const response = await page.goto(`/admin/resources/content/${id}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("body")).toBeVisible({ timeout: 15_000 });
  });
});
