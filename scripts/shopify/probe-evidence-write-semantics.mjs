// Retained-evidence plan, Rollout 2 (test store ONLY): write semantics of
// disputeEvidenceUpdate with submitEvidence:false. Never submits.
// node scripts/shopify/probe-evidence-write-semantics.mjs <shop> <disputeNumericId>
import fs from "node:fs"; import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
for (const line of fs.readFileSync(".env.production.local","utf8").split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");
}
const [shopDomain, disputeNum] = process.argv.slice(2);
if (shopDomain !== "surasvenne.myshopify.com") throw new Error("test store only");
function dec(b){const [v,i,t,c]=b.split(":");const ver=v.replace(/^v/,"");
 const k=process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`]||process.env.TOKEN_ENCRYPTION_KEY;
 const d=crypto.createDecipheriv("aes-256-gcm",Buffer.from(k,"hex"),Buffer.from(i,"hex"));
 d.setAuthTag(Buffer.from(t,"hex"));return d.update(Buffer.from(c,"hex"),undefined,"utf8")+d.final("utf8");}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data:shop}=await sb.from("shops").select("id").eq("shop_domain",shopDomain).single();
const {data:s}=await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id",shop.id).eq("session_type","offline").is("user_id",null).order("created_at",{ascending:false}).limit(1).single();
const tok=dec(s.access_token_encrypted); const API="2026-01";
const gql=async(query,variables)=>{const r=await fetch(`https://${shopDomain}/admin/api/${API}/graphql.json`,{method:"POST",headers:{"X-Shopify-Access-Token":tok,"content-type":"application/json"},body:JSON.stringify({query,variables})});return r.json();};
const F="id originalFileName fileSize";
const READ=`query($id:ID!){ node(id:$id){ ... on ShopifyPaymentsDispute { status evidenceSentOn disputeEvidence { id submitted uncategorizedText refundRefusalExplanation uncategorizedFile{${F}} serviceDocumentationFile{${F}} customerCommunicationFile{${F}} } } } }`;
const disputeGid=`gid://shopify/ShopifyPaymentsDispute/${disputeNum}`;
const read=async(label)=>{const j=await gql(READ,{id:disputeGid});const n=j.data?.node; const e=n?.disputeEvidence??{};
  const row={label,status:n?.status,evidenceSentOn:n?.evidenceSentOn,submitted:e.submitted,uncategorizedText:e.uncategorizedText,refundRefusalExplanation:e.refundRefusalExplanation,uncategorizedFile:e.uncategorizedFile?.id?.split("/").pop()??null,serviceDocumentationFile:e.serviceDocumentationFile?.id?.split("/").pop()??null,customerCommunicationFile:e.customerCommunicationFile?.id?.split("/").pop()??null};
  console.log(JSON.stringify(row)); return {n,e};};
const UPD=`mutation($id:ID!,$input:ShopifyPaymentsDisputeEvidenceUpdateInput!){ disputeEvidenceUpdate(id:$id,input:$input){ disputeEvidence{ id } userErrors{ field message } } }`;
const upd=async(label,input)=>{const j=await gql(UPD,{id:evGid,input:{...input,submitEvidence:false}});
  const ue=j.data?.disputeEvidenceUpdate?.userErrors??[]; console.log(`-- ${label}:`,j.errors?JSON.stringify(j.errors).slice(0,300):(ue.length?JSON.stringify(ue):"ok"));};
const pdf=(tag)=>{const body=`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length 30>>stream\nBT /F1 12 Tf 20 100 Td ET % ${tag}\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;return Buffer.from(body);};
const upload=async(docType,name)=>{const r=await fetch(`https://${shopDomain}/admin/api/${API}/shopify_payments/disputes/${disputeNum}/dispute_file_uploads.json`,{method:"POST",headers:{"X-Shopify-Access-Token":tok,"content-type":"application/json"},body:JSON.stringify({dispute_file_upload:{document_type:docType,filename:name,mimetype:"application/pdf",data:fs.readFileSync(`${process.env.TEMP}/${name}`).toString("base64")}})});
  const t=await r.json(); const id=t.dispute_file_upload?.id; console.log(`-- upload ${docType} ${name}:`,r.status,id??JSON.stringify(t).slice(0,200)); return id?`gid://shopify/ShopifyPaymentsDisputeFileUpload/${id}`:null;};

const {e:e0}=await read("0 baseline");
const evGid=e0.id;
const FILES_ONLY=process.argv.includes("--files-only");
if(process.argv.includes("--after-submit")){if(process.argv.includes("--set-retained")){await upd("J set retained text",{uncategorizedText:"Retained test text (round 1)"}); await read("J after"); process.exit(0);} await upd("H edit text after submit",{uncategorizedText:"Edited after submitEvidence:true"}); await read("H after edit"); await upd("I clear text after submit",{uncategorizedText:""}); await read("I after clear"); process.exit(0);}
if(!FILES_ONLY){
await upd("A set text","{}"==="" ? {} : {uncategorizedText:"Round-1 test text", refundRefusalExplanation:"Round-1 refusal"});
await read("A after set");
await upd("B uncategorizedText empty string",{uncategorizedText:""});
await read("B after empty string");
await upd("C refundRefusalExplanation null",{refundRefusalExplanation:null});
await read("C after null");
}
const a=await upload("uncategorized_file","Merchant-round1-A.pdf");
if(a){await upd("D attach A to uncategorizedFile",{uncategorizedFile:{id:a}}); await read("D after A");}
const svc=await upload("service_documentation_file","Defence-second-slot.pdf");
if(svc){await upd("E attach to serviceDocumentationFile",{serviceDocumentationFile:{id:svc}}); await read("E after second slot");}
const b=await upload("uncategorized_file","Defence-replacement-B.pdf");
if(b){await upd("F replace uncategorizedFile with B",{uncategorizedFile:{id:b}}); await read("F after replace");}
await upd("G uncategorizedFile null",{uncategorizedFile:null});
await read("G after file null");
const rest=await (await fetch(`https://${shopDomain}/admin/api/${API}/shopify_payments/disputes/${disputeNum}/dispute_evidences.json`,{headers:{"X-Shopify-Access-Token":tok}})).json();
console.log("REST file ids:",JSON.stringify(rest.dispute_evidence?.dispute_file_uploads??rest.dispute_evidence?.dispute_evidence_files));
