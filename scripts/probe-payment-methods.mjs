/**
 * One-off read-only probe: what payment methods does a shop actually use?
 *
 * Our stored `shopify_orders.payment_gateway` is only the top-level
 * gateway name (`shopify_payments`), which collapses card / Shop Pay /
 * Klarna / Apple Pay into one value. The distinguishing data is in
 * Order.transactions[].paymentDetails, which is a union whose non-card
 * members (Klarna/BNPL/local methods, Shop Pay Installments, wallets)
 * we don't currently read. This probe expands that union live.
 *
 * Reads prod Supabase for the session row + encrypted offline token,
 * decrypts locally, then hits the shop's Admin GraphQL. Read-only:
 * no writes to Shopify or Supabase.
 *
 * Usage:
 *   node scripts/probe-payment-methods.mjs <shop_domain> [sampleOrders]
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

// Load dev .env.local first (for TOKEN_ENCRYPTION_KEY), then prod file.
config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });

const SHOP_DOMAIN = process.argv[2] || "cay-collective.myshopify.com";
const SAMPLE = Number.parseInt(process.argv[3] || "60", 10);

// Prod Supabase — NEW_* keys from the cutover env file.
const SUPA_URL = process.env.NEW_SUPABASE_URL;
const SUPA_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error("Missing NEW_SUPABASE_URL / NEW_SUPABASE_SERVICE_ROLE_KEY (prod).");
  process.exit(1);
}
if (!SUPA_URL.includes("aokhplydttxtebvbeuzc")) {
  console.error(`Refusing: expected prod ref aokhplydttxtebvbeuzc, got ${SUPA_URL}`);
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
function decrypt(payload) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`No key for version ${payload.keyVersion} (${envName})`);
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

const { data: shop } = await sb
  .from("shops")
  .select("id, shop_domain")
  .eq("shop_domain", SHOP_DOMAIN)
  .maybeSingle();
if (!shop) { console.error(`No shop row for ${SHOP_DOMAIN}`); process.exit(1); }
console.log("shop:", shop);

const { data: sess } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", shop.id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (!sess) { console.error("No offline session row."); process.exit(1); }

let token;
try {
  token = decrypt(deserialize(sess.access_token_encrypted));
} catch (e) {
  console.error("\nDECRYPT FAILED — the local TOKEN_ENCRYPTION_KEY does not match the prod key.");
  console.error("Reason:", e.message);
  console.error("=> Cannot run this probe locally; the prod token key lives on Vercel only.");
  process.exit(2);
}
console.log("token decrypted OK (len", token.length, ")");

// Expand the paymentDetails union across all known members so we can
// see Klarna / Shop Pay Installments / local methods / wallets, not just
// card. Field availability varies by API version; unknown members fall
// through to __typename which alone tells us the method family.
const QUERY = `
  query PaymentMethodProbe($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          name
          createdAt
          paymentGatewayNames
          transactions(first: 5) {
            kind
            status
            gateway
            paymentDetails {
              __typename
              ... on CardPaymentDetails { company wallet }
              ... on LocalPaymentMethodsPaymentDetails { paymentMethodName paymentDescriptor }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const endpoint = `https://${sess.shop_domain}/admin/api/2026-01/graphql.json`;

const methodCounts = new Map();
const gatewayCounts = new Map();
const walletCounts = new Map();
const cardBrandCounts = new Map();
let scanned = 0;
let after = null;
let sampleOfKlarna = [];

function bump(map, key) { map.set(key, (map.get(key) ?? 0) + 1); }

while (scanned < SAMPLE) {
  const first = Math.min(50, SAMPLE - scanned);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: QUERY, variables: { first, after } }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
    break;
  }
  const conn = json?.data?.orders;
  if (!conn) { console.error("No orders in response"); break; }

  for (const edge of conn.edges) {
    const o = edge.node;
    scanned++;
    for (const g of o.paymentGatewayNames ?? []) bump(gatewayCounts, g);
    // Pick the primary sale/auth transaction's paymentDetails.
    const tx = (o.transactions ?? []).find(
      (t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS",
    ) ?? (o.transactions ?? [])[0];
    const pd = tx?.paymentDetails;
    const typename = pd?.__typename ?? "(none)";
    // For local methods, key on the specific method name (Klarna, iDEAL…).
    const label = pd?.paymentMethodName
      ? `Local:${pd.paymentMethodName}`
      : pd?.wallet
        ? `Card+Wallet:${pd.wallet}`
        : typename;
    bump(methodCounts, label);
    if (pd?.wallet) bump(walletCounts, pd.wallet);
    if (pd?.company) bump(cardBrandCounts, pd.company);
    if (pd?.paymentMethodName && sampleOfKlarna.length < 6) {
      sampleOfKlarna.push({ name: o.name, createdAt: o.createdAt, method: pd.paymentMethodName, descriptor: pd.paymentDescriptor });
    }
  }
  if (!conn.pageInfo.hasNextPage) break;
  after = conn.pageInfo.endCursor;
}

console.log(`\n── scanned ${scanned} most-recent orders ──`);
console.log("\npaymentGatewayNames (top-level gateway):");
for (const [k, v] of [...gatewayCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log("\npaymentDetails.__typename (actual method family):");
for (const [k, v] of [...methodCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log("\ncard brand (company), where card:");
for (const [k, v] of [...cardBrandCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log("\nwallet (Apple Pay / Google Pay / Shop Pay), where present:");
for (const [k, v] of [...walletCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
if (sampleOfKlarna.length) {
  console.log("\nsample non-card/BNPL orders:");
  for (const s of sampleOfKlarna) console.log(" ", JSON.stringify(s));
}
