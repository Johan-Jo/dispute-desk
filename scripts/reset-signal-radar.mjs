#!/usr/bin/env node
/**
 * Wipe Signal Radar tables so the next ingest starts clean.
 * Used after fixing data-quality issues (e.g. automod pollution).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const envText = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
} catch {}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { count: srcBefore } = await sb
  .from("signal_sources")
  .select("*", { count: "exact", head: true });
const { count: anaBefore } = await sb
  .from("signal_analysis")
  .select("*", { count: "exact", head: true });
const { count: alertsBefore } = await sb
  .from("signal_alerts")
  .select("*", { count: "exact", head: true });

console.log(`Before: signal_sources=${srcBefore} signal_analysis=${anaBefore} signal_alerts=${alertsBefore}`);

const { error: e1 } = await sb.from("signal_alerts").delete().not("id", "is", null);
if (e1) console.warn("alerts delete:", e1);
const { error: e2 } = await sb.from("signal_analysis").delete().not("id", "is", null);
if (e2) console.warn("analysis delete:", e2);
const { error: e3 } = await sb.from("signal_sources").delete().not("id", "is", null);
if (e3) console.warn("sources delete:", e3);

const { count: srcAfter } = await sb
  .from("signal_sources")
  .select("*", { count: "exact", head: true });
const { count: anaAfter } = await sb
  .from("signal_analysis")
  .select("*", { count: "exact", head: true });

console.log(`After:  signal_sources=${srcAfter} signal_analysis=${anaAfter}`);
console.log("Done. Next refresh will start clean.");
