import { test, expect } from "@playwright/test";

test.setTimeout(60_000);

const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;

async function portalSignIn(page: import("@playwright/test").Page) {
  await page.goto("/auth/sign-in", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
  await emailInput.click();
  await emailInput.pressSequentially(E2E_EMAIL!, { delay: 20 });

  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  await passwordInput.click();
  await passwordInput.pressSequentially(E2E_PASSWORD!, { delay: 20 });

  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/portal\//, { timeout: 30_000 });

  const errorEl = page.locator("p.text-\\[\\#EF4444\\]");
  if (await errorEl.count() > 0) {
    const errorText = await errorEl.first().textContent();
    throw new Error(`Sign-in failed: "${errorText}"`);
  }
}

test.describe("Portal Setup Checklist", () => {
  test.beforeEach(async () => {
    test.skip(
      !E2E_EMAIL || !E2E_PASSWORD,
      "E2E_TEST_EMAIL and E2E_TEST_PASSWORD required in .env.local"
    );
  });

  test("shows connect-store checklist for users with no linked shop", async ({
    page,
  }) => {
    await portalSignIn(page);

    await expect(
      page.getByTestId("setup-checklist-card")
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("heading", { name: "Setup Checklist" })
    ).toBeVisible();

    await expect(
      page.getByText("Connect your Shopify store")
    ).toBeVisible();

    await expect(
      page.getByText("Connect store").first()
    ).toBeVisible();

    const connectLink = page.locator(
      '[data-testid="setup-checklist-card"] a[href="/portal/connect-shopify"]'
    );
    await expect(connectLink.first()).toBeVisible();

    const lockedSteps = page.locator(
      '[data-testid="setup-checklist-card"] .opacity-50'
    );
    await expect(lockedSteps).toHaveCount(7);

    await expect(
      page.getByText("Complete store connection to unlock remaining steps")
    ).toBeVisible();
  });
});
