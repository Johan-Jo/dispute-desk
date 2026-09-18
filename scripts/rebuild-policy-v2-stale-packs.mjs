/**
 * Rebuild the packs whose persisted assessment predates
 * SCORING_POLICY_VERSION 2 (the IP-tier recategorization, PR #641).
 *
 * WHY THIS IS NEEDED AT ALL. Bumping the policy version makes the merchant
 * copy TRUTHFUL — an old snapshot now reports `policy_version_superseded`
 * ("not assessed yet") instead of `input_hash_mismatch` ("the evidence on this
 * case changed", which was a false statement about the merchant's data). But
 * the bump does not re-derive anything: the snapshot is written by `buildPack`
 * and by nothing else, so an un-rebuilt pack stays without a strength band, a
 * completeness score, or a send action. Only a rebuild restores those.
 *
 * WHY NOT THE NIGHTLY CRON. `refresh-open-disputes` only enqueues a rebuild
 * when a carrier DELIVERY status moves. A policy-driven staleness never
 * triggers it, so these packs would sit in the banner indefinitely.
 *
 * SCOPE. Open, unsaved, ready packs holding a `case_assessment` at policy
 * version < 2. Decided disputes (won/lost) are excluded: their evidence is
 * already filed, a rebuild changes nothing an issuer will see, and the pack is
 * a historical record. Already-saved packs are excluded for the same reason.
 *
 * COST. `buildPack` does NOT consume pack quota — billing happens at defence
 * PACKAGE build, not evidence pack build — so this does not spend merchant
 * credits. It does queue work: `priority: 90` matches the nightly refresh, so
 * these sit below interactive jobs and cannot starve a merchant waiting on a
 * page (see the job-priority starvation incident).
 *
 * Usage:
 *   node scripts/rebuild-policy-v2-stale-packs.mjs                 # DRY RUN (default)
 *   node scripts/rebuild-policy-v2-stale-packs.mjs --limit=3       # canary: enqueue 3
 *   node scripts/rebuild-policy-v2-stale-packs.mjs --apply         # enqueue all
 *
 * ALWAYS canary first: run with --limit=3 --apply, READ the resulting packs,
 * then run the full set. See the canary-before-bulk rule.
 *
 * PROD-ONLY by design: loads .env.production.local and refuses any Supabase
 * project other than aokhply… (prod).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitArg = args.find((a) => a.startsWith("--limit="))?.slice(8);
const LIMIT = limitArg ? Number(limitArg) : null;
if (limitArg && (!Number.isInteger(LIMIT) || LIMIT <= 0)) {
  console.error("--limit must be a positive integer");
  process.exit(1);
}

config({ path: join(process.cwd(), ".env.production.local") });
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.production.local");
  process.exit(1);
}
if (!url.includes("aokhplydttxtebvbeuzc")) {
  console.error(`Refusing to run: expected the PROD project (aokhply…), got ${url}`);
  process.exit(1);
}

/** The version this script exists to migrate TO. Keep in step with
 *  SCORING_POLICY_VERSION in lib/evidence/model/assessment.ts. */
const TARGET_POLICY_VERSION = 2;

/** Statuses whose evidence can still change an outcome. Terminal states are
 *  excluded — their pack is a record, not a live case. */
const OPEN_STATUSES = ["needs_response", "new", "in_progress", "under_review"];

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: rows, error } = await sb
  .from("evidence_packs")
  .select("id, shop_id, dispute_id, pack_json, disputes!inner(status, evidence_saved_to_shopify_at)")
  .eq("status", "ready")
  .in("disputes.status", OPEN_STATUSES)
  .is("disputes.evidence_saved_to_shopify_at", null);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

// Filter on the persisted policy version in JS: `pack_json->…->policyVersion`
// is nested three levels deep and a PostgREST filter on it is far easier to
// get subtly wrong than a plain comparison here.
const stale = (rows ?? []).filter((r) => {
  const v = r.pack_json?.case_assessment?.freshness?.policyVersion;
  return typeof v === "number" && v < TARGET_POLICY_VERSION;
});

console.log(`ready+open packs scanned : ${(rows ?? []).length}`);
console.log(`stale (policy < ${TARGET_POLICY_VERSION})        : ${stale.length}`);

const targets = LIMIT ? stale.slice(0, LIMIT) : stale;
if (LIMIT) console.log(`limited to               : ${targets.length}`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing enqueued. Re-run with --apply.");
  for (const t of targets.slice(0, 10)) {
    console.log(`  would rebuild pack ${t.id} (dispute ${t.dispute_id})`);
  }
  if (targets.length > 10) console.log(`  … and ${targets.length - 10} more`);
  process.exit(0);
}

let enqueued = 0;
let skipped = 0;
for (const t of targets) {
  // `dedupe_key` is a partial unique index over non-null values, so a second
  // run raises 23505 rather than queueing the same rebuild twice. Treated as
  // benign — it means the work is already pending.
  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: t.shop_id,
    job_type: "build_pack",
    entity_id: t.id,
    priority: 90,
    dedupe_key: `policy-v${TARGET_POLICY_VERSION}-rebuild:${t.id}`,
  });
  if (jobErr) {
    if (jobErr.code === "23505") {
      skipped++;
    } else {
      console.error(`  FAILED pack ${t.id}: ${jobErr.message}`);
    }
    continue;
  }
  enqueued++;
}

console.log(`\nenqueued : ${enqueued}`);
console.log(`skipped  : ${skipped} (rebuild already queued)`);
