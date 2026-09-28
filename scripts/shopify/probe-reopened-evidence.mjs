// Bank-claim plan F4 (read-only): what evidence does Shopify hold on reopened
// disputes, and which fields would our save (uncategorizedFile + customer
// fields only) replace?  node scripts/shopify/probe-reopened-evidence.mjs <dispute uuid>...
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
const API=process.env.SHOPIFY_API_VERSION||"2026-01";
for (const id of process.argv.slice(2)) {
  const {data:d}=await sb.from("disputes").select("id,shop_id,order_name,dispute_gid,response_cycle,evidence_saved_to_shopify_at").eq("id",id).single();
  const {data:shop}=await sb.from("shops").select("shop_domain").eq("id",d.shop_id).single();
  const {data:s}=await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id",d.shop_id)
    .eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single();
  const tok=dec(s.access_token_encrypted); const num=d.dispute_gid.match(/\/(\d+)$/)[1];
  const r=await fetch(`https://${shop.shop_domain}/admin/api/${API}/shopify_payments/disputes/${num}/dispute_evidences.json`,{headers:{"X-Shopify-Access-Token":tok}});
  const e=(await r.json()).dispute_evidence??{};
  if (process.env.DUMP) console.log(JSON.stringify(Object.fromEntries(Object.entries(e).map(([k,v])=>[k, v===null?null:typeof v==="object"?JSON.stringify(v).slice(0,300):typeof v]))));
  const files=e.dispute_file_uploads;
  const textFields=Object.entries(e).filter(([k,v])=>typeof v==="string"&&v&&!/_on$|_at$|^id$|admin_graphql/.test(k)).map(([k,v])=>`${k}(${v.length})`);
  console.log(JSON.stringify({files:e.dispute_evidence_files??null,order:d.order_name,cycle:d.response_cycle,savedByUs:d.evidence_saved_to_shopify_at,submitted_by_merchant_on:e.submitted_by_merchant_on??null,
    fileUploads:(Array.isArray(files)?files:[]).map(f=>({type:f.dispute_evidence_type,name:f.original_file_name??f.filename??null,created:f.created_at??null})),
    textFields}));
}
