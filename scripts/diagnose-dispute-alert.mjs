import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const SHOP_DOMAIN = "surasvenne.myshopify.com";

function log(label, data) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
}

const { data: shop, error: shopErr } = await sb
  .from("shops")
  .select("id, shop_domain, uninstalled_at, created_at")
  .eq("shop_domain", SHOP_DOMAIN)
  .maybeSingle();
if (shopErr) { console.error(shopErr); process.exit(1); }
log("shop", shop);
if (!shop) process.exit(0);

const { data: stuckRunning } = await sb
  .from("jobs")
  .select("id, shop_id, job_type, status, attempts, locked_at, locked_by, last_error, created_at, updated_at")
  .eq("status", "running")
  .lt("locked_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
  .order("locked_at", { ascending: true })
  .limit(50);
log("STUCK running jobs (locked_at > 10min ago, any shop)", stuckRunning);

const { data: runningThisShop } = await sb
  .from("jobs")
  .select("id, job_type, status, attempts, locked_at, locked_by, last_error, created_at, updated_at")
  .eq("shop_id", shop.id)
  .eq("status", "running")
  .order("locked_at", { ascending: true });
log("All running jobs for this shop", runningThisShop);

const { data: syncHistory } = await sb
  .from("jobs")
  .select("id, status, attempts, run_at, locked_at, last_error, created_at, updated_at")
  .eq("shop_id", shop.id)
  .eq("job_type", "sync_disputes")
  .order("created_at", { ascending: false })
  .limit(30);
log("sync_disputes history (last 30) for this shop", syncHistory);

const { data: allJobsRecent } = await sb
  .from("jobs")
  .select("id, job_type, status, attempts, run_at, locked_at, last_error, created_at, updated_at")
  .eq("shop_id", shop.id)
  .gte("created_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString())
  .order("created_at", { ascending: false })
  .limit(100);
log(`All jobs for this shop in last 48h (count=${allJobsRecent?.length ?? 0})`, allJobsRecent);

const { data: recentDisputes } = await sb
  .from("disputes")
  .select("id, dispute_gid, reason, status, amount, initiated_at, due_at, last_synced_at, created_at, updated_at")
  .eq("shop_id", shop.id)
  .order("created_at", { ascending: false })
  .limit(10);
log("Last 10 disputes for this shop (initiated_at vs created_at is the lag)", recentDisputes);

const { data: failedJobs } = await sb
  .from("jobs")
  .select("id, job_type, status, attempts, last_error, created_at, updated_at")
  .eq("shop_id", shop.id)
  .eq("status", "failed")
  .order("updated_at", { ascending: false })
  .limit(20);
log("Recently failed jobs for this shop", failedJobs);

const { data: auditAlerts } = await sb
  .from("audit_events")
  .select("event_type, event_payload, created_at")
  .eq("shop_id", shop.id)
  .gte("created_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString())
  .order("created_at", { ascending: false })
  .limit(30);
log("Audit events for this shop in last 48h", auditAlerts);
