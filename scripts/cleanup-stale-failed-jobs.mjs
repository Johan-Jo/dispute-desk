import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DRY_RUN = process.argv.includes("--apply") ? false : true;

const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 1);

// Count stale failed jobs (older than 1 day) — these are noise from broken
// shops that were re-enqueued on every cron tick before the circuit-breaker.
const { data: stale, count } = await sb
  .from("jobs")
  .select("id, shop_id, last_error, created_at", { count: "exact" })
  .eq("status", "failed")
  .lt("created_at", cutoff.toISOString());

console.log(`Stale failed jobs (>1d old): ${count}`);
const byShop = {};
for (const j of stale ?? []) {
  byShop[j.shop_id] = (byShop[j.shop_id] ?? 0) + 1;
}
const { data: shopsRows } = await sb.from("shops").select("id, shop_domain");
const shopMap = {};
for (const s of shopsRows ?? []) shopMap[s.id] = s.shop_domain;
for (const [shopId, n] of Object.entries(byShop).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${shopMap[shopId] ?? shopId.slice(0, 8)}: ${n}`);
}

if (DRY_RUN) {
  console.log("\nDRY RUN — pass --apply to actually delete");
  process.exit(0);
}

const { error } = await sb
  .from("jobs")
  .delete()
  .eq("status", "failed")
  .lt("created_at", cutoff.toISOString());

if (error) {
  console.error("Delete failed:", error.message);
  process.exit(1);
}

console.log(`\nDeleted ${count} stale failed jobs.`);
