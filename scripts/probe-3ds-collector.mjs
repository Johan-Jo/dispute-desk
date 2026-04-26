/**
 * Probe the new 3-D Secure collector against the most recent disputes.
 *
 * For each dispute:
 *   1. Pull shop session + order_gid from Supabase
 *   2. Fetch the order via Shopify Admin GraphQL (with receiptJson)
 *   3. Walk receipt.payment_method_details.card.three_d_secure.authenticated
 *   4. Print: gateway, receipt presence, receipt top-level shape,
 *      3DS authenticated flag, what category the canonical categorizer
 *      would assign.
 *
 * Read-only — no writes.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const LIMIT = Number(process.argv[2] ?? 8);

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

function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseReceipt(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return isObj(p) ? p : null;
    } catch {
      return null;
    }
  }
  return isObj(raw) ? raw : null;
}

function readAuthenticated(receipt) {
  try {
    const candidates = [receipt?.latest_charge?.payment_method_details, receipt?.payment_method_details];
    for (const pmd of candidates) {
      if (!isObj(pmd)) continue;
      const card = pmd.card;
      if (!isObj(card)) continue;
      const tds = card.three_d_secure;
      if (!isObj(tds)) continue;
      if (tds.authenticated === true) return true;
    }
    return null;
  } catch {
    return null;
  }
}

function readTdsShape(receipt) {
  const candidates = [receipt?.latest_charge?.payment_method_details, receipt?.payment_method_details];
  for (const pmd of candidates) {
    if (!isObj(pmd)) continue;
    const card = pmd.card;
    if (!isObj(card)) continue;
    if (card.three_d_secure === null) return "null (3DS not used)";
    if (isObj(card.three_d_secure)) return JSON.stringify(card.three_d_secure);
  }
  return "(path unresolved)";
}

/** Mirrors the canonical categorizer's tds_authentication branch. */
function categorize({ tdsVerified, tdsAuthenticated, verifiedSource }) {
  if (tdsVerified === true) return "strong";
  if (tdsAuthenticated === true && verifiedSource === "shopify_receipt") {
    return "moderate";
  }
  return "invalid";
}

const QUERY = `
  query OrderProbe($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        name
        transactions(first: 10) {
          id
          kind
          status
          gateway
          receiptJson
          paymentDetails {
            __typename
            ... on CardPaymentDetails {
              avsResultCode
              cvvResultCode
              wallet
            }
          }
        }
      }
    }
  }
`;

const { data: disputes, error } = await sb
  .from("disputes")
  .select("id, shop_id, order_gid, order_name, reason, created_at")
  .not("order_gid", "is", null)
  .order("created_at", { ascending: false })
  .limit(LIMIT);

if (error) {
  console.error("supabase error:", error);
  process.exit(1);
}

console.log(`── probing 3DS collector against ${disputes.length} most recent disputes ──\n`);

const tokenCache = new Map();
async function tokenFor(shopId) {
  if (tokenCache.has(shopId)) return tokenCache.get(shopId);
  const { data: sess } = await sb
    .from("shop_sessions")
    .select("shop_domain, access_token_encrypted")
    .eq("shop_id", shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sess) return null;
  const token = decrypt(deserialize(sess.access_token_encrypted));
  const entry = { shopDomain: sess.shop_domain, token };
  tokenCache.set(shopId, entry);
  return entry;
}

const summary = {
  total: 0,
  shopify_payments: 0,
  with_receipt: 0,
  authenticated_true: 0,
  authenticated_false: 0,
  authenticated_null: 0,
  categories: { strong: 0, moderate: 0, invalid: 0 },
};

for (const d of disputes) {
  summary.total++;
  const sess = await tokenFor(d.shop_id);
  if (!sess) {
    console.log(`[${d.id.slice(0, 8)}] ${d.order_name ?? "?"} reason=${d.reason} — no offline session for shop\n`);
    continue;
  }
  const endpoint = `https://${sess.shopDomain}/admin/api/2026-01/graphql.json`;
  let json;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": sess.token },
      body: JSON.stringify({ query: QUERY, variables: { id: d.order_gid } }),
    });
    json = await res.json();
  } catch (err) {
    console.log(`[${d.id.slice(0, 8)}] ${d.order_name ?? "?"} fetch error: ${err.message}\n`);
    continue;
  }
  const order = json?.data?.node;
  if (!order) {
    console.log(`[${d.id.slice(0, 8)}] ${d.order_name ?? "?"} — order not returned (errors: ${JSON.stringify(json.errors ?? [])})\n`);
    continue;
  }
  const txs = order.transactions ?? [];
  const primary = txs.find(
    (t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS",
  );
  if (!primary) {
    console.log(`[${d.id.slice(0, 8)}] ${order.name} reason=${d.reason} — no successful sale/auth tx\n`);
    continue;
  }

  const isShopifyPayments = primary.gateway === "shopify_payments";
  if (isShopifyPayments) summary.shopify_payments++;

  const receipt = parseReceipt(primary.receiptJson);
  const receiptPresent = isObj(receipt);
  if (receiptPresent) summary.with_receipt++;

  const auth = receiptPresent ? readAuthenticated(receipt) : null;
  const tdsShape = receiptPresent ? readTdsShape(receipt) : "(no receipt)";
  if (auth === true) summary.authenticated_true++;
  else if (auth === false) summary.authenticated_false++;
  else summary.authenticated_null++;

  // Apply collector's gate: only emits for shopify_payments + boolean auth
  let collectorOutput = null;
  if (isShopifyPayments && receiptPresent && typeof auth === "boolean") {
    collectorOutput = {
      tdsAuthenticated: auth,
      tdsVerified: false,
      verifiedSource: "shopify_receipt",
    };
  }

  const category = collectorOutput
    ? categorize(collectorOutput)
    : "no-emit";

  if (category === "strong" || category === "moderate" || category === "invalid") {
    summary.categories[category] = (summary.categories[category] ?? 0) + 1;
  }

  const receiptKeys = receiptPresent ? Object.keys(receipt).slice(0, 8).join(",") : "—";
  const cardSrc = isObj(receipt?.latest_charge?.payment_method_details?.card)
    ? receipt.latest_charge.payment_method_details.card
    : (isObj(receipt?.payment_method_details?.card) ? receipt.payment_method_details.card : null);
  const cardBranch = cardSrc ? Object.keys(cardSrc).slice(0, 8).join(",") : "—";

  console.log(`[${d.id.slice(0, 8)}] ${order.name} reason=${d.reason}`);
  console.log(`  gateway: ${primary.gateway}`);
  console.log(`  receipt parsed: ${receiptPresent}  top-level keys: ${receiptKeys}`);
  console.log(`  card branch keys: ${cardBranch}`);
  console.log(`  three_d_secure: ${tdsShape}`);
  console.log(`  walker authenticated=true? ${auth === true}`);
  console.log(`  collector emits: ${collectorOutput ? "yes" : "no"}  → category: ${category}`);
  console.log("");
}

console.log("── summary ──");
console.log(JSON.stringify(summary, null, 2));
