/**
 * Puppeteer verifier for the demo tour.
 *
 * Walks the 8-step guided tour by clicking the Next button on each
 * step. After each step settles, reports whether the spotlight ring
 * rendered (`hasRing`), what its target rect is, and which path the
 * tour landed on. Saves a screenshot per step to /tmp/dd-tour-stepN.png.
 *
 * Usage:
 *   node scripts/demo/verify-tour.mjs
 *   (dev server must be running on http://localhost:3000)
 */

import puppeteer from "puppeteer";

const BASE = "http://localhost:3000";

const VIEWPORT = { width: 1600, height: 1000 };

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function summarize(page, step) {
  return page.evaluate(() => {
    // Find the ring div (z-50, fixed, boxShadow with purple ring)
    const candidates = document.querySelectorAll("div.fixed.z-50.pointer-events-none");
    let ring = null;
    for (const c of candidates) {
      const cs = window.getComputedStyle(c);
      if (cs.boxShadow.includes("rgb(124, 58, 237)")) {
        ring = c;
        break;
      }
    }
    const callout = document.querySelector(".fixed.z-50.pointer-events-auto");
    const calloutTitle = callout?.querySelector("h3")?.textContent?.trim() ?? null;
    const stepText = callout?.querySelector("span.text-xs")?.textContent?.trim() ?? null;
    return {
      url: window.location.pathname,
      hasRing: !!ring,
      ringRect: ring ? ring.getBoundingClientRect().toJSON() : null,
      ringSelector: ring?.style?.boxShadow?.slice(0, 60) ?? null,
      calloutTitle,
      stepText,
      polarisLegacyCardCount: document.querySelectorAll(".Polaris-LegacyCard").length,
      h2Texts: Array.from(document.querySelectorAll("h2")).map((h) => h.textContent?.trim()).slice(0, 8),
    };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  console.log("Loading /demo …");
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle0", timeout: 30000 });

  // Wait for tour to mount (mounted state flips after first effect).
  await sleep(1500);

  let step = await summarize(page, 1);
  console.log(`\n=== STEP 1 ===`);
  console.log(JSON.stringify(step, null, 2));
  await page.screenshot({ path: `/tmp/dd-tour-step1.png` });

  // Walk through all 8 steps via Next button.
  for (let i = 2; i <= 8; i++) {
    // Find the "Next" button by text content.
    await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const b of buttons) {
        const t = b.textContent?.trim() ?? "";
        if (t.startsWith("Next") || t === "DisputeDesk is free to try!") {
          b.click();
          return;
        }
      }
    });
    // Wait for navigation + settling.
    await sleep(2500);
    step = await summarize(page, i);
    console.log(`\n=== STEP ${i} ===`);
    console.log(JSON.stringify(step, null, 2));
    await page.screenshot({ path: `/tmp/dd-tour-step${i}.png` });
  }

  await browser.close();
  console.log("\nDone. Screenshots at /tmp/dd-tour-step*.png");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
