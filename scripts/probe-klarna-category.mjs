/**
 * Read-only: extract the actual Klarna payment_method_category values from
 * receiptJson (payment_method_details.klarna.payment_method_category) across
 * a shop's orders. This is the authoritative pay_now/pay_later/slice_it
 * signal (paymentMethodName from GraphQL is just "klarna").
 *
 * Usage: node scripts/probe-klarna-category.mjs [shop_domain] [maxOrders=500]
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";
config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });
const SHOP_DOMAIN = process.argv[2] || "cay-collective.myshopify.com";
const MAX = Number.parseInt(process.argv[3] || "500", 10);
const SUPA_URL = process.env.NEW_SUPABASE_URL, SUPA_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL?.includes("aokhplydttxtebvbeuzc")) { console.error("need prod"); process.exit(1); }
const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
function deserialize(raw){const[v,i,t,c]=raw.split(":");return{keyVersion:parseInt(v.slice(1),10),iv:Buffer.from(i,"hex"),tag:Buffer.from(t,"hex"),ciphertext:Buffer.from(c,"hex")};}
function decrypt(p){const e=`TOKEN_ENCRYPTION_KEY_V${p.keyVersion}`;let h=process.env[e];if(!h&&p.keyVersion===1)h=process.env.TOKEN_ENCRYPTION_KEY;const d=createDecipheriv("aes-256-gcm",Buffer.from(h,"hex"),p.iv);d.setAuthTag(p.tag);return Buffer.concat([d.update(p.ciphertext),d.final()]).toString("utf8");}
const { data: shop } = await sb.from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).maybeSingle();
const { data: sess } = await sb.from("shop_sessions").select("shop_domain, access_token_encrypted").eq("shop_id", shop.id).eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
const token = decrypt(deserialize(sess.access_token_encrypted));
const endpoint = `https://${sess.shop_domain}/admin/api/2026-01/graphql.json`;
const QUERY = `query($first:Int!,$after:String){orders(first:$first,after:$after,sortKey:CREATED_AT,reverse:true){edges{node{name createdAt transactions(first:6){kind status receiptJson paymentDetails{__typename ... on LocalPaymentMethodsPaymentDetails{paymentMethodName}}}}}pageInfo{hasNextPage endCursor}}}`;
function getPath(o,path){let c=o;for(const k of path){if(c==null||typeof c!=="object")return undefined;c=c[k];}return c;}
function klarnaCategory(rj){ if(!rj)return null; let r=rj; if(typeof r==="string"){try{r=JSON.parse(r);}catch{return null;}}
  return getPath(r,["payment_method_details","klarna","payment_method_category"])
    ?? getPath(r,["charges","data",0,"payment_method_details","klarna","payment_method_category"])
    ?? getPath(r,["latest_charge","payment_method_details","klarna","payment_method_category"])
    ?? null;
}
function extType(rj){ if(!rj)return null; let r=rj; if(typeof r==="string"){try{r=JSON.parse(r);}catch{return null;}}
  return getPath(r,["metadata","payments_extension_type"]) ?? getPath(r,["charges","data",0,"metadata","payments_extension_type"]) ?? null;
}
const cat = new Map(), ext = new Map(); let scanned=0, klarna=0, after=null;
function bump(m,k){m.set(k,(m.get(k)??0)+1);}
while(scanned<MAX){
  const first=Math.min(50,MAX-scanned);
  const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token},body:JSON.stringify({query:QUERY,variables:{first,after}})});
  const json=await res.json(); const conn=json?.data?.orders; if(!conn){console.error(JSON.stringify(json.errors||json));break;}
  for(const e of conn.edges){ const o=e.node; scanned++;
    const tx=(o.transactions??[]).find(t=>(t.kind==="SALE"||t.kind==="AUTHORIZATION")&&t.status==="SUCCESS")??(o.transactions??[])[0];
    if(tx?.paymentDetails?.__typename==="LocalPaymentMethodsPaymentDetails" && (tx.paymentDetails.paymentMethodName??"").toLowerCase().startsWith("klarna")){
      klarna++; bump(cat, klarnaCategory(tx.receiptJson)??"(none)"); bump(ext, extType(tx.receiptJson)??"(none)");
    }
  }
  if(!conn.pageInfo.hasNextPage)break; after=conn.pageInfo.endCursor;
}
console.log(`\n=== ${scanned} orders, ${klarna} Klarna, ${SHOP_DOMAIN} ===`);
console.log("\nKlarna payment_method_category (from receiptJson — the real sub-product):");
for(const[k,v]of[...cat].sort((a,b)=>b[1]-a[1]))console.log(`  ${k}: ${v}  (${(v/klarna*100).toFixed(1)}%)`);
console.log("\nmetadata.payments_extension_type:");
for(const[k,v]of[...ext].sort((a,b)=>b[1]-a[1]))console.log(`  ${k}: ${v}`);
