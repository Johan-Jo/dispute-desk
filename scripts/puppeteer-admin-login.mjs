/**
 * Browser smoke: sign in via /auth/sign-in (portal), continue=/admin, confirm dashboard.
 *
 * Requires a running app, e.g. `npx next dev -p 3099`
 * Env: ADMIN_SMOKE_EMAIL, ADMIN_SMOKE_PASSWORD in .env.local (user must have internal_admin_grants)
 * Optional: PUPPETEER_BASE_URL / SMOKE_BASE_URL (default http://localhost:3099)
 *
 * Usage: node scripts/puppeteer-admin-login.mjs
 */

import path from "path";
import { config } from "dotenv";
import puppeteer from "puppeteer";

config({ path: path.resolve(process.cwd(), ".env.local") });

const baseUrl = (
  process.env.PUPPETEER_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  "http://localhost:3099"
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
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(120_000);

  await page.goto(`${baseUrl}/auth/sign-in?continue=/admin`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', email, { delay: 10 });
  await page.type('input[type="password"]', password, { delay: 10 });
  await Promise.all([
    page.waitForFunction(() => {
      const p = window.location.pathname;
      return p === "/admin" || (p.startsWith("/admin/") && !p.endsWith("/login"));
    }, { timeout: 120_000 }),
    page.click('button[type="submit"]'),
  ]);

  const h1 = await page.$eval("h1", (el) => el.textContent?.trim());
  await browser.close();

  if (!h1 || !/dashboard/i.test(h1)) {
    console.error("Expected admin dashboard <h1>, got:", h1);
    process.exit(1);
  }

  console.log("OK — Puppeteer reached /admin and saw dashboard heading.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
