#!/usr/bin/env node
/**
 * Generate the DisputeDesk Shopify app icon in the brand blue gradient.
 * Mirrors the shield used on the embedded welcome page
 * (app/(embedded)/app/setup/page.tsx) so the Admin breadcrumb, in-app icon,
 * and welcome hero all match.
 *
 * Outputs:
 *   assets/disputedesk-app-icon-1200.png      (for Shopify Partner Dashboard)
 *   assets/disputedesk-icon-1200x1200.png     (kept in sync, same artwork)
 *   public/shield-icon.png (512x512, regenerated to match exactly)
 *
 * Run: `node scripts/generate-app-icon.mjs`
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function shieldSvg(size) {
  // 1200x1200 canvas; rounded square background with brand blue gradient,
  // centered white shield path (from the welcome page, upscaled).
  const corner = Math.round(size * 0.22); // matches ~iOS app-icon curvature
  // Shield path scaled to fill ~55% of the canvas, centered.
  const glyphSize = size * 0.55;
  const offset = (size - glyphSize) / 2;
  const stroke = Math.max(2, size * 0.045);
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1D4ED8"/>
      <stop offset="100%" stop-color="#3B82F6"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${corner}" ry="${corner}" fill="url(#bg)"/>
  <g transform="translate(${offset} ${offset}) scale(${glyphSize / 24})"
     fill="none" stroke="#ffffff" stroke-width="${(stroke / glyphSize) * 24}"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </g>
</svg>`;
}

async function render(outPath, size) {
  const svg = Buffer.from(shieldSvg(size));
  await sharp(svg).png({ compressionLevel: 9 }).toFile(outPath);
  console.log(`  ${outPath} (${size}x${size})`);
}

console.log("Generating DisputeDesk blue shield icon:");
await render(resolve(root, "assets/disputedesk-app-icon-1200.png"), 1200);
await render(resolve(root, "assets/disputedesk-icon-1200x1200.png"), 1200);
await render(resolve(root, "public/shield-icon.png"), 512);
console.log("Done.");
