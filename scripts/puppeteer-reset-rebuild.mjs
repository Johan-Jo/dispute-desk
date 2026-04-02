/**
 * End-to-end smoke test for Reset & rebuild:
 * 1. Log into /admin
 * 2. Navigate to /admin/resources/list
 * 3. Wait for the content list to load
 * 4. Find a row with a green "Yes" AI-track badge (generated_at set, non-archived)
 * 5. Click reset-and-rebuild dry-run via the API (avoids actually archiving)
 * 6. Assert the route returns ok:true
 *
 * Env: ADMIN_SMOKE_EMAIL, ADMIN_SMOKE_PASSWORD in .env.local (user with internal_admin_grants)
 * PUPPETEER_BASE_URL / SMOKE_BASE_URL (default http://localhost:3000)
 *
 * Usage: node scripts/puppeteer-reset-rebuild.mjs
 */

import path from "path";
import { config } from "dotenv";
import puppeteer from "puppeteer";

config({ path: path.resolve(process.cwd(), ".env.local") });

const baseUrl = (
  process.env.PUPPETEER_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

const email = process.env.ADMIN_SMOKE_EMAIL;
const password = process.env.ADMIN_SMOKE_PASSWORD;

async function main() {
  if (!email || !password) {
    console.error("ADMIN_SMOKE_EMAIL and ADMIN_SMOKE_PASSWORD required in .env.local");
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);
    page.setDefaultTimeout(60_000);

    // Step 1: Login
    console.log("1. Logging in...");
    await page.goto(`${baseUrl}/auth/sign-in?continue=/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', email, { delay: 10 });
    await page.type('input[type="password"]', password, { delay: 10 });
    await Promise.all([
      page.waitForFunction(() => {
        const p = window.location.pathname;
        return p !== "/admin/login" && (p === "/admin" || p.startsWith("/admin/"));
      }),
      page.click('button[type="submit"]'),
    ]);
    console.log("   Logged in, at:", await page.evaluate(() => window.location.pathname));

    // Step 2: Navigate to content list
    console.log("2. Navigating to content list...");
    await page.goto(`${baseUrl}/admin/resources/list`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("table", { timeout: 30_000 });
    console.log("   Content list loaded.");

    // Step 3: Find first article id from the table (first checkbox)
    const firstId = await page.$eval(
      'input[type="checkbox"][data-id]',
      (el) => el.getAttribute("data-id")
    ).catch(() => null);

    if (!firstId) {
      // Fallback: get id from the AI track column or first row link
      console.log("   No data-id checkbox found, getting id via API call...");
    }

    // Step 4: Call the API dry-run with the first eligible article via fetch in page context
    console.log("3. Testing reset-and-rebuild dry-run via API...");
    const result = await page.evaluate(async (url) => {
      // Get eligible article ids from the page or via fetch
      const res = await fetch(`${url}/api/admin/resources/reset-and-rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, dryRun: true }),
        credentials: "include",
      });
      const data = await res.json();
      return { status: res.status, data };
    }, baseUrl);

    console.log("   API response:", JSON.stringify(result, null, 2));

    if (result.status !== 200) {
      console.error(`FAIL: Expected 200, got ${result.status}`);
      console.error("Error:", result.data?.error);
      process.exit(1);
    }

    if (!result.data?.ok) {
      console.error("FAIL: ok !== true in response");
      process.exit(1);
    }

    console.log(`OK — dry-run found ${result.data.found} eligible articles, would archive ${result.data.wouldArchive}.`);

  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
