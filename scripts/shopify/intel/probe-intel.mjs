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
// Read-only intel probe: what does Shopify hold about a disputed order beyond what we read?
const ids = process.argv.slice(2);
const API = process.env.SHOPIFY_API_VERSION || "2026-01";
const tokCache = new Map();
async function ctx(shopId) {
  if (tokCache.has(shopId)) return tokCache.get(shopId);
  const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", shopId).single();
  const { data: s } = await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id", shopId)
    .eq("session_type", "offline").is("user_id", null).order("created_at", { ascending: false }).limit(1).single();
  const c = { domain: shop.shop_domain, tok: dec(s.access_token_encrypted) }; tokCache.set(shopId, c); return c;
}
async function gql(c, query, variables) {
  const r = await fetch(`https://${c.domain}/admin/api/${API}/graphql.json`, { method: "POST",
    headers: { "X-Shopify-Access-Token": c.tok, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  return r.json();
}
const Q = `query($id: ID!, $did: ID!) {
  dispute: node(id: $did) { ... on ShopifyPaymentsDispute { id type status reasonDetails { reason networkReasonCode } evidenceDueBy evidenceSentOn finalizedOn initiatedAt
    disputeEvidence { id submitted uncategorizedText customerEmailAddress accessActivityLog cancellationRebuttal refundRefusalExplanation
      fulfillments { shippingCarrier shippingTrackingNumber shippingDate }
      disputeFileUploads { id disputeEvidenceType fileSize fileType originalFileName } } } }
  order: node(id: $id) { ... on Order {
    name createdAt note tags sourceName app { name } customAttributes { key value } clientIp
    cancelledAt cancelReason displayFinancialStatus returnStatus
    customerJourneySummary { customerOrderIndex daysToConversion momentsCount { count }
      firstVisit { landingPage referrerUrl source sourceType occurredAt utmParameters { source medium campaign } }
      lastVisit { landingPage referrerUrl source sourceType occurredAt } }
    metafields(first: 30) { nodes { namespace key type value } }
    refunds(first: 10) { id createdAt note staffMember { name } totalRefundedSet { shopMoney { amount } } return { id } }
    transactions(first: 20) { kind status gateway createdAt errorCode formattedGateway paymentDetails { __typename } user { name } }
    customer { id numberOfOrders amountSpent { amount currencyCode } note tags createdAt state verifiedEmail
      events(first: 50, reverse: true) { nodes { __typename createdAt message ... on BasicEvent { action appTitle } ... on CommentEvent { author { name } rawMessage } } } }
    events(first: 100, sortKey: CREATED_AT, reverse: true) { nodes { __typename createdAt message
      ... on BasicEvent { action appTitle attributeToApp attributeToUser criticalAlert secondaryMessage subjectType additionalContent }
      ... on CommentEvent { author { name } rawMessage attachments { name } } } }
  } } }`;
for (const id of ids) {
  const { data: d } = await sb.from("disputes").select("id,shop_id,dispute_gid,order_gid,order_name,status,phase,reason").eq("id", id).single();
  const c = await ctx(d.shop_id);
  const r = await gql(c, Q, { id: d.order_gid, did: d.dispute_gid });
  console.log(`\n===== ${c.domain} ${d.order_name} ${d.phase} ${d.reason} ${d.status}`);
  if (r.errors) console.log("ERRORS", JSON.stringify(r.errors.map((e) => e.message)).slice(0, 1200));
  console.log(JSON.stringify(r.data ?? null));
}
