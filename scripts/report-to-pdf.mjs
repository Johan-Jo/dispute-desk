/**
 * Render an Artifact-style HTML report to PDF.
 *
 * The reports we publish as Artifacts are body fragments — they carry
 * their own <title>/<link>/<style> but no <html>/<head>/<body>, because
 * the Artifact host wraps them at publish time. This script supplies an
 * equivalent wrapper plus a print stylesheet, then drives headless
 * Chromium's print pipeline.
 *
 * Two things the screen design cannot be trusted to do on paper, both
 * handled here rather than in the report source:
 *   1. Theme. The reports are theme-aware, and a PDF rendered under a
 *      dark OS would come out dark. The wrapper stamps data-theme="light"
 *      AND the page emulates a light color scheme, so both the [data-theme]
 *      block and the prefers-color-scheme block resolve to light.
 *   2. Page breaks. Cards, stat tiles and table rows are told not to
 *      split; headings are told to stay with what follows them.
 *
 * Usage:
 *   node scripts/report-to-pdf.mjs <input.html> <output.pdf> [--landscape]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

/**
 * Chromium's PDF writer does NOT embed variable fonts — it silently
 * substitutes a system fallback, so a report set in Newsreader and IBM
 * Plex Sans comes out in Arial while IBM Plex Mono (which Google Fonts
 * only ships as statics) survives. Observed on the first run of this
 * script: 3 Plex Mono faces embedded, ArialMT everywhere else.
 *
 * Google serves statics instead of variables when the requesting UA
 * predates variable-font support. So: re-request each family as plain
 * per-weight statics under a legacy UA, download them, and inline the
 * lot as data: URIs. The rendered page then has no font network
 * dependency at all, which also makes the output reproducible.
 */
const LEGACY_UA =
  "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0";

/** Pull family names + numeric weights out of a Google Fonts css2 URL.
 *  Handles axis tuples (`ital,opsz,wght@0,6..72,400`) as well as bare
 *  weight lists (`wght@400;500`) — the weight is the last component of
 *  each tuple in css2's documented axis ordering. Upright faces only;
 *  this deck uses no italics. */
function parseFamilies(cssUrl) {
  // URLSearchParams is doing real work here: it collects every `family`
  // param (the first arrives as `?family=`, the rest as `&family=`, so a
  // naive split on "&family=" silently drops the first font), and it
  // decodes `+` to a space, which decodeURIComponent does not.
  return new URL(cssUrl).searchParams.getAll("family").map((entry) => {
    const [name, spec = ""] = entry.split(":");
    const at = spec.indexOf("@");
    const weights =
      at === -1
        ? ["400"]
        : spec
            .slice(at + 1)
            .split(";")
            .map((tuple) => tuple.split(",").pop())
            .filter((w) => /^\d+$/.test(w));
    return { name, weights: [...new Set(weights)].sort() };
  });
}

async function inlineFontCss(cssUrl) {
  const families = parseFamilies(cssUrl);
  if (!families.length) return "";

  const staticUrl =
    "https://fonts.googleapis.com/css2?" +
    families
      .map(
        (f) =>
          `family=${encodeURIComponent(f.name).replace(/%20/g, "+")}:wght@${f.weights.join(";")}`,
      )
      .join("&") +
    "&display=swap";

  const css = await fetch(staticUrl, {
    headers: { "User-Agent": LEGACY_UA },
  }).then((r) => r.text());

  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
  const bytes = new Map(
    await Promise.all(
      urls.map(async (u) => {
        const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
        return [u, `data:font/woff;base64,${buf.toString("base64")}`];
      }),
    ),
  );

  let inlined = css;
  for (const [u, dataUri] of bytes) inlined = inlined.split(u).join(dataUri);
  console.log(
    `Inlined ${urls.length} static font files across ${families.length} families`,
  );
  return inlined;
}

const [inputArg, outputArg, ...rest] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error(
    "\nUsage: node scripts/report-to-pdf.mjs <input.html> <output.pdf> [--landscape]\n",
  );
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const landscape = rest.includes("--landscape");

