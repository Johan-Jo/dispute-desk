/**
 * Find the dispute + latest pack for order #1069.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

console.log("── disputes where order_name contains 1069 ──");
const { data: disputes } = await sb
  .from("disputes")
  .select("id, shop_id, dispute_gid, dispute_evidence_gid, order_name, reason, status, customer_email, customer_display_name")
  .ilike("order_name", "%1069%")
  .order("initiated_at", { ascending: false })
  .limit(5);
console.log(JSON.stringify(disputes, null, 2));

if (!disputes || disputes.length === 0) {
  console.log("\n── fallback: disputes for real shop e5da0042 (surasvenne) ──");
  const { data: latest } = await sb
    .from("disputes")
    .select("id, dispute_gid, order_gid, order_name, reason, status, initiated_at")
    .eq("shop_id", "e5da0042-a3d4-48f4-88f3-33632a0e12d3")
    .order("initiated_at", { ascending: false })
    .limit(15);
  console.log(JSON.stringify(latest, null, 2));
  process.exit(0);
}

if (!disputes || disputes.length === 0) {
  process.exit(1);
}

for (const d of disputes) {
  console.log(`\n── packs for dispute ${d.id} (order ${d.order_name}) ──`);
  const { data: packs } = await sb
    .from("evidence_packs")
    .select("id, status, completeness_score, saved_to_shopify_at, updated_at, pack_json")
    .eq("dispute_id", d.id)
    .order("created_at", { ascending: false })
    .limit(3);
  for (const p of packs ?? []) {
    const dl = p.pack_json?.device_location ?? null;
    console.log({
      id: p.id,
      status: p.status,
      score: p.completeness_score,
      saved_to_shopify_at: p.saved_to_shopify_at,
      updated_at: p.updated_at,
      device_location_in_pack_json: dl,
    });
  }
}
