/**
 * One-off backfill: populate shopify_orders.payment_method for orders
 * already synced before the column existed (migration
 * 20260702130000_shopify_orders_payment_method.sql).
 *
 * Forward sync (webhook ingest + ongoing backfill pages) already writes
 * payment_method via pickPaymentMethod. This script only fills the
 * historical rows. It re-reads each order's transactions[].paymentDetails
 * from Shopify — the one place card / Apple Pay / Klarna are
 * distinguishable — and UPDATEs the single column. Read-only against
 * Shopify; the only write is the payment_method UPDATE.
 *
 * Safe to re-run: only touches rows where payment_method IS NULL (unless
 * --all is passed), and Shopify reads are idempotent.
 *
 * Usage:
 *   node scripts/backfill-payment-method.mjs [shop_domain] [--all] [--dry] [--limit=N]
 *     shop_domain  restrict to one shop (default: every active shop)
 *     --all        re-derive even rows that already have a payment_method
 *     --dry        compute + print counts, write nothing
 *     --limit=N    stop after scanning N orders per shop (sanity checks)
 *
 * Env: reads prod Supabase via NEW_SUPABASE_* (.env.production.local)
 * and TOKEN_ENCRYPTION_KEY (.env.local) to decrypt offline tokens.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env.production.local"), override: false });

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry");
const ALL = ARGS.includes("--all");
const LIMIT_ARG = ARGS.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number.parseInt(LIMIT_ARG.split("=")[1], 10) : Infinity;
const CONC_ARG = ARGS.find((a) => a.startsWith("--concurrency="));
// Bounded concurrency for the per-order Shopify reads. Serial is far too
// slow for multi-thousand-order shops; 8 stays comfortably inside
// Shopify's cost budget (each read ~1 point, restore 200/s).
const CONCURRENCY = CONC_ARG ? Math.max(1, Number.parseInt(CONC_ARG.split("=")[1], 10)) : 8;
const ONLY_SHOP = ARGS.find((a) => !a.startsWith("--")) ?? null;

const SUPA_URL = process.env.NEW_SUPABASE_URL;
const SUPA_KEY = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY || !SUPA_URL.includes("aokhplydttxtebvbeuzc")) {
  console.error("Refusing: NEW_SUPABASE_URL must be the prod ref aokhplydttxtebvbeuzc.");
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

function deserialize(raw) {
  const [v, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(v.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}
function decrypt(p) {
  let hex = process.env[`TOKEN_ENCRYPTION_KEY_V${p.keyVersion}`];
  if (!hex && p.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`No key for version ${p.keyVersion}`);
  const key = Buffer.from(hex, "hex");
  const d = createDecipheriv("aes-256-gcm", key, p.iv);
  d.setAuthTag(p.tag);
  return Buffer.concat([d.update(p.ciphertext), d.final()]).toString("utf8");
}

// Mirror of lib/shopify/queries/ordersForBackfill.ts pickPaymentMethod.
// Kept in sync manually — the .ts helper isn't importable from a plain
// .mjs script without a build step. Any change there must change here.
function pickPaymentMethod(transactions) {
  if (!transactions?.length) return null;
  const tx =
    transactions.find(
      (t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS",
    ) ?? transactions[0];
  const pd = tx?.paymentDetails;
  if (!pd) return null;
  const local = pd.paymentMethodName?.trim();
  if (local) return local.toLowerCase();
  if (pd.__typename === "CardPaymentDetails") {
    const wallet = pd.wallet?.trim();
    if (wallet) return wallet.toLowerCase();
    return "card";
  }
  return null;
}

const QUERY = `
  query PaymentMethodBackfill($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        transactions(first: 5) {
          kind
          status
          paymentDetails {
            __typename
            ... on CardPaymentDetails { wallet }
            ... on LocalPaymentMethodsPaymentDetails { paymentMethodName }
          }
        }
      }
    }
  }
`;

async function loadToken(shopId) {
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
  return { shopDomain: sess.shop_domain, token: decrypt(deserialize(sess.access_token_encrypted)) };
}

/** Process one order: read paymentDetails from Shopify, write the derived
 *  method. Returns "updated" | "skipped". Errors are logged, not thrown,
 *  so one bad order never aborts the whole shop. */
