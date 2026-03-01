/**
 * Bulk-seed test disputes into Supabase for a given shop.
 * Use for dev/testing the pipeline and UI without creating disputes in Shopify.
 *
 * Usage:
 *   node scripts/seed-bulk-disputes.mjs --shop dev-store.myshopify.com [--count 30]
 *   node scripts/seed-bulk-disputes.mjs --shop-id <uuid> [--count 20]
 *   node scripts/seed-bulk-disputes.mjs --shop dev-store.myshopify.com --cleanup
 *
 * Reads SUPABASE_URL_POSTGRES from .env.local.
 */

import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";

const { Client } = pg;

const REASONS = [
  "PRODUCT_NOT_RECEIVED",
  "FRAUDULENT",
  "SUBSCRIPTION_CANCELLED",
  "DUPLICATE",
  "CREDIT_NOT_PROCESSED",
  "PRODUCT_UNACCEPTABLE",
];

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  const vars = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    vars[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return vars;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { shop: null, shopId: null, count: 20, cleanup: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--shop" && args[i + 1]) {
      out.shop = args[++i];
    } else if (args[i] === "--shop-id" && args[i + 1]) {
      out.shopId = args[++i];
    } else if (args[i] === "--count" && args[i + 1]) {
      out.count = Math.max(1, parseInt(args[++i], 10) || 20);
    } else if (args[i] === "--cleanup") {
      out.cleanup = true;
    }
  }
  return out;
}

async function main() {
  const { shop, shopId, count, cleanup } = parseArgs();

  if (!shop && !shopId) {
    console.error("Usage: --shop <domain> or --shop-id <uuid> required.");
    process.exit(1);
  }
  if (shop && shopId) {
    console.error("Use only one of --shop or --shop-id.");
    process.exit(1);
  }

  const env = loadEnv();
  const url = env.SUPABASE_URL_POSTGRES;
  if (!url) {
    console.error("SUPABASE_URL_POSTGRES not set in .env.local");
    process.exit(1);
  }

  const match = url.match(
    /postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)/
  );
  if (!match) {
    console.error("SUPABASE_URL_POSTGRES format not recognized");
    process.exit(1);
  }

  const client = new Client({
    host: match[3],
    port: parseInt(match[4], 10),
    database: match[5],
    user: match[1],
    password: match[2],
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  let resolvedShopId;
  if (shopId) {
    const { rows } = await client.query(
      "SELECT id FROM shops WHERE id = $1",
      [shopId]
    );
    if (rows.length === 0) {
      console.error("Shop not found for id:", shopId);
      await client.end();
      process.exit(1);
    }
    resolvedShopId = rows[0].id;
  } else {
    const { rows } = await client.query(
      "SELECT id FROM shops WHERE shop_domain = $1",
      [shop]
    );
    if (rows.length === 0) {
      console.error("Shop not found for domain:", shop);
      await client.end();
      process.exit(1);
    }
    resolvedShopId = rows[0].id;
  }

  if (cleanup) {
    const { rowCount } = await client.query(
      `DELETE FROM disputes
       WHERE shop_id = $1 AND dispute_gid LIKE 'gid://shopify/ShopifyPaymentsDispute/seed-%'`,
      [resolvedShopId]
    );
    console.log("Cleaned up", rowCount, "seeded dispute(s).");
    await client.end();
    return;
  }

  let inserted = 0;
  for (let i = 1; i <= count; i++) {
    const reason = REASONS[(i - 1) % REASONS.length];
    const amount = (15 + (i % 200) * 0.5).toFixed(2);
    const dueDays = (i % 14) + 1;

    await client.query(
      `INSERT INTO disputes (shop_id, dispute_gid, reason, status, amount, currency_code, due_at)
       VALUES ($1, $2, $3, 'needs_response', $4, 'USD', now() + ($5::int || ' days')::interval)
       ON CONFLICT (shop_id, dispute_gid) DO UPDATE SET updated_at = now()`,
      [
        resolvedShopId,
        `gid://shopify/ShopifyPaymentsDispute/seed-${i}`,
        reason,
        amount,
        dueDays,
      ]
    );
    inserted++;
  }

  console.log("Seeded", inserted, "dispute(s) for shop", resolvedShopId);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
