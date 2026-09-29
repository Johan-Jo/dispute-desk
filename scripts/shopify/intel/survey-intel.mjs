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
// Read-only survey: per recent dispute, dump Shopify order timeline + dispute evidence state to JSONL.
const OUT = process.argv[2]; const API = process.env.SHOPIFY_API_VERSION || "2026-01";
const tokCache = new Map();
async function ctx(shopId) {
  if (tokCache.has(shopId)) return tokCache.get(shopId);
  const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", shopId).single();
  const { data: s } = await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id", shopId)
    .eq("session_type", "offline").is("user_id", null).order("created_at", { ascending: false }).limit(1).single();
  const c = { domain: shop.shop_domain, tok: dec(s.access_token_encrypted) }; tokCache.set(shopId, c); return c;
}
async function gql(c, query, variables) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://${c.domain}/admin/api/${API}/graphql.json`, { method: "POST",
      headers: { "X-Shopify-Access-Token": c.tok, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    const j = await r.json();
    if (j.errors?.some?.((e) => e.extensions?.code === "THROTTLED")) { await new Promise((z) => setTimeout(z, 3000)); continue; }
    return j;
  }
  return { errors: [{ message: "throttled" }] };
}
const Q = `query($id: ID!, $did: ID!) {
  dispute: node(id: $did) { ... on ShopifyPaymentsDispute { type status evidenceSentOn finalizedOn initiatedAt
    disputeEvidence { submitted uncategorizedText disputeFileUploads { disputeEvidenceType originalFileName } } } }
  order: node(id: $id) { ... on Order { note tags sourceName app { name } customAttributes { key value } displayFinancialStatus returnStatus
    customerJourneySummary { customerOrderIndex momentsCount { count } firstVisit { source sourceType referrerUrl } }
    metafields(first: 30) { nodes { namespace key } }
    refunds(first: 10) { createdAt note totalRefundedSet { shopMoney { amount } } }
    customer { numberOfOrders note tags }
    events(first: 150, sortKey: CREATED_AT, reverse: true) { nodes { __typename createdAt message
      ... on BasicEvent { action appTitle attributeToApp attributeToUser additionalContent }
      ... on CommentEvent { author { name } rawMessage } } } } } }`;
const since = new Date(Date.now() - 120 * 864e5).toISOString();
let all = []; for (let from = 0; ; from += 1000) {
  const { data } = await sb.from("disputes").select("id,shop_id,dispute_gid,order_gid,order_name,status,phase,reason,initiated_at,due_at,submitted_at,final_outcome")
    .gte("initiated_at", since).order("initiated_at").range(from, from + 999);
  all = all.concat(data ?? []); if (!data || data.length < 1000) break; }
fs.writeFileSync(OUT, "");
let n = 0;
for (const d of all) {
  if (!d.order_gid || !d.dispute_gid) continue;
  const c = await ctx(d.shop_id);
  const r = await gql(c, Q, { id: d.order_gid, did: d.dispute_gid });
  fs.appendFileSync(OUT, JSON.stringify({ shop: c.domain, db: d, errors: r.errors?.map((e) => e.message), data: r.data }) + "\n");
  if (++n % 50 === 0) console.log(n, "/", all.length);
  await new Promise((z) => setTimeout(z, 400));
}
console.log("done", n);
