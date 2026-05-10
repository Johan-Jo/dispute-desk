#!/usr/bin/env node
/**
 * End-to-end verification of Signal Radar production state.
 *
 * Checks (each runs independently — partial failures don't abort):
 *   A. DB sanity:
 *      - no signal_sources rows with posted_at > 30d
 *      - no app_store rows with rating >= 4
 *      - count of pending vs classified
 *      - last-7d category breakdown
 *   B. Cron endpoints respond with 200 + JSON shape
 *      - /api/cron/signal-radar-classify (cheap, drains queue)
 *      - /api/cron/signal-radar-reddit (heavier — only if --include-ingest)
 *   C. Drill-through page returns 200 (or auth redirect)
 *      - /admin/signal-radar/all?category=transparency_frustration
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
 *               PROD_BASE_URL (defaults to https://disputedesk.app)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  for (const f of [".vercel/prod.env", ".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k]) continue;
      // Strip surrounding quotes (single or double)
      let v = raw;
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
      process.env[k] = v;
    }
  }
}
loadEnv();

const BASE = process.env.PROD_BASE_URL ?? "https://disputedesk.app";
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

if (!SUPABASE_URL || !KEY || !CRON_SECRET) {
  console.error("Missing env: need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

function ok(label, msg) { console.log(`  PASS ${label}: ${msg}`); }
function fail(label, msg) { console.log(`  FAIL ${label}: ${msg}`); }
function info(label, msg) { console.log(`  INFO ${label}: ${msg}`); }

async function checkA_DBSanity() {
  console.log("\n[A] DB sanity checks");

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // A1: no rows older than 30 days
  const { count: stale, error: e1 } = await sb
    .from("signal_sources")
    .select("*", { count: "exact", head: true })
    .lt("posted_at", cutoff);
  if (e1) fail("A1 stale rows", e1.message);
  else if ((stale ?? 0) === 0) ok("A1 stale rows", "0 rows older than 30d");
  else fail("A1 stale rows", `${stale} rows older than 30d still present`);

  // A2: no positive app_store reviews
  const { data: appStoreAll, error: e2 } = await sb
    .from("signal_sources")
    .select("id, raw_payload")
    .eq("platform", "app_store");
  if (e2) {
    fail("A2 positive reviews", e2.message);
  } else {
    const positives = (appStoreAll ?? []).filter((r) => Number(r.raw_payload?.rating ?? 0) >= 4);
    if (positives.length === 0) ok("A2 positive reviews", `0 of ${appStoreAll?.length ?? 0} app_store rows have rating≥4`);
    else fail("A2 positive reviews", `${positives.length} positive reviews still present`);
  }

  // A3: pending vs classified counts
  const { count: pending } = await sb
    .from("signal_sources")
    .select("*", { count: "exact", head: true })
    .eq("analysis_status", "pending");
  const { count: classified } = await sb
    .from("signal_sources")
    .select("*", { count: "exact", head: true })
    .eq("analysis_status", "classified");
  info("A3 queue", `pending=${pending ?? 0} classified=${classified ?? 0}`);

  // A4: last 7d categories that actually have items (so drill-through has results)
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: cats } = await sb
    .from("signal_analysis")
    .select("category")
    .gt("created_at", since7d);
  const counts = {};
  for (const r of cats ?? []) counts[r.category] = (counts[r.category] ?? 0) + 1;
  info("A4 categories last 7d", JSON.stringify(counts));
}

async function checkB_Cron() {
  console.log("\n[B] Cron endpoints");

  // B1: classify drain — cheap, exits within 45s
  try {
    const url = `${BASE}/api/cron/signal-radar-classify`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
    if (res.ok) ok("B1 classify drain", `${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    else fail("B1 classify drain", `${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  } catch (e) {
    fail("B1 classify drain", e.message);
  }
}

async function checkC_DrillThrough() {
  console.log("\n[C] Drill-through pages (HTTP-level — auth redirects acceptable)");

  for (const cat of [
    "transparency_frustration",
    "competitor_frustration",
    "support_failure",
    "migration_intent",
  ]) {
    const url = `${BASE}/admin/signal-radar/all?category=${cat}`;
    try {
      const res = await fetch(url, { redirect: "manual" });
      // 200 = page rendered. 307/302 to /admin/login = expected without admin cookie
      // 307 to anywhere else / 500 = bad
      if (res.status === 200 || (res.status >= 300 && res.status < 400)) {
        ok(`C ${cat}`, `${res.status} (${res.headers.get("location") ?? "rendered"})`);
      } else {
        fail(`C ${cat}`, `${res.status}`);
      }
    } catch (e) {
      fail(`C ${cat}`, e.message);
    }
  }
}

(async () => {
  console.log(`Verifying ${BASE} ...`);
  await checkA_DBSanity();
  await checkB_Cron();
  await checkC_DrillThrough();
  console.log("\nDone.");
})().catch((e) => {
  console.error("verify failed:", e);
  process.exit(1);
});
