/**
 * Deep read-only probe: scan HUNDREDS of a shop's orders (full history)
 * to (1) break down Klarna sub-products (pay_now / pay_later / slice_it /
 * financing / …) and (2) detect ANY order where a real card network is
 * exposed behind Klarna (paymentDescriptor, receiptJson, or company).
 *
 * Reads prod Supabase for the offline token, decrypts locally, hits the
 * shop's Admin GraphQL. Read-only. Paginates back through history.
 *
 * Usage: node scripts/probe-klarna-deep.mjs [shop_domain] [maxOrders=500]
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });

const SHOP_DOMAIN = process.argv[2] || "cay-collective.myshopify.com";
const MAX = Number.parseInt(process.argv[3] || "500", 10);
const SUPA_URL = process.env.NEW_SUPABASE_URL;
const SUPA_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_URL.includes("aokhplydttxtebvbeuzc")) {
  console.error("Refusing: need prod NEW_SUPABASE_URL (aokhply…).");
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return { keyVersion: parseInt(ver.slice(1), 10), iv: Buffer.from(iv, "hex"), tag: Buffer.from(tag, "hex"), ciphertext: Buffer.from(ct, "hex") };
}
function decrypt(p) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${p.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && p.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`No key for version ${p.keyVersion}`);
  const d = createDecipheriv("aes-256-gcm", Buffer.from(hex, "hex"), p.iv);
  d.setAuthTag(p.tag);
  return Buffer.concat([d.update(p.ciphertext), d.final()]).toString("utf8");
}

const { data: shop } = await sb.from("shops").select("id, shop_domain").eq("shop_domain", SHOP_DOMAIN).maybeSingle();
if (!shop) { console.error("no shop"); process.exit(1); }
const { data: sess } = await sb.from("shop_sessions")
  .select("shop_domain, access_token_encrypted").eq("shop_id", shop.id)
  .eq("session_type", "offline").is("user_id", null)
  .order("created_at", { ascending: false }).limit(1).maybeSingle();
if (!sess) { console.error("no offline session"); process.exit(1); }
const token = decrypt(deserialize(sess.access_token_encrypted));

const endpoint = `https://${sess.shop_domain}/admin/api/2026-01/graphql.json`;
const QUERY = `
  query($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges { cursor node {
        id name createdAt
        transactions(first: 6) {
          kind status gateway receiptJson
          paymentDetails {
            __typename
            ... on CardPaymentDetails { company bin wallet }
            ... on LocalPaymentMethodsPaymentDetails { paymentMethodName paymentDescriptor }
          }
        }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function scanReceiptForCard(receiptJson) {
  if (!receiptJson) return null;
  let r = receiptJson;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { return null; } }
  const hits = [];
  const walk = (obj, path) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const kl = k.toLowerCase();
      if (typeof v === "string" && /^(visa|mastercard|master ?card|amex|american express|discover|maestro)$/i.test(v.trim())) hits.push(`${path}${k}=${v}`);
      if ((kl === "brand" || kl === "network" || kl === "card_type" || kl === "scheme" || kl === "funding") && typeof v === "string" && v.trim()) hits.push(`${path}${k}=${v}`);
      if (v && typeof v === "object") walk(v, `${path}${k}.`);
    }
  };
  walk(r, "");
  return hits.length ? [...new Set(hits)].slice(0, 6) : null;
}

const methodCounts = new Map();     // full paymentMethodName breakdown
const typenameCounts = new Map();
const cardCompanyCounts = new Map();
const descriptorSamples = [];
const receiptCardSamples = [];
let scanned = 0, after = null, klarnaTotal = 0, cardBehindKlarna = 0;
function bump(m, k) { m.set(k, (m.get(k) ?? 0) + 1); }

const startedAt = Date.now();
while (scanned < MAX) {
  const first = Math.min(50, MAX - scanned);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: QUERY, variables: { first, after } }),
  });
  const json = await res.json();
  if (json.errors) { console.error("GraphQL errors:", JSON.stringify(json.errors)); break; }
  const conn = json?.data?.orders;
  if (!conn) { console.error("no orders"); break; }
  for (const edge of conn.edges) {
    const o = edge.node; scanned++;
    const tx = (o.transactions ?? []).find((t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS") ?? (o.transactions ?? [])[0];
    const pd = tx?.paymentDetails;
    const typename = pd?.__typename ?? "(none)";
    bump(typenameCounts, typename);
    const method = (pd?.paymentMethodName ?? "").toLowerCase();
    if (method) bump(methodCounts, method);
    if (pd?.company) bump(cardCompanyCounts, pd.company);
    const isKlarna = method.startsWith("klarna");
    if (isKlarna) {
      klarnaTotal++;
      const descriptor = pd?.paymentDescriptor ?? null;
      const receiptCard = scanReceiptForCard(tx?.receiptJson);
      if (descriptor || receiptCard || pd?.company) {
        cardBehindKlarna++;
        if (descriptorSamples.length < 15 && descriptor) descriptorSamples.push({ order: o.name, date: o.createdAt?.slice(0, 10), method, descriptor });
        if (receiptCardSamples.length < 15 && receiptCard) receiptCardSamples.push({ order: o.name, date: o.createdAt?.slice(0, 10), method, receiptCard });
      }
    }
  }
  if (scanned % 100 === 0) console.error(`  …scanned ${scanned} (${Math.round((Date.now()-startedAt)/1000)}s)`);
  if (!conn.pageInfo.hasNextPage) break;
  after = conn.pageInfo.endCursor;
}

console.log(`\n=== scanned ${scanned} orders (most-recent → back) for ${SHOP_DOMAIN} ===`);
console.log(`date range covered: newest → order #${scanned} back\n`);
console.log("paymentDetails.__typename:");
for (const [k, v] of [...typenameCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log("\nKlarna sub-products (paymentMethodName):");
for (const [k, v] of [...methodCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}  (${(v/scanned*100).toFixed(1)}%)`);
console.log("\ncard brand (company) where a real card was present:");
if (cardCompanyCounts.size === 0) console.log("  (none)");
for (const [k, v] of [...cardCompanyCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`\n── Klarna underlying-card summary ──`);
console.log(`Klarna orders scanned:              ${klarnaTotal}`);
console.log(`  ...with ANY card signal exposed:  ${cardBehindKlarna}  (descriptor / receipt / company)`);
if (descriptorSamples.length) { console.log("\n  paymentDescriptor samples:"); for (const s of descriptorSamples) console.log("   ", JSON.stringify(s)); }
if (receiptCardSamples.length) { console.log("\n  receiptJson card-brand samples:"); for (const s of receiptCardSamples) console.log("   ", JSON.stringify(s)); }
