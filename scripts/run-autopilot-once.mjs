/**
 * Runs a SINGLE autopilot tick against your deployed or local app (same as Vercel cron).
 *
 * - Temporarily sets cms_settings autopilotEnabled=true and autopilotArticlesPerDay=1
 *   so one HTTP tick generates at most ONE article (highest-priority archive row).
 * - Restores previous autopilotEnabled and autopilotArticlesPerDay after the request.
 *
 * Requires:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 *   CRON_SECRET
 *   CRON_TRIGGER_URL or NEXT_PUBLIC_APP_URL (default https://disputedesk.app)
 *
 * Remote production:
 *   node scripts/run-autopilot-once.mjs
 *
 * Local (Next dev on 3000):
 *   CRON_TRIGGER_URL=http://localhost:3000 node scripts/run-autopilot-once.mjs
 *
 * Prereqs on server: GENERATION_ENABLED=true, OPENAI_API_KEY, generation allowed.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;
const base = (
  process.env.CRON_TRIGGER_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://disputedesk.app"
).replace(/\/$/, "");

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!cronSecret) {
  console.error("Missing CRON_SECRET");
  process.exit(1);
}

const sb = createClient(url, key);

async function main() {
  console.log(`Target: ${base}/api/cron/autopilot-generate\n`);

  const { data: row, error: readErr } = await sb.from("cms_settings").select("settings_json").eq("id", "singleton").maybeSingle();

  if (readErr || !row) {
    console.error("Could not read cms_settings:", readErr?.message ?? "no row");
    process.exit(1);
  }

  const prev =
    row.settings_json && typeof row.settings_json === "object" && !Array.isArray(row.settings_json)
      ? JSON.parse(JSON.stringify(row.settings_json))
      : {};

  const staged = {
    ...prev,
    autopilotEnabled: true,
    autopilotArticlesPerDay: 1,
  };

  const { error: upErr } = await sb.from("cms_settings").update({ settings_json: staged }).eq("id", "singleton");
  if (upErr) {
    console.error("Failed to enable autopilot temporarily:", upErr.message);
    process.exit(1);
  }

  console.log("Temporary CMS: autopilotEnabled=true, autopilotArticlesPerDay=1\n");

  try {
    const res = await fetch(`${base}/api/cron/autopilot-generate`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    console.log(`HTTP ${res.status}`);
    console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  } finally {
    const { error: reErr } = await sb.from("cms_settings").update({ settings_json: prev }).eq("id", "singleton");
    if (reErr) {
      console.error("\nWARNING: Could not restore cms_settings to pre-run snapshot:", reErr.message);
    } else {
      console.log("\nRestored cms_settings JSON to pre-run snapshot.");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
