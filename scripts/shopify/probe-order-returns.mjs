// Read-only: what Shopify exposes about an order's returns with the access we hold.
// Usage: node scripts/shopify/probe-order-returns.mjs <shop-domain> <order-gid>
import fs from "node:fs"; import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
for (const line of fs.readFileSync(".env.production.local","utf8").split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");
}
function dec(b){const [v,i,t,c]=b.split(":");const ver=v.replace(/^v/,"");
 const k=process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`]||process.env.TOKEN_ENCRYPTION_KEY;
 const d=crypto.createDecipheriv("aes-256-gcm",Buffer.from(k,"hex"),Buffer.from(i,"hex"));
 d.setAuthTag(Buffer.from(t,"hex"));return d.update(Buffer.from(c,"hex"),undefined,"utf8")+d.final("utf8");}
const [domain, gid] = process.argv.slice(2);
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data:shop}=await sb.from("shops").select("id,shop_domain").eq("shop_domain",domain).single();
const {data:s}=await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id",shop.id)
 .eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single();
const tok=dec(s.access_token_encrypted); const API=process.env.SHOPIFY_API_VERSION||"2026-01";
async function gql(label, query){
  const r=await fetch(`https://${shop.shop_domain}/admin/api/${API}/graphql.json`,{method:"POST",
    headers:{"X-Shopify-Access-Token":tok,"Content-Type":"application/json"},
    body:JSON.stringify({query,variables:{id:gid}})});
  const j=await r.json();
  console.log(`\n== ${label}`);
  if(j.errors) console.log("ERRORS", JSON.stringify(j.errors).slice(0,700));
  if(j.data) console.log(JSON.stringify(j.data,null,1).slice(0,3500));
}
await gql("order basics (read_orders)", `query($id:ID!){ order(id:$id){ name returnStatus displayFinancialStatus displayFulfillmentStatus
  totalRefundedSet{ shopMoney{ amount currencyCode } } refunds{ id createdAt } } }`);
await gql("order.returns", `query($id:ID!){ order(id:$id){ returns(first:5){ nodes{ id name status
  totalQuantity
  returnLineItems(first:10){ nodes{ quantity returnReason } } } } } }`);
await gql("order.returns reverse deliveries", `query($id:ID!){ order(id:$id){ returns(first:5){ nodes{ id name status
  reverseFulfillmentOrders(first:5){ nodes{ id status
    reverseDeliveries(first:5){ nodes{ id
      deliverable{ __typename ... on ReverseDeliveryShippingDeliverable{ tracking{ carrierName number url } label{ createdAt publicFileUrl } } } } } } } } } } }`);
await gql("order events mentioning return", `query($id:ID!){ order(id:$id){ events(first:60){ nodes{ __typename createdAt message } } } }`);