async function processOrder(shop, auth, endpoint, row) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": auth.token },
    body: JSON.stringify({ query: QUERY, variables: { id: row.shopify_order_id } }),
  });
  const json = await res.json();
  if (json.errors) {
    console.warn(`  order ${row.shopify_order_id}: ${JSON.stringify(json.errors)}`);
    return "skipped";
  }
  const method = pickPaymentMethod(json?.data?.node?.transactions ?? null);
  if (method == null) return "skipped"; // never write null over an unknown
  if (row.payment_method === method) return "skipped";
  if (!DRY) {
    const { error: upErr } = await sb
      .from("shopify_orders")
      .update({ payment_method: method, updated_at: new Date().toISOString() })
      .eq("shop_id", shop.id)
      .eq("shopify_order_id", row.shopify_order_id);
    if (upErr) {
      console.warn(`  update failed ${row.shopify_order_id}: ${upErr.message}`);
      return "skipped";
    }
  }
  return "updated";
}

async function backfillShop(shop) {
  const auth = await loadToken(shop.id);
  if (!auth) {
    console.log(`  [${shop.shop_domain}] no offline session — skipped`);
    return { scanned: 0, updated: 0 };
  }
  const endpoint = `https://${auth.shopDomain}/admin/api/2026-01/graphql.json`;

  let scanned = 0;
  let updated = 0;
  // Keyset (cursor) pagination on shopify_order_id, NOT offset. We UPDATE
  // rows in place and (by default) filter payment_method IS NULL, so the
  // matched set shrinks as we go — an OFFSET-based window would skip rows
  // each page. Advancing by "shopify_order_id > lastSeen" is stable under
  // that mutation and never skips or repeats. Requires an ascending sort.
  let cursor = null;
  const PAGE = 500;
  outer: for (;;) {
    let q = sb
      .from("shopify_orders")
      .select("shopify_order_id, payment_method")
      .eq("shop_id", shop.id)
      .order("shopify_order_id", { ascending: true })
      .limit(PAGE);
    if (!ALL) q = q.is("payment_method", null);
    if (cursor != null) q = q.gt("shopify_order_id", cursor);
    const { data: rows, error } = await q;
    if (error) throw new Error(`row fetch failed: ${error.message}`);
    if (!rows || rows.length === 0) break;
    cursor = rows[rows.length - 1].shopify_order_id;

    // Process the page in bounded-concurrency chunks. Within a chunk the
    // Shopify reads run in parallel; chunks run sequentially so we never
    // exceed CONCURRENCY in flight.
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (scanned >= LIMIT) break outer;
      const room = LIMIT - scanned;
      const chunk = rows.slice(i, i + Math.min(CONCURRENCY, room));
      const outcomes = await Promise.all(
        chunk.map((row) => processOrder(shop, auth, endpoint, row)),
      );
      scanned += chunk.length;
      updated += outcomes.filter((o) => o === "updated").length;
      // Log roughly every 500 scanned so long shops show a heartbeat.
      if (scanned % 500 < CONCURRENCY) {
        console.log(`  [${shop.shop_domain}] progress: scanned=${scanned} updated=${updated}`);
      }
    }
    if (rows.length < PAGE) break;
  }
  console.log(
    `  [${shop.shop_domain}] scanned=${scanned} updated=${updated}${DRY ? " (dry-run)" : ""}`,
  );
  return { scanned, updated };
}

let shopQ = sb.from("shops").select("id, shop_domain").is("uninstalled_at", null);
if (ONLY_SHOP) shopQ = shopQ.eq("shop_domain", ONLY_SHOP);
const { data: shops, error: shopErr } = await shopQ;
if (shopErr) { console.error(shopErr.message); process.exit(1); }
if (!shops?.length) { console.error("No matching shops."); process.exit(1); }

console.log(`Backfilling payment_method for ${shops.length} shop(s)${DRY ? " (dry-run)" : ""}${ALL ? " (--all)" : ""}\n`);
let totalScanned = 0;
let totalUpdated = 0;
for (const shop of shops) {
  const r = await backfillShop(shop);
  totalScanned += r.scanned;
  totalUpdated += r.updated;
}
console.log(`\nDone. scanned=${totalScanned} updated=${totalUpdated}${DRY ? " (dry-run — nothing written)" : ""}`);
