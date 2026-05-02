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
  .select("shop_domain, uninstalled_at, next_reconcile_at, reconcile_interval_seconds, last_reconciled_at")
  .order("next_reconcile_at");

console.log("Shop reconcile schedule:");
for (const s of shops ?? []) {
  const status = s.uninstalled_at ? "UNINSTALLED" : "active";
  console.log(`  ${s.shop_domain.padEnd(40)} [${status.padEnd(11)}]  next=${s.next_reconcile_at}  every=${s.reconcile_interval_seconds}s`);
}

console.log("\nClaim 5 due shops (RPC test):");
const { data: due, error } = await sb.rpc("claim_due_shops", { p_limit: 5 });
if (error) console.error("  RPC error:", error.message);
else for (const s of due ?? []) console.log(`  claimed: ${s.shop_domain} (${s.id.slice(0, 8)})`);

console.log("\nAfter claim, current times:");
const { data: after } = await sb
  .from("shops")
  .select("shop_domain, next_reconcile_at")
  .order("next_reconcile_at");
for (const s of after ?? []) console.log(`  ${s.shop_domain.padEnd(40)} next=${s.next_reconcile_at}`);
