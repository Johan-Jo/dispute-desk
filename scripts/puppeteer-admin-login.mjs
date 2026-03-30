/**
 * Browser smoke: open /admin/login, submit ADMIN_SECRET, confirm redirect to /admin.
 *
 * Requires a running app, e.g. `npx next dev -p 3099`
 * Env: ADMIN_SECRET in .env.local; optional PUPPETEER_BASE_URL / SMOKE_BASE_URL (default http://localhost:3099)
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

const secret = process.env.ADMIN_SECRET;

async function main() {
  if (!secret) {
    console.error("ADMIN_SECRET missing — set it in .env.local");
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(120_000);

  await page.goto(`${baseUrl}/admin/login`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="password"]', secret, { delay: 10 });
  await Promise.all([
    page.waitForFunction(() => {
      const p = window.location.pathname;
      if (p === "/admin/login") return false;
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
