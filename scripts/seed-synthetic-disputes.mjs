/**
 * Seed SYNTHETIC disputes into Supabase only. These rows do NOT exist in Shopify.
 * Use for UI/dev testing only. Not mirrored. For real test data, see docs/testing-store-mirror.md.
 *
 * Usage:
 *   npm run seed:synthetic-disputes
 *   node scripts/seed-synthetic-disputes.mjs --shop dev-store.myshopify.com [--count 30]
 *   node scripts/seed-synthetic-disputes.mjs --shop-id <uuid> [--count 20]
 *   node scripts/seed-synthetic-disputes.mjs --shop dev-store.myshopify.com --ensure-shop
 *   node scripts/seed-synthetic-disputes.mjs --shop dev-store.myshopify.com --cleanup
 *
 * Reads SUPABASE_URL_POSTGRES from .env.local.
 */

import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const { Client } = pg;

const WARNING_BANNER = `
⚠️  Seeding synthetic disputes into Supabase only.
    These disputes DO NOT exist in Shopify. Not mirrored.
    For Shopify-backed test data, see docs/testing-store-mirror.md.
`;

const REASONS = [
  "PRODUCT_NOT_RECEIVED",
  "FRAUDULENT",
  "SUBSCRIPTION_CANCELLED",
  "DUPLICATE",
  "CREDIT_NOT_PROCESSED",
  "PRODUCT_UNACCEPTABLE",
];

const DEV_SHOP_ID = "00000000-0000-0000-0000-000000000001";

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return {};
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
  const env = loadEnv();
  const out = {
    shop: env.SEED_DISPUTES_SHOP || null,
    shopId: null,
    count: Math.max(1, parseInt(env.SEED_DISPUTES_COUNT || "20", 10) || 20),
    cleanup: false,
    ensureShop: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--shop" && args[i + 1]) {
      out.shop = args[++i];
    } else if (args[i] === "--shop-id" && args[i + 1]) {
      out.shopId = args[++i];
    } else if (args[i] === "--count" && args[i + 1]) {
      out.count = Math.max(1, parseInt(args[++i], 10) || 20);
    } else if (args[i] === "--cleanup") {
      out.cleanup = true;
    } else if (args[i] === "--ensure-shop") {
      out.ensureShop = true;
    }
  }
  return out;
}

async function main() {
  const { shop, shopId, count, cleanup, ensureShop } = parseArgs();

  if (!shop && !shopId) {
    console.error("Usage: --shop <domain> or --shop-id <uuid> required. Or set SEED_DISPUTES_SHOP in .env.local and run npm run seed:synthetic-disputes");
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

  if (!cleanup) {
    console.warn(WARNING_BANNER);
  }

  const client = new Client({
    connectionString: url,
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
    let { rows } = await client.query(
      "SELECT id FROM shops WHERE shop_domain = $1",
      [shop]
    );
    if (rows.length === 0) {
      if (ensureShop) {
        await client.query(
          `INSERT INTO shops (id, shop_domain, shop_id, plan)
           VALUES ($1, $2, 'gid://shopify/Shop/1', 'growth')
           ON CONFLICT (shop_domain) DO NOTHING`,
          [DEV_SHOP_ID, shop]
        );
        const r = await client.query("SELECT id FROM shops WHERE shop_domain = $1", [shop]);
        rows = r.rows;
        if (rows.length > 0) {
          console.log("Created or found shop for", shop);
        }
      }
    }
    if (rows.length === 0) {
      console.error("Shop not found for domain:", shop, "- add the shop first or use --ensure-shop");
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
    console.log("Cleaned up", rowCount, "synthetic dispute(s).");
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

  console.log("Seeded", inserted, "synthetic dispute(s) for shop", resolvedShopId);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
