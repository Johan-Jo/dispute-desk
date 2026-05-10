#!/usr/bin/env node
/**
 * Some pending signal_sources rows are stuck because an earlier classify
 * pass managed to insert their signal_analysis row but failed to update the
 * source row's analysis_status. Subsequent retries hit a unique-constraint
 * violation on the analysis insert and exhaust attempts.
 *
 * This reconciles by:
 *   - rows with attempts>=3 AND a matching signal_analysis row → classified
 *   - rows with attempts>=3 AND no analysis row → failed
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
for (const f of [".vercel/prod.env", ".env.local", ".env"]) {
  const p = resolve(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: stuck } = await sb
  .from("signal_sources")
  .select("id")
  .eq("analysis_status", "pending")
  .gte("analysis_attempts", 3);
const ids = (stuck ?? []).map((r) => r.id);
if (!ids.length) {
  console.log("no stuck rows");
  process.exit(0);
}

const { data: havingAnalysis } = await sb
  .from("signal_analysis")
  .select("source_id")
  .in("source_id", ids);
const reconciled = new Set((havingAnalysis ?? []).map((r) => r.source_id));
const toFix = ids.filter((id) => reconciled.has(id));
const toFail = ids.filter((id) => !reconciled.has(id));

if (toFix.length) {
  const { error } = await sb
    .from("signal_sources")
    .update({
      analysis_status: "classified",
      analysis_last_error: null,
      analysis_locked_at: null,
    })
    .in("id", toFix);
  if (error) console.error("classify-flip err:", error.message);
  else console.log(`flipped ${toFix.length} rows pending→classified (analysis already existed)`);
}
if (toFail.length) {
  const { error } = await sb
    .from("signal_sources")
    .update({ analysis_status: "failed", analysis_locked_at: null })
    .in("id", toFail);
  if (error) console.error("fail-flip err:", error.message);
  else console.log(`flipped ${toFail.length} rows pending→failed (no analysis row)`);
}
