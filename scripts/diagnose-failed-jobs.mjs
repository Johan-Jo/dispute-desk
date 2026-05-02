import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

console.log("=== Job status totals ===");
for (const status of ["queued", "running", "succeeded", "failed"]) {
  const { count } = await sb
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  console.log(`  ${status}: ${count}`);
}

console.log("\n=== Failed jobs by job_type ===");
const { data: byType } = await sb
  .from("jobs")
  .select("job_type")
  .eq("status", "failed");
const typeCounts = {};
for (const j of byType ?? []) typeCounts[j.job_type] = (typeCounts[j.job_type] ?? 0) + 1;
for (const [t, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${c}`);
}

console.log("\n=== Failed sync_disputes by shop ===");
const { data: failedSync } = await sb
  .from("jobs")
  .select("shop_id, last_error")
  .eq("status", "failed")
  .eq("job_type", "sync_disputes");

const byShop = {};
for (const j of failedSync ?? []) {
  if (!byShop[j.shop_id]) byShop[j.shop_id] = { count: 0, errors: new Set() };
  byShop[j.shop_id].count++;
  if (j.last_error) byShop[j.shop_id].errors.add(j.last_error.slice(0, 120));
}

const { data: shopsRows } = await sb
  .from("shops")
  .select("id, shop_domain, uninstalled_at");
const shopMap = {};
for (const s of shopsRows ?? []) shopMap[s.id] = s;

const sorted = Object.entries(byShop).sort((a, b) => b[1].count - a[1].count);
for (const [shopId, info] of sorted) {
  const shop = shopMap[shopId];
  const domain = shop?.shop_domain ?? shopId.slice(0, 8);
  const status = shop?.uninstalled_at ? "UNINSTALLED" : "active";
  console.log(`\n  ${domain}  [${status}]  ${info.count} failures`);
  for (const err of [...info.errors].slice(0, 3)) {
    console.log(`    └─ ${err}`);
  }
}

console.log("\n=== Oldest failed job ===");
const { data: oldest } = await sb
  .from("jobs")
  .select("created_at, job_type, shop_id, last_error")
  .eq("status", "failed")
  .order("created_at", { ascending: true })
  .limit(1);
console.log(oldest?.[0]);

console.log("\n=== Most recent failed job ===");
const { data: newest } = await sb
  .from("jobs")
  .select("created_at, job_type, shop_id, last_error")
  .eq("status", "failed")
  .order("created_at", { ascending: false })
  .limit(1);
console.log(newest?.[0]);
