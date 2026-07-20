/**
 * Probe: do cay's Shopify Payments CARD receipts carry a three_d_secure
 * block at all — and if so, in what shape?
 *
 * Context (2026-07-19): shopify_orders.three_ds_authenticated is NULL for
 * all 12,494 of cay's Shopify Payments orders. The collector only writes
 * true on receipt.latest_charge.payment_method_details.card.three_d_secure
 * .authenticated === true, collapsing everything else to NULL. This probe
 * distinguishes:
 *   (a) receipts genuinely lack the three_d_secure block (3DS never ran), vs
 *   (b) the block exists with authenticated:false / result:"exempted" etc.
 *       (SCA ran frictionless/exempted — invisible to our walk), vs
 *   (c) the EU receipt shape differs from the verified US shape.
 *
 * READ-ONLY. Loads .env.production.local (cay is a prod shop) and refuses
 * to run against any Supabase project other than prod (aokhply…).
 *
 * Run: node scripts/probe-3ds-cay-receipts.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.production.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url?.includes("aokhplydttxtebvbeuzc")) {
  console.error("Refusing: SUPABASE_URL is not the prod project (aokhply…). Loaded:", url);
  process.exit(1);
}
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}
function decrypt(payload) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

// ── 1. Find cay's shop ─────────────────────────────────────────────
const { data: shops, error: shopErr } = await sb
  .from("shops")
  .select("id, shop_domain")
  .ilike("shop_domain", "%cay%");
if (shopErr) throw shopErr;
if (!shops?.length) { console.error("no cay shop found"); process.exit(1); }
const shop = shops[0];
console.log("shop:", shop.shop_domain, shop.id);

// ── 2. Payment-method distribution (context for the 0%) ────────────
const METHODS = ["card", "klarna", "shop_pay", "apple_pay", "google_pay"];
console.log("\n── payment_method distribution (shopify_payments orders) ──");
for (const m of METHODS) {
  const { count } = await sb
    .from("shopify_orders")
    .select("shopify_order_id", { count: "exact", head: true })
    .eq("shop_id", shop.id)
    .eq("payment_gateway", "shopify_payments")
    .eq("payment_method", m);
  console.log(`  ${m.padEnd(11)} ${count}`);
}
const { count: nullCount } = await sb
  .from("shopify_orders")
  .select("shopify_order_id", { count: "exact", head: true })
  .eq("shop_id", shop.id)
  .eq("payment_gateway", "shopify_payments")
  .is("payment_method", null);
console.log(`  (null)      ${nullCount}`);

// ── 3. Sample recent CARD orders (where 3DS could exist) ───────────
const { data: newest, error: ordErr } = await sb
  .from("shopify_orders")
  .select("shopify_order_id, shopify_order_number, created_at_shopify")
  .eq("shop_id", shop.id)
  .eq("payment_gateway", "shopify_payments")
  .eq("payment_method", "card")
  .order("created_at_shopify", { ascending: false })
  .limit(25);
if (ordErr) throw ordErr;
const { data: oldest } = await sb
  .from("shopify_orders")
  .select("shopify_order_id, shopify_order_number, created_at_shopify")
  .eq("shop_id", shop.id)
  .eq("payment_gateway", "shopify_payments")
  .eq("payment_method", "card")
  .order("created_at_shopify", { ascending: true })
  .limit(25);
const cardOrders = [...(oldest ?? []), ...(newest ?? [])];
console.log(`\nsampling ${cardOrders.length} card orders (25 oldest + 25 newest)`);

// ── 4. Offline session token ───────────────────────────────────────
const { data: sess } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", shop.id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (!sess) { console.error("no offline session"); process.exit(1); }
const token = decrypt(deserialize(sess.access_token_encrypted));

// ── 5. Fetch receipts live from Shopify, walk for 3DS ──────────────
const QUERY = `
  query OrderProbe($id: ID!) {
    node(id: $id) {
      ... on Order {
        id name test
        transactions(first: 5) { id kind status gateway receiptJson }
      }
    }
  }
`;
const endpoint = `https://${sess.shop_domain}/admin/api/2026-01/graphql.json`;

function parseReceipt(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return null; } }
  return typeof raw === "object" ? raw : null;
}

const tally = {
  ordersProbed: 0, receiptsPresent: 0,
  pmdPresent: 0, cardBlockPresent: 0,
  tdsBlockPresent: 0, tdsNull: 0,
  tdsShapes: {},
};

for (const o of cardOrders) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: QUERY, variables: { id: o.shopify_order_id } }),
  });
  const json = await res.json();
  const node = json?.data?.node;
  if (!node) { console.log(`  ${o.shopify_order_number}: NO NODE`, JSON.stringify(json?.errors ?? json).slice(0, 200)); continue; }
  const tx = (node.transactions ?? []).find(
    (t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS",
  );
  tally.ordersProbed++;
  if (!tx) { console.log(`  ${node.name}: no SUCCESS sale/auth tx`); continue; }
  const receipt = parseReceipt(tx.receiptJson);
  if (!receipt) { console.log(`  ${node.name}: receipt null/unparseable (gateway=${tx.gateway})`); continue; }
  tally.receiptsPresent++;

  const pmdModern = receipt.latest_charge?.payment_method_details;
  const pmdLegacy = receipt.payment_method_details;
  const pmdCharges = receipt.charges?.data?.[0]?.payment_method_details;
  const pmd = pmdModern ?? pmdLegacy ?? pmdCharges;
  const where = pmdModern ? "latest_charge" : pmdLegacy ? "root" : pmdCharges ? "charges.data[0]" : "ABSENT";
  if (!pmd) {
    console.log(`  ${node.name}: NO payment_method_details. top-level keys: ${Object.keys(receipt).slice(0, 15).join(",")}`);
    continue;
  }
  tally.pmdPresent++;
  const card = pmd.card;
  if (!card) {
    console.log(`  ${node.name}: pmd(${where}).type=${pmd.type} — no card block. pmd keys: ${Object.keys(pmd).slice(0, 10).join(",")}`);
    continue;
  }
  tally.cardBlockPresent++;
  const tds = card.three_d_secure;
  if (tds === undefined) {
    console.log(`  ${node.name}: card block has NO three_d_secure KEY. card keys: ${Object.keys(card).slice(0, 15).join(",")}`);
  } else if (tds === null) {
    tally.tdsNull++;
  } else {
    tally.tdsBlockPresent++;
    const shape = JSON.stringify(tds);
    tally.tdsShapes[shape] = (tally.tdsShapes[shape] ?? 0) + 1;
    console.log(`  ${node.name}: three_d_secure PRESENT → ${shape}`);
  }
}

console.log("\n── tally ──");
console.log(tally);
