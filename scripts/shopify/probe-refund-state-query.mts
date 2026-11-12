// Read-only live check of ORDER_REFUND_STATE_QUERY + resolveRefundState against real orders.
// Usage: npx tsx scripts/shopify/probe-refund-state-query.mts --env-file .env.production.local <orderName> [...]
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ORDER_REFUND_STATE_QUERY } from "../../lib/shopify/queries/orderRefundState";
import { resolveRefundState } from "../../lib/disputes/refundState";

const args = process.argv.slice(2);
const envIdx = args.indexOf("--env-file");
if (envIdx < 0) throw new Error("--env-file is required (prod = .env.production.local)");
const envFile = args[envIdx + 1];
const names = args.filter((_, i) => i !== envIdx && i !== envIdx + 1);
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function dec(b: string) {
  const [v, i, t, c] = b.split(":");
  const ver = v.replace(/^v/, "");
  const k = process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`] || process.env.TOKEN_ENCRYPTION_KEY!;
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(k, "hex"), Buffer.from(i, "hex"));
  d.setAuthTag(Buffer.from(t, "hex"));
  return d.update(Buffer.from(c, "hex"), undefined, "utf8") + d.final("utf8");
}
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const API = process.env.SHOPIFY_API_VERSION || "2026-01";
const { data: disputes } = await sb
  .from("disputes")
  .select("id, shop_id, order_gid, order_name, status, phase")
  .in("order_name", names.map((n) => (n.startsWith("#") ? n : `#${n}`)));
for (const d of disputes ?? []) {
  const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", d.shop_id).single();
  const { data: ses } = await sb
    .from("shop_sessions").select("access_token_encrypted").eq("shop_id", d.shop_id)
    .eq("session_type", "offline").is("user_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!ses || !shop) { console.log(d.order_name, "no session"); continue; }
  const r = await fetch(`https://${shop.shop_domain}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": dec(ses.access_token_encrypted), "Content-Type": "application/json" },
    body: JSON.stringify({ query: ORDER_REFUND_STATE_QUERY, variables: { id: d.order_gid } }),
  });
  const j: any = await r.json();
  if (j.errors) { console.log(d.order_name, "ERRORS", JSON.stringify(j.errors).slice(0, 300)); continue; }
  const s = resolveRefundState(j.data.order, new Date());
  console.log(d.order_name, `[${d.phase}/${d.status}]`, JSON.stringify({ kind: s.kind, reason: s.reason, pending: s.pendingAmount, settled: s.settledAmount, failed: s.failedAmount, firstRefundAt: s.firstRefundAt, settledAt: s.settledAt, returnStatus: s.returnStatus, gw: s.paymentGateways }));
}
