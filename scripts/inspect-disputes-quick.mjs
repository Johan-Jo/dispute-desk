import { getServiceClient } from "./lib/supabase.mjs";

const shopDomain = process.argv[2] || "surasvenne.myshopify.com";
const sb = getServiceClient();

const { data: shops, error: sErr } = await sb
  .from("shops")
  .select("id, shop_domain")
  .eq("shop_domain", shopDomain);
if (sErr) { console.error("shops:", sErr.message); process.exit(1); }
console.log("Shop:", shops);
if (!shops?.length) process.exit(0);
const shopId = shops[0].id;

const { data: all, error: dErr } = await sb
  .from("disputes")
  .select("id, dispute_gid, reason, status, amount, currency_code, due_at, created_at, order_gid")
  .eq("shop_id", shopId)
  .order("created_at", { ascending: false });
if (dErr) { console.error("disputes:", dErr.message); process.exit(1); }

const synthetic = all.filter(d => d.dispute_gid?.startsWith("gid://shopify/ShopifyPaymentsDispute/seed-"));
const real = all.filter(d => !d.dispute_gid?.startsWith("gid://shopify/ShopifyPaymentsDispute/seed-"));
console.log(`Total: ${all.length}  Synthetic: ${synthetic.length}  Real: ${real.length}`);

console.log("\nSynthetic sample:");
for (const r of synthetic.slice(0, 25)) {
  console.log(" ", r.dispute_gid, "|", r.reason, "|", r.amount, r.currency_code, "|", r.status, "| order:", r.order_gid ?? "—");
}
console.log("\nReal sample:");
for (const r of real.slice(0, 10)) {
  console.log(" ", r.dispute_gid, "|", r.reason, "|", r.amount, r.currency_code, "|", r.status, "| order:", r.order_gid ?? "—");
}
