/**
 * Read-only probe: where is the Klarna SUB-PRODUCT (pay_now / pay_later /
 * slice_it / financing) reliably exposed? The deep probe showed
 * paymentMethodName is often just "klarna" on recent orders but
 * "klarna_pay_later" on some. This dumps every Klarna-relevant field so we
 * can find the authoritative sub-type source.
 *
 * Usage: node scripts/probe-klarna-subtype.mjs [shop_domain] [maxOrders=300]
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });

const SHOP_DOMAIN = process.argv[2] || "cay-collective.myshopify.com";
const MAX = Number.parseInt(process.argv[3] || "300", 10);
const SUPA_URL = process.env.NEW_SUPABASE_URL, SUPA_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL?.includes("aokhplydttxtebvbeuzc")) { console.error("need prod NEW_SUPABASE_URL"); process.exit(1); }
const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
function deserialize(raw){const[v,i,t,c]=raw.split(":");return{keyVersion:parseInt(v.slice(1),10),iv:Buffer.from(i,"hex"),tag:Buffer.from(t,"hex"),ciphertext:Buffer.from(c,"hex")};}
function decrypt(p){const e=`TOKEN_ENCRYPTION_KEY_V${p.keyVersion}`;let h=process.env[e];if(!h&&p.keyVersion===1)h=process.env.TOKEN_ENCRYPTION_KEY;if(!h)throw new Error("no key");const d=createDecipheriv("aes-256-gcm",Buffer.from(h,"hex"),p.iv);d.setAuthTag(p.tag);return Buffer.concat([d.update(p.ciphertext),d.final()]).toString("utf8");}

const { data: shop } = await sb.from("shops").select("id").eq("shop_domain", SHOP_DOMAIN).maybeSingle();
const { data: sess } = await sb.from("shop_sessions").select("shop_domain, access_token_encrypted").eq("shop_id", shop.id).eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
const token = decrypt(deserialize(sess.access_token_encrypted));
const endpoint = `https://${sess.shop_domain}/admin/api/2026-01/graphql.json`;

// Dump ALL potential sub-type signals: paymentGatewayNames, transaction
// gateway/formattedGateway, paymentMethodName, paymentDescriptor, and the
// receiptJson keys.
const QUERY = `
  query($first:Int!,$after:String){
    orders(first:$first,after:$after,sortKey:CREATED_AT,reverse:true){
      edges{node{
        name createdAt paymentGatewayNames
        transactions(first:6){
          kind status gateway formattedGateway receiptJson
          paymentDetails{ __typename
            ... on LocalPaymentMethodsPaymentDetails{ paymentMethodName paymentDescriptor }
          }
        }
      }}
      pageInfo{hasNextPage endCursor}
    }
  }`;

const methodName = new Map(), gatewayNames = new Map(), formattedGw = new Map(), descriptors = new Map();
const receiptKeyHits = new Map();
let scanned=0, after=null, klarna=0;
function bump(m,k){m.set(k,(m.get(k)??0)+1);}
function receiptKlarnaSignal(rj){
  if(!rj) return null; let r=rj; if(typeof r==="string"){try{r=JSON.parse(r);}catch{return null;}}
  const hits=[]; const walk=(o,p)=>{ if(!o||typeof o!=="object")return; for(const[k,v]of Object.entries(o)){ const kl=k.toLowerCase(); if((kl.includes("klarna")||kl.includes("product")||kl.includes("method")||kl.includes("type"))&&(typeof v==="string"||typeof v==="number"))hits.push(`${p}${k}=${v}`); if(v&&typeof v==="object")walk(v,`${p}${k}.`);}}; walk(r,""); return hits.length?hits.slice(0,8):null;
}

while(scanned<MAX){
  const first=Math.min(50,MAX-scanned);
  const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token},body:JSON.stringify({query:QUERY,variables:{first,after}})});
  const json=await res.json();
  if(json.errors){console.error(JSON.stringify(json.errors));break;}
  const conn=json?.data?.orders; if(!conn)break;
  for(const e of conn.edges){
    const o=e.node; scanned++;
    for(const g of o.paymentGatewayNames??[])bump(gatewayNames,g);
    const tx=(o.transactions??[]).find(t=>(t.kind==="SALE"||t.kind==="AUTHORIZATION")&&t.status==="SUCCESS")??(o.transactions??[])[0];
    const pd=tx?.paymentDetails;
    if(pd?.__typename==="LocalPaymentMethodsPaymentDetails"){
      const m=(pd.paymentMethodName??"(null)").toLowerCase();
      if(m.startsWith("klarna")||m==="(null)"){
        klarna++;
        bump(methodName,m);
        if(tx?.formattedGateway)bump(formattedGw,tx.formattedGateway);
        bump(descriptors, pd.paymentDescriptor??"(null)");
        const rsig=receiptKlarnaSignal(tx?.receiptJson);
        if(rsig)for(const h of rsig)bump(receiptKeyHits,h.split("=")[0]);
      }
    }
  }
  if(!conn.pageInfo.hasNextPage)break; after=conn.pageInfo.endCursor;
}

console.log(`\n=== ${scanned} orders, ${klarna} Klarna, for ${SHOP_DOMAIN} ===`);
console.log("\npaymentMethodName (the sub-product field):");
for(const[k,v]of[...methodName].sort((a,b)=>b[1]-a[1]))console.log(`  ${k}: ${v}`);
console.log("\ntransaction.formattedGateway (Klarna txns):");
for(const[k,v]of[...formattedGw].sort((a,b)=>b[1]-a[1]))console.log(`  ${k}: ${v}`);
console.log("\npaymentDescriptor values (Klarna txns):");
for(const[k,v]of[...descriptors].sort((a,b)=>b[1]-a[1]))console.log(`  ${JSON.stringify(k)}: ${v}`);
console.log("\npaymentGatewayNames (all orders):");
for(const[k,v]of[...gatewayNames].sort((a,b)=>b[1]-a[1]))console.log(`  ${k}: ${v}`);
console.log("\nreceiptJson keys hinting at klarna/product/type (Klarna txns):");
if(receiptKeyHits.size===0)console.log("  (none)");
for(const[k,v]of[...receiptKeyHits].sort((a,b)=>b[1]-a[1]).slice(0,20))console.log(`  ${k}: ${v}`);