const rawFragment = readFileSync(inputPath, "utf-8");

// Swap the report's Google Fonts <link> for inlined statics.
const linkMatch = rawFragment.match(
  /<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/,
);
const inlinedFontCss = linkMatch ? await inlineFontCss(linkMatch[1]) : "";
const fragment = rawFragment
  .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, "");

// Print stylesheet. Appended after the report's own <style>, so these win
// on equal specificity; `!important` only where the screen rule is a
// deliberate full-bleed that paper cannot use.
const PRINT_CSS = `
@page { size: A4${landscape ? " landscape" : ""}; margin: 15mm 13mm 17mm; }

html, body {
  background: #FFFFFF !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
body { padding: 0 !important; font-size: 10.4pt; line-height: 1.55; }
.wrap { max-width: none !important; }
.col, .summary, .headline, .correction { max-width: none !important; }

/* Screen leans on generous vertical rhythm; paper does not need it. */
header.mast { padding: 0 0 22px !important; margin-bottom: 26px !important; }
section { margin-bottom: 30px !important; }
h1 { font-size: 26pt !important; }
h2 { font-size: 16pt !important; }
h3 { font-size: 11.4pt !important; }
.headline .big { font-size: 30pt !important; }
.stat .v { font-size: 17pt !important; }
.mech .val { font-size: 15pt !important; }

/* The screen design draws its hairline separators by giving a flex/grid
   container a grey background and letting it show through 1px gaps. On
   paper that is a trap: when the container splits across a page,
   Chromium paints the background down to the bottom of the page while
   the next child moves to the next page, leaving a solid grey slab
   where a card should be. Rebuild the separators as real borders on the
   children so there is no container background left to smear. */
.acts, ol.acts, .mech {
  background: transparent !important;
  gap: 0 !important;
}
.acts > .act, ol.acts > li, .mech > div {
  border-bottom: 1px solid var(--rule);
}
.acts > .act:last-child, ol.acts > li:last-child, .mech > div:last-child {
  border-bottom: 0;
}

/* Small containers never split, so their background technique is safe —
   pin them so it stays that way. */
.stats, .split { break-inside: avoid; page-break-inside: avoid; }

/* Keep every self-contained block whole. */
.find, .summary, .headline, .correction, figure,
.split > div, .mech > div, .stat, .note {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Action cards are the tallest blocks in the deck; forcing them whole
   pushed a full card to the next page and left half a page empty. Let
   them flow, but never strand a heading or a lone line. */
.act { break-inside: auto; orphans: 3; widows: 3; }
.act-top, .act h3 { break-after: avoid; page-break-after: avoid; }

/* Tables: repeat the header on each page, never split a row. */
table { break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.tw { overflow-x: visible !important; }

/* A heading stranded at the foot of a page reads as a mistake. */
h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
.sec-head { break-inside: avoid; break-after: avoid; }

/* The stat strip is a grid of 1px-gap tiles; a page break through the
   gap leaves a hairline orphan, so keep the strip together. */
.stats { break-inside: avoid; page-break-inside: avoid; }

/* Chart SVGs scale to container width — cap them so a wide chart does
   not consume a whole page. */
figure svg { max-height: 78mm; }
`;

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><style>${inlinedFontCss}</style></head>
<body>
${fragment}
<style>${PRINT_CSS}</style>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ colorScheme: "light" });

await page.setContent(html, { waitUntil: "networkidle" });
// Google Fonts load via @font-face; without this the PDF can capture the
// fallback stack mid-swap.
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: "print", colorScheme: "light" });

const pdf = await page.pdf({
  format: "A4",
  landscape,
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate: `
    <div style="width:100%;font-family:'IBM Plex Mono',monospace;font-size:7pt;
                color:#6D7C82;padding:0 13mm;display:flex;
                justify-content:space-between;">
      <span>DisputeDesk</span>
      <span class="pageNumber"></span>
    </div>`,
});

await browser.close();

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, pdf);
console.log(`Wrote ${outputPath} (${(pdf.length / 1024).toFixed(0)} KB)`);
