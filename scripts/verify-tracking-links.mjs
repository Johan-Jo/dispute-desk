/**
 * Verify the bank-facing tracking-link templates against LIVE parcels.
 *
 *   node scripts/verify-tracking-links.mjs
 *
 * WHY THIS EXISTS. `lib/carriers/trackingLinkUrl.ts` rebuilds every
 * tracking URL that reaches an issuer. If a template rots — a carrier
 * retires an endpoint or renames a param — the package keeps printing a
 * link that renders an empty form or "not found", which an issuer reads as
 * "this merchant has no delivery proof". That failure is silent: nothing
 * in CI can catch it, because the truth lives on the carrier's site.
 *
 * WHY A HEADED BROWSER. curl and headless Chromium are both 403'd by
 * Akamai/Imperva on usps.com, ups.com, fedex.com and dhl.com, and these
 * pages are client-rendered SPAs regardless — a fetch of the HTML shell
 * tells you nothing about what a reviewer sees. A headed real-Chrome
 * session with the automation flags stripped renders exactly what a bank
 * reviewer would see. That is the only evidence worth having here.
 *
 * WHY FRESH NUMBERS. Carriers purge tracking data after ~90-120 days, so a
 * stale number returns "not found" from a perfectly good URL and proves
 * nothing. This script pulls currently-Delivered parcels from prod, so a
 * FAIL means the URL is wrong rather than the parcel being forgotten.
 *
 * Requires `npx playwright install chrome` once per machine.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

import { resolveTrackingLinkUrl } from "../lib/carriers/trackingLinkUrl.ts";

/** Pull live, recently-delivered shipments straight from prod. Goes
 *  through the guarded db:query path, so a wrong-DB read fails hard. */
function fetchLiveShipments() {
  const sql = `select company_raw, tracking_number
    from shopify_fulfillment_trackings
    where shipment_status = 'Delivered'
      and tracking_number is not null and tracking_number <> ''
      and updated_at > now() - interval '25 days'
      and company_raw is not null
    order by updated_at desc limit 400`;
  const out = execFileSync(
    "npm",
    ["run", "--silent", "db:query:prod", "--", sql, "--output", "json"],
    { encoding: "utf8", shell: true, maxBuffer: 32 * 1024 * 1024 },
  );
  const rows = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1));
  // One parcel per distinct carrier — enough to prove each template.
  const byCarrier = new Map();
  for (const r of rows) {
    const key = (r.company_raw ?? "").trim();
    if (key && !byCarrier.has(key)) byCarrier.set(key, r.tracking_number);
  }
  return [...byCarrier.entries()];
}

/** Phrases that mean the link did NOT land on the parcel. */
const BAD = [
  "no results", "not successful", "tracking not available", "not available",
  "didn't find", "did not find", "can't find", "cannot find", "invalid",
  "no record", "enter a tracking number",
];
/** Phrases that mean a real shipment record rendered. */
const GOOD = [
  "delivered", "in transit", "out for delivery", "label created",
  "picked up", "levererat", "utlämnad", "livré", "en route",
];

const shipments = fetchLiveShipments();
console.log(`Verifying ${shipments.length} carrier(s) against live parcels…\n`);

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
});
const ctx = await browser.newContext({
  viewport: null,
  locale: "en-US",
  timezoneId: "America/New_York",
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

let failures = 0;
for (const [company, number] of shipments) {
  const { url, source, carrier } = resolveTrackingLinkUrl({ company, number, url: null });
  if (!url || source !== "canonical") {
    console.log(`SKIP     ${company} — no canonical template (source=${source})`);
    continue;
  }
  const page = await ctx.newPage();
  let verdict = "ERROR";
  let detail = "";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // SPAs fetch the shipment after DOM-ready; give them time to render.
    await page.waitForTimeout(14000);
    const text = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");
    const low = text.toLowerCase();
    const good = GOOD.filter((s) => low.includes(s));
    const bad = BAD.filter((s) => low.includes(s));
    verdict = good.length && !bad.length ? "RESOLVES" : bad.length && !good.length ? "FAIL" : "MIXED";
    const i = text.indexOf(number);
    detail = i >= 0 ? text.slice(Math.max(0, i - 80), i + 220) : text.slice(0, 200);
  } catch (e) {
    detail = String(e).slice(0, 140);
  }
  if (verdict !== "RESOLVES") failures++;
  console.log(`${verdict.padEnd(8)} ${company} (${carrier})\n  ${url}\n  ${detail}\n`);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nAll canonical templates resolved." : `\n${failures} template(s) need attention.`);
process.exit(failures === 0 ? 0 : 1);
