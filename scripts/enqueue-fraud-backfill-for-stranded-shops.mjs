// One-shot: enqueues a backfill_shop_orders job for every active shop
// whose historical_import_status is still 'not_started' AND has no
// existing backfill_shop_orders job queued/running. Covers installs
// that pre-date the OAuth-callback install hook (commit f4e6ce1).

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: shops, error } = await sb
  .from("shops")
  .select("id, shop_domain, historical_import_status")
  .is("uninstalled_at", null)
  .eq("historical_import_status", "not_started");
if (error) {
  console.error(error.message);
  process.exit(1);
}

const enqueued = [];
const skipped = [];
for (const s of shops ?? []) {
  const { data: existing } = await sb
    .from("jobs")
    .select("id")
    .eq("shop_id", s.id)
    .eq("job_type", "backfill_shop_orders")
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();
  if (existing) {
    skipped.push({ shop: s.shop_domain, reason: `job ${existing.id} already in flight` });
    continue;
  }
  const { data: job, error: insErr } = await sb
    .from("jobs")
    .insert({
      shop_id: s.id,
      job_type: "backfill_shop_orders",
      status: "queued",
      priority: 80,
    })
    .select("id")
    .single();
  if (insErr) {
    console.error(`  ${s.shop_domain}: enqueue failed - ${insErr.message}`);
    continue;
  }
  enqueued.push({ shop: s.shop_domain, jobId: job.id });
}

console.log("\n=== Enqueued ===");
for (const e of enqueued) console.log(`  ${e.shop}  →  job ${e.jobId}`);
console.log("\n=== Skipped (already in flight) ===");
for (const e of skipped) console.log(`  ${e.shop}  →  ${e.reason}`);
console.log("");
process.exit(0);
