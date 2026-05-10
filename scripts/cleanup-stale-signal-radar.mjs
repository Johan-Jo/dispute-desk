#!/usr/bin/env node
/**
 * One-shot cleanup for Signal Radar:
 *
 *   1. Delete signal_sources rows older than 30 days (regardless of analysis
 *      status). The 30-day max-age gate at ingest is in place going forward,
 *      but items ingested before that shipped are still in the DB and
 *      polluting the dashboard / firing alert emails.
 *
 *   2. Delete app_store reviews with rating >= 4 (positive reviews). These
 *      were ingested before the sentiment-polarity gate at the app-store
 *      adapter was added, and they get misclassified as support_failure /
 *      competitor_frustration because they mention chargeback keywords.
 *
 * Cascade-deletes the matching signal_analysis rows via FK on source_id (if
 * the FK doesn't have ON DELETE CASCADE we delete analysis rows first).
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or pass via .env)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const candidates = [".env.local", ".env"];
  for (const f of candidates) {
    const path = resolve(process.cwd(), f);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (process.env[key]) continue;
      process.env[key] = val.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
    }
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

async function deleteStale() {
  // First find IDs (so we can delete dependent analysis rows explicitly)
  const { data: stale, error: findErr } = await sb
    .from("signal_sources")
    .select("id")
    .lt("posted_at", cutoff);
  if (findErr) throw findErr;

  const ids = (stale ?? []).map((r) => r.id);
  if (ids.length === 0) {
    console.log("[cleanup] no stale rows to delete");
    return 0;
  }
  console.log(`[cleanup] deleting ${ids.length} stale signal_sources (posted_at < ${cutoff})`);

  // Delete analysis rows first
  const { error: aErr } = await sb
    .from("signal_analysis")
    .delete()
    .in("source_id", ids);
  if (aErr) throw aErr;

  // Then sources
  const { error: sErr } = await sb
    .from("signal_sources")
    .delete()
    .in("id", ids);
  if (sErr) throw sErr;

  return ids.length;
}

async function deletePositiveAppStoreReviews() {
  // raw_payload->>'rating' is a text column; cast to numeric for comparison
  const { data: positive, error: findErr } = await sb
    .from("signal_sources")
    .select("id, raw_payload")
    .eq("platform", "app_store");
  if (findErr) throw findErr;

  const ids = (positive ?? [])
    .filter((r) => Number(r.raw_payload?.rating ?? 0) >= 4)
    .map((r) => r.id);

  if (ids.length === 0) {
    console.log("[cleanup] no positive app_store reviews to delete");
    return 0;
  }
  console.log(`[cleanup] deleting ${ids.length} positive app_store reviews (rating >= 4)`);

  const { error: aErr } = await sb
    .from("signal_analysis")
    .delete()
    .in("source_id", ids);
  if (aErr) throw aErr;

  const { error: sErr } = await sb
    .from("signal_sources")
    .delete()
    .in("id", ids);
  if (sErr) throw sErr;

  return ids.length;
}

async function main() {
  console.log("[cleanup] starting Signal Radar cleanup");
  const stale = await deleteStale();
  const positive = await deletePositiveAppStoreReviews();

  // Final state sanity check
  const { count: remaining } = await sb
    .from("signal_sources")
    .select("*", { count: "exact", head: true });

  console.log(
    `[cleanup] done — stale_deleted=${stale} positive_deleted=${positive} signal_sources_remaining=${remaining ?? "unknown"}`
  );
}

main().catch((e) => {
  console.error("[cleanup] failed:", e);
  process.exit(1);
});
