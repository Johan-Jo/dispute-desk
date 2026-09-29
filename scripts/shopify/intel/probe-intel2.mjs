import fs from "node:fs"; import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
for (const line of fs.readFileSync(".env.production.local","utf8").split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");
}
function dec(b){const [v,i,t,c]=b.split(":");const ver=v.replace(/^v/,"");
 const k=process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`]||process.env.TOKEN_ENCRYPTION_KEY;
 const d=crypto.createDecipheriv("aes-256-gcm",Buffer.from(k,"hex"),Buffer.from(i,"hex"));
 d.setAuthTag(Buffer.from(t,"hex"));return d.update(Buffer.from(c,"hex"),undefined,"utf8")+d.final("utf8");}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const API="2026-01";
async function run(disputeId){
const { data: d } = await sb.from("disputes").select("shop_id,order_gid,order_name,initiated_at").eq("id", disputeId).single();
const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", d.shop_id).single();
const { data: s } = await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id", d.shop_id).eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single();
const tok = dec(s.access_token_encrypted);
const g = async (query, variables) => (await (await fetch(`https://${shop.shop_domain}/admin/api/${API}/graphql.json`, { method: "POST", headers: { "X-Shopify-Access-Token": tok, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) })).json());
const r = await g(`query($id: ID!) { order(id: $id) { name hasTimelineComment edited alerts { title content severity }
  disputes { id status initiatedAs }
  agreements(first: 20) { nodes { __typename happenedAt reason app { title } user { name }
    sales(first: 10) { nodes { actionType lineType totalAmount { shopMoney { amount } } } } } }
  customer { statistics { predictedSpendTier } lifetimeDuration
    orders(first: 20, reverse: true) { nodes { name createdAt displayFinancialStatus displayFulfillmentStatus totalRefundedSet { shopMoney { amount } } disputes { status initiatedAs } } } } } }`, { id: d.order_gid });
console.log(`\n===== ${shop.shop_domain} ${d.order_name}`);
if (r.errors) console.log("ERR", JSON.stringify(r.errors.map(e=>e.message)).slice(0,600));
console.log(JSON.stringify(r.data).slice(0,3000));
const r2 = await g(`{ shopifyPaymentsAccount { id balance { amount } } }`); console.log("PAYMENTS_ACCOUNT", JSON.stringify(r2.errors?.map(e=>e.message) ?? r2.data).slice(0,300));
const r3 = await g(`{ events(first: 15, query: "subject_type:ORDER", sortKey: CREATED_AT, reverse: true) { nodes { createdAt action appTitle message } } }`);
console.log("SHOP_EVENTS", r3.errors ? JSON.stringify(r3.errors.map(e=>e.message)) : r3.data.events.nodes.map(e=>`${e.createdAt} ${e.action} [${e.appTitle??''}] ${(e.message||'').replace(/<[^>]+>/g,'').slice(0,90)}`).join("\n  "));
}
for (const id of process.argv.slice(2)) await run(id);
