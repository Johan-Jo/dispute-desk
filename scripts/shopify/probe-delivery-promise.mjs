// Read-only: for recent non-receipt disputes on every prod shop, fetch what Shopify
// holds about the delivery PROMISE (checkout-time) vs post-dispatch forecasts.
// Usage: node scripts/shopify/probe-delivery-promise.mjs [perShop=4] > out.json
import fs from "node:fs"; import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
for (const line of fs.readFileSync(".env.production.local","utf8").split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");
}
function dec(b){const [v,i,t,c]=b.split(":");const ver=v.replace(/^v/,"");
 const k=process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`]||process.env.TOKEN_ENCRYPTION_KEY;
 const d=crypto.createDecipheriv("aes-256-gcm",Buffer.from(k,"hex"),Buffer.from(i,"hex"));
 d.setAuthTag(Buffer.from(t,"hex"));return d.update(Buffer.from(c,"hex"),undefined,"utf8")+d.final("utf8");}
const perShop=Number(process.argv[2]||4);
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const API=process.env.SHOPIFY_API_VERSION||"2026-01";
const Q=`query($id:ID!){order(id:$id){name createdAt processedAt
  shippingLines(first:5){nodes{title code source carrierIdentifier deliveryCategory}}
  fulfillmentOrders(first:5){nodes{status fulfillBy createdAt
    deliveryMethod{methodType presentedName minDeliveryDateTime maxDeliveryDateTime brandedPromise{handle name}}}}
  fulfillments(first:5){createdAt inTransitAt estimatedDeliveryAt deliveredAt displayStatus}}}`;
const {data:disputes,error}=await sb.from("disputes").select("id,shop_id,order_gid,order_name,reason,status,initiated_at")
  .eq("reason","PRODUCT_NOT_RECEIVED").gte("initiated_at","2026-06-01").not("order_gid","is",null)
  .order("initiated_at",{ascending:false}).limit(1000);
if(error) throw error;
const byShop={}; for(const d of disputes){(byShop[d.shop_id]??=[]).length<perShop&&byShop[d.shop_id].push(d);}
const out=[];
for(const [shopId,list] of Object.entries(byShop)){
  const {data:shop}=await sb.from("shops").select("shop_domain").eq("id",shopId).single();
  const {data:s}=await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id",shopId)
    .eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(!s){out.push({shop:shop.shop_domain,error:"no offline session"});continue;}
  let tok; try{tok=dec(s.access_token_encrypted);}catch(e){out.push({shop:shop.shop_domain,error:"decrypt "+e.message});continue;}
  for(const d of list){
    const r=await fetch(`https://${shop.shop_domain}/admin/api/${API}/graphql.json`,{method:"POST",
      headers:{"X-Shopify-Access-Token":tok,"Content-Type":"application/json"},body:JSON.stringify({query:Q,variables:{id:d.order_gid}})});
    const j=await r.json().catch(()=>({http:r.status}));
    out.push({shop:shop.shop_domain,dispute:d.id,order:d.order_name,status:d.status,initiated_at:d.initiated_at,http:r.status,data:j.data?.order??null,errors:j.errors??null});
  }
}
console.log(JSON.stringify(out,null,1));
