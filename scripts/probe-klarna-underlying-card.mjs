/**
 * One-off read-only probe: when a Klarna order is disputed, does Shopify
 * expose the UNDERLYING settlement card network (Visa/MC/Amex) anywhere —
 * on LocalPaymentMethodsPaymentDetails.paymentDescriptor, or in the
 * transaction receiptJson?
 *
 * This decides whether CE 3.0 (Visa-card-only) could ever apply to a
 * "Klarna paid with a Visa card" order for cay-collective.
 *
 * Reads prod Supabase for the offline token, decrypts locally, hits the
 * shop's Admin GraphQL. Read-only. Focuses on the shop's DISPUTED orders.
 *
 * Usage: node scripts/probe-klarna-underlying-card.mjs [shop_domain]
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });

const SHOP_DOMAIN = process.argv[2] || "cay-collective.myshopify.com";
const SUPA_URL = process.env.NEW_SUPABASE_URL;
const SUPA_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_URL.includes("aokhplydttxtebvbeuzc")) {
  console.error("Refusing: need prod NEW_SUPABASE_URL (aokhply…).");
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
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

const { data: shop } = await sb
  .from("shops").select("id, shop_domain").eq("shop_domain", SHOP_DOMAIN).maybeSingle();
if (!shop) { console.error("no shop"); process.exit(1); }

const { data: sess } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", shop.id).eq("session_type", "offline").is("user_id", null)
  .order("created_at", { ascending: false }).limit(1).maybeSingle();
if (!sess) { console.error("no offline session"); process.exit(1); }

const token = decrypt(deserialize(sess.access_token_encrypted));

// Pull the shop's disputed orders (via dispute rows) — those are the ones
// CE 3.0 would run against. Then fetch each order's full transaction shape.
const { data: disputes } = await sb
  .from("disputes")
  .select("id, reason, order_gid")
  .eq("shop_id", shop.id)
  .not("order_gid", "is", null)
  .limit(25);

const endpoint = `https://${sess.shop_domain}/admin/api/2026-01/graphql.json`;
const ORDER_TX = `
  query($id: ID!) {
    node(id: $id) {
      ... on Order {
        id name createdAt
        transactions(first: 10) {
          kind status gateway
          receiptJson
          paymentDetails {
            __typename
            ... on CardPaymentDetails { company bin wallet }
            ... on LocalPaymentMethodsPaymentDetails { paymentMethodName paymentDescriptor }
          }
        }
      }
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
      if (typeof v === "string" && /^(visa|mastercard|master card|amex|american express|discover)$/i.test(v.trim())) {
        hits.push(`${path}${k}=${v}`);
      }
      if ((kl === "brand" || kl === "network" || kl === "card_type" || kl === "scheme") && typeof v === "string") {
        hits.push(`${path}${k}=${v}`);
      }
      if (v && typeof v === "object") walk(v, `${path}${k}.`);
    }
  };
  walk(r, "");
  return hits.length ? [...new Set(hits)] : null;
}

console.log(`\nProbing ${disputes?.length ?? 0} disputed orders for ${SHOP_DOMAIN}...\n`);
let klarnaWithCard = 0, klarnaNoCard = 0, cardCount = 0;
for (const d of disputes ?? []) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: ORDER_TX, variables: { id: d.order_gid } }),
  });
  const json = await res.json();
  const o = json?.data?.node;
  if (!o) { console.log(`${d.reason}\t${d.order_gid}\t(order not found)`); continue; }
  const tx = (o.transactions ?? []).find(
    (t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS",
  ) ?? (o.transactions ?? [])[0];
  const pd = tx?.paymentDetails;
  const typename = pd?.__typename ?? "(none)";
  const method = pd?.paymentMethodName ?? null;
  const descriptor = pd?.paymentDescriptor ?? null;
  const company = pd?.company ?? null;
  const receiptCard = scanReceiptForCard(tx?.receiptJson);

  const isKlarna = (method ?? "").toLowerCase().startsWith("klarna");
  if (typename === "CardPaymentDetails") cardCount++;
  else if (isKlarna) {
    if (descriptor || receiptCard) klarnaWithCard++; else klarnaNoCard++;
  }

  console.log(
    `${o.name}\t${d.reason}\ttype=${typename}` +
    (method ? `\tmethod=${method}` : "") +
    (descriptor ? `\tDESCRIPTOR=${descriptor}` : "") +
    (company ? `\tcompany=${company}` : "") +
    (receiptCard ? `\tRECEIPT_CARD=${JSON.stringify(receiptCard)}` : ""),
  );
}

console.log(`\n── summary ──`);
console.log(`pure card orders:              ${cardCount}`);
console.log(`Klarna WITH underlying card:   ${klarnaWithCard}  (descriptor or receipt reveals Visa/MC/…)`);
console.log(`Klarna with NO card exposed:   ${klarnaNoCard}`);
