/**
 * Targeted backfill: repopulate shopify_orders.three_ds_authenticated
 * for one shop by re-reading each CARD order's live transaction
 * receiptJson with the FIXED three-path walk.
 *
 * Why: the pre-2026-07 walk missed (a) old receipts nesting the card
 * block under charges.data[0] and (b) modern receipts expressing
 * success as result:"authenticated" with no `authenticated` boolean —
 * so historical rows are false-NULL. See the canonical reader
 * lib/shopify/receipts/threeDs.ts (this script mirrors it verbatim —
 * .mjs can't import TS; keep in sync) and its tests.
 *
 * Scope: payment_gateway='shopify_payments' AND payment_method='card'
 * only (BNPL/wallets can never carry a card-3DS block). Writes ONLY
 * three_ds_authenticated, ONLY where the re-read is `true` (never
 * overwrites NULL with NULL, never writes false). No status flags, no
 * other columns.
 *
 * Usage:
 *   node scripts/backfill-3ds-from-receipts.mjs --shop=<myshopify-domain-substring>          # DRY RUN
 *   node scripts/backfill-3ds-from-receipts.mjs --shop=<myshopify-domain-substring> --apply  # write
 *
 * PROD-ONLY by design: loads .env.production.local and refuses any
 * Supabase project other than aokhply… (prod).
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

const args = process.argv.slice(2);
const shopArg = args.find((a) => a.startsWith("--shop="))?.slice(7);
const APPLY = args.includes("--apply");
if (!shopArg) {
  console.error("Usage: node scripts/backfill-3ds-from-receipts.mjs --shop=<domain-substring> [--apply]");
  process.exit(1);
}

config({ path: join(process.cwd(), ".env.production.local") });
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url?.includes("aokhplydttxtebvbeuzc")) {
  console.error("Refusing: SUPABASE_URL is not the prod project (aokhply…). Loaded:", url);
  process.exit(1);
}
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── token decrypt (mirrors lib/security serialization) ─────────────
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

// ── canonical 3DS walk (mirror of lib/shopify/receipts/threeDs.ts) ──
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseReceiptJson(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(raw) ? raw : null;
}
function readThreeDsAuthenticated(receipt) {
  try {
    const charges = receipt.charges;
    const firstCharge =
      isPlainObject(charges) && Array.isArray(charges.data) ? charges.data[0] : undefined;
    const candidates = [
      receipt.latest_charge?.payment_method_details,
      receipt.payment_method_details,
      isPlainObject(firstCharge) ? firstCharge.payment_method_details : undefined,
    ];
    for (const pmd of candidates) {
      if (!isPlainObject(pmd)) continue;
      const card = pmd.card;
      if (!isPlainObject(card)) continue;
      const tds = card.three_d_secure;
      if (!isPlainObject(tds)) continue;
      if (tds.authenticated === true) return true;
      if (tds.result === "authenticated") return true;
    }
    return null;
  } catch {
    return null;
  }
}

// ── resolve shop + session ─────────────────────────────────────────
const { data: shops, error: shopErr } = await sb
  .from("shops")
  .select("id, shop_domain")
  .ilike("shop_domain", `%${shopArg}%`);
if (shopErr) throw shopErr;
if (!shops?.length) { console.error(`no shop matching "${shopArg}"`); process.exit(1); }
if (shops.length > 1) {
  console.error("ambiguous shop match:", shops.map((s) => s.shop_domain).join(", "));
  process.exit(1);
}
const shop = shops[0];
console.log(`${APPLY ? "APPLY" : "DRY RUN"} · shop: ${shop.shop_domain} (${shop.id})`);

const { data: sess } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", shop.id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (!sess) { console.error("no offline session for shop"); process.exit(1); }
const token = decrypt(deserialize(sess.access_token_encrypted));

// ── collect card orders (paginate past the PostgREST 1000-row cap) ──
const targets = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("shopify_orders")
    .select("shopify_order_id, shopify_order_number, three_ds_authenticated")
    .eq("shop_id", shop.id)
    .eq("payment_gateway", "shopify_payments")
    .eq("payment_method", "card")
    .order("created_at_shopify", { ascending: true })
    .range(from, from + 999);
  if (error) throw error;
  targets.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
console.log(`card orders in scope: ${targets.length} (already true: ${targets.filter((t) => t.three_ds_authenticated === true).length})`);

// ── probe each order's receipt via GraphQL, throttled ──────────────
const QUERY = `
  query OrderProbe($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        transactions(first: 5) { kind status gateway receiptJson }
      }
    }
  }
`;
const endpoint = `https://${sess.shop_domain}/admin/api/2026-01/graphql.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = { probed: 0, newlyTrue: 0, alreadyTrue: 0, stillNull: 0, noReceipt: 0, errors: 0, updated: 0 };
const toUpdate = [];

for (let i = 0; i < targets.length; i++) {
  const o = targets[i];
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: QUERY, variables: { id: o.shopify_order_id } }),
    });
    if (res.status === 429) {
      await sleep(2000);
      i--; // retry this order
      continue;
    }
    const json = await res.json();
    const txs = json?.data?.node?.transactions ?? [];
    const tx = txs.find(
      (t) => (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS",
    );
    stats.probed++;
    if (!tx || tx.gateway !== "shopify_payments") { stats.noReceipt++; continue; }
    const receipt = parseReceiptJson(tx.receiptJson);
    if (!receipt) { stats.noReceipt++; continue; }
    const authenticated = readThreeDsAuthenticated(receipt);
    if (authenticated === true) {
      if (o.three_ds_authenticated === true) stats.alreadyTrue++;
      else { stats.newlyTrue++; toUpdate.push(o); }
    } else {
      stats.stillNull++;
    }
  } catch (e) {
    stats.errors++;
    console.error(`  error on ${o.shopify_order_number}: ${e.message}`);
  }
  if ((i + 1) % 200 === 0) {
    console.log(`  … ${i + 1}/${targets.length} probed (newly true so far: ${stats.newlyTrue})`);
  }
  await sleep(250); // ~4 rps
}

console.log("\n── probe summary ──");
console.log(stats);
console.log(`orders to flip NULL→true: ${toUpdate.length}`);

if (!APPLY) {
  console.log("\nDRY RUN — no writes. Re-run with --apply to persist.");
  process.exit(0);
}

// ── apply: single-column updates, batched ──────────────────────────
for (const o of toUpdate) {
  const { error } = await sb
    .from("shopify_orders")
    .update({ three_ds_authenticated: true })
    .eq("shop_id", shop.id)
    .eq("shopify_order_id", o.shopify_order_id);
  if (error) {
    stats.errors++;
    console.error(`  update failed ${o.shopify_order_number}: ${error.message}`);
  } else {
    stats.updated++;
  }
}
console.log(`\nAPPLIED: ${stats.updated}/${toUpdate.length} rows updated to three_ds_authenticated=true`);
