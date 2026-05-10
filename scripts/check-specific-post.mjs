#!/usr/bin/env node
/**
 * Diagnostic: trace a specific Reddit post through ingest → classify →
 * dashboard filters. Pass either a Reddit URL or an external_id.
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

// Post: https://www.reddit.com/r/shopify/comments/1sryruq/got_my_first_chargeback_today...
// Base36 ID = 1sryruq
const id = process.argv[2] ?? "1sryruq";
const externalId = id.startsWith("t3_") ? id : `t3_${id}`;

console.log(`Looking for external_id=${externalId}`);

const { data: src } = await sb
  .from("signal_sources")
  .select("*")
  .eq("external_id", externalId)
  .maybeSingle();

if (!src) {
  console.log("NOT IN DB — adapter never ingested this post");
  // Check if post fetches via Reddit JSON to confirm it exists
  const url = `https://www.reddit.com/comments/${id}.json`;
  console.log(`\nFetching ${url} to confirm it exists publicly...`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DisputeDesk-debug/1.0" },
    });
    console.log(`Reddit HTTP ${res.status}`);
    if (res.ok) {
      const j = await res.json();
      const post = j?.[0]?.data?.children?.[0]?.data;
      if (post) {
        console.log(`  title: ${post.title}`);
        console.log(`  subreddit: r/${post.subreddit}`);
        const ageDays = ((Date.now() - post.created_utc * 1000) / 86400000).toFixed(1);
        console.log(`  age: ${ageDays}d`);
        console.log(`  selftext (first 200 chars): ${(post.selftext ?? "").slice(0, 200)}`);
      }
    }
  } catch (e) {
    console.log("fetch failed:", e.message);
  }
  process.exit(0);
}

console.log("\n=== signal_sources row ===");
console.log(`platform: ${src.platform}`);
console.log(`subreddit: ${src.subreddit}`);
console.log(`title: ${src.title}`);
console.log(`posted_at: ${src.posted_at} (${((Date.now() - new Date(src.posted_at).getTime()) / 86400000).toFixed(1)}d ago)`);
console.log(`analysis_status: ${src.analysis_status}`);
console.log(`analysis_attempts: ${src.analysis_attempts}`);
console.log(`analysis_last_error: ${src.analysis_last_error}`);

const { data: ana } = await sb
  .from("signal_analysis")
  .select("*")
  .eq("source_id", src.id)
  .maybeSingle();

if (!ana) {
  console.log("\nNo analysis row — never classified.");
  process.exit(0);
}

console.log("\n=== signal_analysis row ===");
console.log(`merchant_relevance: ${ana.merchant_relevance}`);
console.log(`dispute_relevance: ${ana.dispute_relevance}`);
console.log(`category: ${ana.category}`);
console.log(`competitor: ${ana.competitor}`);
console.log(`merchant_stage: ${ana.merchant_stage}`);
console.log(`merchant_type: ${ana.merchant_type}`);
console.log(`signal_score: ${ana.signal_score}`);
console.log(`emotional_intensity_score: ${ana.emotional_intensity_score}`);
console.log(`source_confidence_score: ${ana.source_confidence_score}`);
console.log(`frustration_score: ${ana.frustration_score}`);
console.log(`scale_signals: ${JSON.stringify(ana.merchant_scale_signals)}`);
console.log(`why_this_matters: ${ana.why_this_matters}`);

console.log("\n=== Why it might not appear on dashboard ===");
const reasons = [];
if (!ana.merchant_relevance) reasons.push("merchant_relevance=false");
if (!ana.dispute_relevance) reasons.push("dispute_relevance=false (gate at every stream)");
if (ana.category === "spam" || ana.category === "trolling") reasons.push(`category=${ana.category} (HIDDEN)`);
const inPainCats = ["transparency_frustration", "reserve_fear", "operational_overload", "support_failure", "evidence_confusion"].includes(ana.category);
if (!inPainCats && ana.category !== "migration_intent" && !ana.competitor) {
  reasons.push("not in pain category, not migration_intent, no competitor — falls through every stream");
}
if (inPainCats && ana.signal_score < 4) reasons.push(`signal_score=${ana.signal_score} < 4 (Recent Pain Points minimum)`);
if (ana.merchant_scale_signals?.length === 0 || ana.signal_score < 6) reasons.push(`fails High-Value Leads (needs scale_signals + signal_score>=6)`);
console.log(reasons.length ? reasons.join("\n  · ") : "All gates pass — should be visible");
