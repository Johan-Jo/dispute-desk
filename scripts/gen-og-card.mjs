// One-off generator for the marketing OG card (1200×630).
// Recreates the shield hero: dark navy gradient bg, glowing shield, eyebrow,
// title, tagline. Rasterizes the inline SVG to public/og/disputedesk-og.png.
// Run: node scripts/gen-og-card.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "..", "public", "og", "disputedesk-og.png");

const W = 1200;
const H = 630;

// Shield path (centered, ~150px tall) drawn around origin then translated.
const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="80%">
      <stop offset="0%" stop-color="#1c2b4a"/>
      <stop offset="55%" stop-color="#0f1a30"/>
      <stop offset="100%" stop-color="#0a1322"/>
    </radialGradient>
    <linearGradient id="shield" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4f7fff"/>
      <stop offset="100%" stop-color="#2b54d4"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="22" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="20"
        fill="none" stroke="#33415f" stroke-opacity="0.5" stroke-width="1.5"/>

  <!-- shield -->
  <g transform="translate(600 150)" filter="url(#glow)">
    <path d="M 0 -78
             C 34 -52, 70 -52, 86 -52
             C 86 12, 56 70, 0 96
             C -56 70, -86 12, -86 -52
             C -70 -52, -34 -52, 0 -78 Z"
          fill="url(#shield)" stroke="#7aa0ff" stroke-width="3"/>
    <path d="M -34 0 L -8 30 L 40 -28"
          fill="none" stroke="#ffffff" stroke-width="13"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <text x="600" y="350" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="22"
        letter-spacing="6" fill="#7e93b8" font-weight="600">§ CHARGEBACK DEFENCE AUTOMATION</text>

  <text x="600" y="445" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="92"
        fill="#ffffff" font-weight="800">DisputeDesk</text>

  <text x="600" y="510" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="32"
        fill="#c4d0e6" font-weight="400">Evidence-grade chargeback dispute packs for Shopify merchants.</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
console.log("Wrote", out);
