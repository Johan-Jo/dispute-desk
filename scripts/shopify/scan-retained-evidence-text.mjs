// Read-only (retained-evidence plan, rollout step 1): which open disputes already hold free text in Shopify.
// node scripts/shopify/scan-retained-evidence-text.mjs  → counts; rows in $TEMP/scan-retained.json
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
const F=["uncategorizedText","refundRefusalExplanation","cancellationRebuttal","refundPolicyDisclosure","cancellationPolicyDisclosure","accessActivityLog"];
const Q=`query($id:ID!){ node(id:$id){ ... on ShopifyPaymentsDisputeEvidence { submitted ${F.join(" ")} uncategorizedFile{originalFileName} } } }`;
const {data:ds,error}=await sb.from("disputes").select("id,shop_id,order_name,status,phase,response_cycle,dispute_evidence_gid,evidence_saved_to_shopify_at,due_at").eq("status","needs_response").is("closed_at",null).gt("due_at",new Date().toISOString()).range(0,999);
if(error) throw error;
const shops={}, toks={};
const rows=[];
for (const d of ds) {
  if(!d.dispute_evidence_gid){rows.push({order:d.order_name,err:"no gid"});continue;}
  if(!shops[d.shop_id]){const {data:sh}=await sb.from("shops").select("shop_domain").eq("id",d.shop_id).single(); shops[d.shop_id]=sh.shop_domain;
    const {data:s}=await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id",d.shop_id).eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single(); toks[d.shop_id]=s?dec(s.access_token_encrypted):null;}
  if(!toks[d.shop_id]){rows.push({shop:shops[d.shop_id],order:d.order_name,err:"no token"});continue;}
  const r=await fetch(`https://${shops[d.shop_id]}/admin/api/${API}/graphql.json`,{method:"POST",headers:{"X-Shopify-Access-Token":toks[d.shop_id],"content-type":"application/json"},body:JSON.stringify({query:Q,variables:{id:d.dispute_evidence_gid}})});
  const j=await r.json(); const n=j.data?.node;
  if(!n){rows.push({shop:shops[d.shop_id],order:d.order_name,err:JSON.stringify(j.errors??j).slice(0,120)});continue;}
  const filled=Object.fromEntries(F.filter(k=>n[k]&&n[k].trim()).map(k=>[k,n[k].replace(/\s+/g," ").slice(0,90)]));
  rows.push({shop:shops[d.shop_id],order:d.order_name,phase:d.phase,cycle:d.response_cycle,savedByUs:!!d.evidence_saved_to_shopify_at,file:n.uncategorizedFile?.originalFileName??null,filled});
}
fs.writeFileSync(process.env.TEMP+"/scan-retained.json",JSON.stringify(rows,null,1));
const s={total:rows.length,err:rows.filter(r=>r.err).length,withText:rows.filter(r=>r.filled&&Object.keys(r.filled).length).length};
const byField={}; for(const r of rows) for(const k of Object.keys(r.filled??{})) byField[k]=(byField[k]||0)+1;
const byShop={}; for(const r of rows){const k=r.shop; byShop[k]??={n:0,text:0}; byShop[k].n++; if(r.filled&&Object.keys(r.filled).length) byShop[k].text++;}
console.log(JSON.stringify({s,byField,byShop},null,1));
