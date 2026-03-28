/**
 * Manually invoke Resources Hub crons (same handlers as Vercel Cron).
 * Loads .env.local / .env for CRON_SECRET and optional base URL.
 *
 * Requires: CRON_SECRET (same value as Vercel)
 * Optional: CRON_TRIGGER_URL or NEXT_PUBLIC_APP_URL (default https://disputedesk.app)
 *
 * Production must also have GENERATION_ENABLED=true and OPENAI_API_KEY for autopilot.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

const base = (
  process.env.CRON_TRIGGER_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://disputedesk.app"
).replace(/\/$/, "");
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("Missing CRON_SECRET. Set it in .env.local (same as Vercel).");
  process.exit(1);
}

async function callCron(path, label) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { label, url, status: res.status, body };
}

const order = [
  ["/api/cron/autopilot-generate", "Autopilot generate"],
  ["/api/cron/publish-content", "Publish queue + email + SEO"],
];

console.log(`Base: ${base}\n`);

for (const [path, label] of order) {
  const out = await callCron(path, label);
  console.log(`--- ${out.label} (${out.status}) ---`);
  console.log(typeof out.body === "string" ? out.body : JSON.stringify(out.body, null, 2));
  console.log("");
}
