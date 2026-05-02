import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: shops } = await sb
  .from("shops")
  .select("id, shop_domain, uninstalled_at")
  .is("uninstalled_at", null);

console.log(`Active (not-uninstalled) shops: ${shops?.length}\n`);

for (const shop of shops ?? []) {
  const { data: sess } = await sb
    .from("shop_sessions")
    .select("id, created_at")
    .eq("shop_id", shop.id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Check last 5 sync_disputes outcomes
  const { data: recent } = await sb
    .from("jobs")
    .select("status, created_at")
    .eq("shop_id", shop.id)
    .eq("job_type", "sync_disputes")
    .in("status", ["succeeded", "failed"])
    .order("created_at", { ascending: false })
    .limit(5);

  const recentStr = (recent ?? []).map((r) => r.status[0]).join("");
  const sessStr = sess ? "OFFLINE-SESSION" : "NO-SESSION";
  console.log(`  ${shop.shop_domain.padEnd(40)} ${sessStr.padEnd(18)} last5=${recentStr}`);
}
