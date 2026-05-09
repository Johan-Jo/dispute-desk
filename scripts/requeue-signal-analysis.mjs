#!/usr/bin/env node
/**
 * One-shot: re-queue all classified signal_sources for re-classification
 * with the updated classifier prompt (M1.5 dispute_relevance flag).
 *
 * Usage: node scripts/requeue-signal-analysis.mjs
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

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const { count: anaBefore } = await sb
  .from("signal_analysis")
  .select("*", { count: "exact", head: true });
console.log(`signal_analysis rows before: ${anaBefore}`);

const { error: delErr } = await sb
  .from("signal_analysis")
  .delete()
  .not("id", "is", null);
if (delErr) {
  console.error("delete signal_analysis failed:", delErr);
  process.exit(1);
}

const { error: updErr, count: srcReset } = await sb
  .from("signal_sources")
  .update({
    analysis_status: "pending",
    analysis_attempts: 0,
    analysis_locked_at: null,
    analysis_last_error: null,
  })
  .neq("analysis_status", "pending")
  .select("*", { count: "exact", head: true });
if (updErr) {
  console.error("reset signal_sources failed:", updErr);
  process.exit(1);
}

console.log(`Reset ${srcReset ?? 0} signal_sources rows to pending.`);
console.log("Next /api/cron/signal-radar-classify tick will re-classify with the dispute_relevance prompt.");
