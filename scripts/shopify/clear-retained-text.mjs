// Retained-evidence plan, Mein Maison one-off (D2). TEXT ONLY — never touches
// files, never submits. Clears one free-text field on one dispute, with a
// pre-read (refuses unless the live value equals --expect), a
// submitEvidence:false write, and a post-read. Prints before/after + status.
//
//   node scripts/shopify/clear-retained-text.mjs --dispute <uuid> --field uncategorizedText --expect-file <path>            (dry run)
//   node scripts/shopify/clear-retained-text.mjs --dispute <uuid> --field uncategorizedText --expect-file <path> --apply    (writes)
import fs from "node:fs"; import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
for (const line of fs.readFileSync(".env.production.local","utf8").split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");
}
const arg=(n)=>{const i=process.argv.indexOf(n);return i>-1?process.argv[i+1]:null;};
const disputeId=arg("--dispute"), field=arg("--field"), expectFile=arg("--expect-file"), apply=process.argv.includes("--apply");
const CLEARABLE=["uncategorizedText","refundRefusalExplanation","cancellationRebuttal"];
if(!disputeId||!CLEARABLE.includes(field)) throw new Error("--dispute <uuid> --field <"+CLEARABLE.join("|")+"> required");
function dec(b){const [v,i,t,c]=b.split(":");const ver=v.replace(/^v/,"");
 const k=process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`]||process.env.TOKEN_ENCRYPTION_KEY;
 const d=crypto.createDecipheriv("aes-256-gcm",Buffer.from(k,"hex"),Buffer.from(i,"hex"));
 d.setAuthTag(Buffer.from(t,"hex"));return d.update(Buffer.from(c,"hex"),undefined,"utf8")+d.final("utf8");}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data:d}=await sb.from("disputes").select("id,shop_id,order_name,dispute_gid,dispute_evidence_gid,response_cycle,status").eq("id",disputeId).single();
const {data:shop}=await sb.from("shops").select("shop_domain").eq("id",d.shop_id).single();
const {data:s}=await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id",d.shop_id).eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single();
const tok=dec(s.access_token_encrypted);
const gql=async(query,variables)=>(await fetch(`https://${shop.shop_domain}/admin/api/2026-01/graphql.json`,{method:"POST",headers:{"X-Shopify-Access-Token":tok,"content-type":"application/json"},body:JSON.stringify({query,variables})})).json();
const READ=`query($id:ID!){node(id:$id){... on ShopifyPaymentsDispute{status evidenceSentOn disputeEvidence{id submitted ${field} uncategorizedFile{id originalFileName}}}}}`;
const read=async()=>{const j=await gql(READ,{id:d.dispute_gid}); if(j.errors) throw new Error(JSON.stringify(j.errors)); const n=j.data.node; return {status:n.status,evidenceSentOn:n.evidenceSentOn,submitted:n.disputeEvidence.submitted,value:n.disputeEvidence[field],file:n.disputeEvidence.uncategorizedFile?.originalFileName??null,evId:n.disputeEvidence.id};};
const norm=(v)=>(v??"").replace(/\r\n?/g,"\n").trim();
const before=await read();
console.log(JSON.stringify({order:d.order_name,shop:shop.shop_domain,cycle:d.response_cycle,field,before:{status:before.status,evidenceSentOn:before.evidenceSentOn,submitted:before.submitted,value:before.value,file:before.file}},null,1));
if(before.evidenceSentOn) throw new Error("evidence already sent — nothing to change");
if(!norm(before.value)){console.log("field already empty — nothing to do");process.exit(0);}
if(expectFile){const exp=norm(fs.readFileSync(expectFile,"utf8")); if(exp!==norm(before.value)) throw new Error("live value differs from --expect-file — refusing (text changed since review)");}
else if(apply) throw new Error("--apply requires --expect-file with the reviewed text");
if(!apply){console.log("DRY RUN — no write.");process.exit(0);}
const m=await gql(`mutation($id:ID!,$input:ShopifyPaymentsDisputeEvidenceUpdateInput!){disputeEvidenceUpdate(id:$id,input:$input){userErrors{field message}}}`,{id:before.evId,input:{[field]:"",submitEvidence:false}});
const ue=m.data?.disputeEvidenceUpdate?.userErrors??[]; if(m.errors||ue.length) throw new Error("write failed: "+JSON.stringify(m.errors??ue));
const after=await read();
console.log(JSON.stringify({after:{status:after.status,evidenceSentOn:after.evidenceSentOn,submitted:after.submitted,value:after.value,file:after.file}},null,1));
await sb.from("audit_events").insert({shop_id:d.shop_id,dispute_id:d.id,actor_type:"system",event_type:"retained_text_cleared",event_payload:{source:"one_off_d2",field,before:before.value,after:after.value,cycle:d.response_cycle,status_before:before.status,status_after:after.status,evidence_sent_on_after:after.evidenceSentOn,read_at:new Date().toISOString()}});
if(norm(after.value)) throw new Error("post-read not empty — NOT cleared");
if(after.status!==before.status||after.evidenceSentOn!==before.evidenceSentOn) throw new Error("status/evidenceSentOn changed — investigate");
console.log("CLEARED and verified; audit row written.");
