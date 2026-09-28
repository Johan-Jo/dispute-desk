// Bank-claim plan F4 (read-only): names of the files in each evidence slot.
// node scripts/shopify/probe-evidence-file-names.mjs <dispute uuid>...
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
const F="originalFileName fileType fileSize";
const Q=`query($id:ID!){ node(id:$id){ ... on ShopifyPaymentsDisputeEvidence {
  uncategorizedFile{${F}} customerCommunicationFile{${F}} serviceDocumentationFile{${F}}
  shippingDocumentationFile{${F}} refundPolicyFile{${F}} cancellationPolicyFile{${F}} } } }`;
for (const id of process.argv.slice(2)) {
  const {data:d}=await sb.from("disputes").select("order_name,shop_id,dispute_evidence_gid").eq("id",id).single();
  const {data:shop}=await sb.from("shops").select("shop_domain").eq("id",d.shop_id).single();
  const {data:s}=await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id",d.shop_id)
    .eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single();
  const r=await fetch(`https://${shop.shop_domain}/admin/api/${API}/graphql.json`,{method:"POST",
    headers:{"X-Shopify-Access-Token":dec(s.access_token_encrypted),"content-type":"application/json"},
    body:JSON.stringify({query:Q,variables:{id:d.dispute_evidence_gid}})});
  const j=await r.json(); const n=j.data?.node??{};
  console.log(d.order_name, JSON.stringify(Object.fromEntries(Object.entries(n).filter(([,v])=>v).map(([k,v])=>[k,v.originalFileName]))), j.errors?JSON.stringify(j.errors).slice(0,200):"");
}
