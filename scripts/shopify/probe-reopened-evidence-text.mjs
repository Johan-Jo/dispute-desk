// Bank-claim plan F4 follow-up (read-only): the TEXT fields Shopify keeps on a
// reopened dispute. Our save sets none of them, so whatever is here is filed
// again next to our letter.
// node scripts/shopify/probe-reopened-evidence-text.mjs <dispute uuid>...
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
const Q=`query($id:ID!){ node(id:$id){ ... on ShopifyPaymentsDisputeEvidence {
  submitted accessActivityLog cancellationPolicyDisclosure cancellationRebuttal
  refundPolicyDisclosure refundRefusalExplanation uncategorizedText
  customerEmailAddress customerFirstName customerLastName customerPurchaseIp
  productDescription uncategorizedFile { originalFileName } } } }`;
for (const id of process.argv.slice(2)) {
  const {data:d}=await sb.from("disputes").select("order_name,shop_id,reason,dispute_evidence_gid").eq("id",id).single();
  const {data:shop}=await sb.from("shops").select("shop_domain").eq("id",d.shop_id).single();
  const {data:s}=await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id",d.shop_id)
    .eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single();
  const r=await fetch(`https://${shop.shop_domain}/admin/api/${API}/graphql.json`,{method:"POST",
    headers:{"X-Shopify-Access-Token":dec(s.access_token_encrypted),"content-type":"application/json"},
    body:JSON.stringify({query:Q,variables:{id:d.dispute_evidence_gid}})});
  const j=await r.json();
  console.log(JSON.stringify({order:d.order_name,reason:d.reason,evidence:j.data?.node??null,errors:j.errors??null},null,1));
}
