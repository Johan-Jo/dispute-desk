/**
 * One-shot re-ingest backfill for shopify_orders.customer_email +
 * shopify_orders.customer_shopify_id.
 *
 * Context: the columns were added 2026-05-20 by migration
 * 20260520184853_shopify_orders_customer_columns.sql and the
 * ingestion path was extended to populate them — but every existing
 * row is null because they were ingested earlier. This script fills
 * the gap so the v1.5 `order_risk_history` view aggregates over
 * real-looking data instead of all-zero customer columns.
 *
 * Strategy by row kind:
 *
 *   - Real Shopify orders (76 on prod today): query the Shopify
 *     Admin GraphQL endpoint by GID in batches of 100, read
 *     `customer { id email }` from the response, write back. Uses
 *     the shop's offline session token.
 *
 *   - Seeded fixture orders (6,238 on prod today): synthesise from
 *     a small deterministic customer pool keyed on the order ID.
 *     Same order ID → same customer assignment across re-runs, so
 *     the cross-order aggregates the view exposes are stable and
 *     reproducible. Pool size + sampling are chosen to produce a
 *     realistic-looking distribution (most customers with 5-30
 *     orders, a handful with 50+).
 *
 * Idempotent: rows that already have customer_email are skipped.
 * Safe to re-run; safe to dry-run with --dry-run.
 *
 * Usage:
 *   node -r dotenv/config scripts/backfill-customer-info.mjs dotenv_config_path=.env.local
 *   node -r dotenv/config scripts/backfill-customer-info.mjs dotenv_config_path=.env.local --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "node:crypto";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-01";
const DRY_RUN = process.argv.includes("--dry-run");

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── Helpers ─────────────────────────────────────────────────────

/** Mirrors lib/security/encryption.ts decrypt() — picks the key from
 *  TOKEN_ENCRYPTION_KEY_V{n} based on the version prefix in the stored
 *  payload (format: v{n}:{iv}:{tag}:{ciphertext}). */
function decryptToken(serialized) {
  const parts = serialized.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Invalid encrypted payload format");
  }
  const version = parseInt(parts[0].slice(1), 10);
  const keyHex = process.env[`TOKEN_ENCRYPTION_KEY_V${version}`];
  if (!keyHex) {
    throw new Error(`TOKEN_ENCRYPTION_KEY_V${version} missing from env`);
  }
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const cipher = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
  return plain.toString("utf8");
}

/** Deterministic LCG keyed on the seeded order suffix. Same suffix
 *  always returns the same customer index — so re-runs produce
 *  identical customer assignments and the view's per-customer
 *  aggregates stay stable. */
function customerIndexForSeed(orderGid, poolSize) {
  // Extract the UUID-like suffix after "SEED-".
  const suffix = orderGid.replace(/^.*SEED-/, "");
  // Simple FNV-1a-ish 32-bit hash of the suffix → pool index.
  let h = 0x811c9dc5;
  for (let i = 0; i < suffix.length; i++) {
    h ^= suffix.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % poolSize;
}

/** Builds a pool of synthetic customers shaped like real Shopify
 *  records. Keeping the pool small relative to the order count
 *  guarantees many customers will have many orders, which is the
 *  whole point of the v1.5 aggregates. */
function buildCustomerPool(size) {
  const firstNames = [
    "Anna", "Erik", "Maria", "Carlos", "Sofia", "Lukas", "Emma", "Pierre",
    "Isabella", "Henrik", "Camille", "Joao", "Olivia", "Mateus", "Lina",
    "Felix", "Alma", "Noah", "Mia", "Diego", "Lea", "Hugo", "Vera", "Iris",
  ];
  const lastNames = [
    "Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson",
    "Olsson", "Persson", "Svensson", "Gustafsson", "Pettersson", "Jonsson",
    "Jansson", "Hansson", "Bengtsson", "Lindberg", "Holm", "Sjoberg",
  ];
  const domains = [
    "gmail.com", "outlook.com", "icloud.com", "proton.me", "yahoo.com",
    "fastmail.com", "tutanota.com", "live.com",
  ];
  const pool = [];
  for (let i = 0; i < size; i++) {
    // Deterministic by index — re-runs produce the same pool.
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[Math.floor(i / firstNames.length) % lastNames.length];
    const domain = domains[i % domains.length];
    // Append the index so emails stay unique even when fn+ln collide.
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@${domain}`;
    // Synthetic GIDs use a clear "SEED-CUSTOMER" prefix so they're
    // never confused with real Shopify Customer GIDs in queries.
    const gid = `gid://shopify/Customer/SEED-${i.toString().padStart(6, "0")}`;
    pool.push({ email, gid, displayName: `${fn} ${ln}` });
  }
  return pool;
}

/** Bulk-fetches `customer { id email }` for up to 100 real Shopify
 *  order GIDs via the nodes() bulk-by-id pattern. Returns a map of
 *  gid → { email, customerId } (either field may be null when the
 *  order has no Customer record — guest checkouts). */
async function fetchRealCustomers(shopDomain, accessToken, gids) {
  const query = /* GraphQL */ `
    query CustomerInfoForOrders($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          customer {
            id
            email
          }
        }
      }
    }
  `;
  const res = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables: { ids: gids } }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Shopify GraphQL ${res.status}: ${await res.text()}`,
    );
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  const out = new Map();
  for (const node of json.data?.nodes ?? []) {
    if (!node || !node.id) continue;
    out.set(node.id, {
      email: node.customer?.email ?? null,
      customerId: node.customer?.id ?? null,
    });
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────

console.log(
  `\nBackfill customer_email + customer_shopify_id${DRY_RUN ? " (DRY RUN)" : ""}\n`,
);

// 1. Pull all orders missing customer_email. We use customer_email as
//    the join key — when it's null the row is unprocessed. (Some
//    real-Shopify orders may legitimately have no email; we re-fetch
//    those too, but they'll stay null after the fetch, which is fine.)
async function fetchOrdersNeedingBackfill() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("shopify_orders")
      .select("id, shop_id, shopify_order_id, customer_email")
      .is("customer_email", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const rows = await fetchOrdersNeedingBackfill();
console.log(`  ${rows.length} rows missing customer_email\n`);

// 2. Split into real (live Shopify orders, queryable by GID) vs
//    seeded (synthetic suffixes; not in Shopify).
const realRows = rows.filter(
  (r) => !r.shopify_order_id.includes("SEED-"),
);
const seededRows = rows.filter((r) =>
  r.shopify_order_id.includes("SEED-"),
);
console.log(`  real:   ${realRows.length}`);
console.log(`  seeded: ${seededRows.length}\n`);

// 3. Real orders: fetch from Shopify in batches of 100, group by shop.
const realUpdates = new Map(); // id -> { customer_email, customer_shopify_id }
if (realRows.length > 0) {
  // Group rows by shop_id so each batch hits the right shop session.
  const byShop = new Map();
  for (const r of realRows) {
    if (!byShop.has(r.shop_id)) byShop.set(r.shop_id, []);
    byShop.get(r.shop_id).push(r);
  }
  for (const [shopId, shopRows] of byShop.entries()) {
    const { data: shop } = await sb
      .from("shops")
      .select("shop_domain")
      .eq("id", shopId)
      .single();
    if (!shop) {
      console.warn(`  shop ${shopId} not found, skipping ${shopRows.length} rows`);
      continue;
    }
    // Decrypt offline token. The token_encryption_key_v* env var is the
    // wrapper; this script needs to call into the existing helper. We
    // import dynamically because the helper is TS.
    // Simpler: read shopify_sessions.access_token (encrypted) + use
    // lib/security/encryption.ts decryptToken via dynamic import.
    const { data: sessionRow } = await sb
      .from("shopify_sessions")
      .select("access_token, key_version")
      .eq("shop_id", shopId)
      .eq("session_type", "offline")
      .maybeSingle();
    if (!sessionRow) {
      console.warn(
        `  shop ${shopId} has no offline session, skipping ${shopRows.length} rows`,
      );
      continue;
    }
    const accessToken = decryptToken(sessionRow.access_token);

    // Batch by 100 (Shopify nodes() limit per call).
    for (let i = 0; i < shopRows.length; i += 100) {
      const batch = shopRows.slice(i, i + 100);
      const gids = batch.map((r) => r.shopify_order_id);
      console.log(
        `  → fetching ${gids.length} customer records from ${shop.shop_domain}…`,
      );
      try {
        const fetched = await fetchRealCustomers(
          shop.shop_domain,
          accessToken,
          gids,
        );
        for (const row of batch) {
          const got = fetched.get(row.shopify_order_id);
          if (!got) continue;
          realUpdates.set(row.id, {
            customer_email: got.email,
            customer_shopify_id: got.customerId,
          });
        }
      } catch (err) {
        console.warn(
          `  ! Shopify batch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
const realWithCustomer = [...realUpdates.values()].filter(
  (v) => v.customer_email || v.customer_shopify_id,
).length;
console.log(
  `\n  real orders: ${realWithCustomer}/${realRows.length} got a customer record from Shopify\n`,
);

// 4. Seeded rows: deterministic synthesis. 200 customers across ~6,238
//    orders averages ~31 orders/customer — plenty of overlap for the
//    view's per-customer aggregates to surface non-zero numbers.
const POOL_SIZE = 200;
const customerPool = buildCustomerPool(POOL_SIZE);
const seededUpdates = new Map();
for (const row of seededRows) {
  const idx = customerIndexForSeed(row.shopify_order_id, POOL_SIZE);
  const c = customerPool[idx];
  seededUpdates.set(row.id, {
    customer_email: c.email,
    customer_shopify_id: c.gid,
  });
}
console.log(
  `  seeded orders: assigned to ${POOL_SIZE} synthetic customers (avg ${
    Math.round(seededRows.length / POOL_SIZE)
  } orders/customer)\n`,
);

// 5. Write. Combine both maps. Skip rows with both fields null (real
//    Shopify guest checkouts — keep them null so the view's
//    customer-aggregates are honest about that gap).
const allUpdates = new Map([...realUpdates, ...seededUpdates]);
let toWrite = 0;
for (const v of allUpdates.values()) {
  if (v.customer_email || v.customer_shopify_id) toWrite++;
}
console.log(`  Total rows to update: ${toWrite}\n`);

if (DRY_RUN) {
  console.log("  DRY RUN — no DB writes.\n");
  process.exit(0);
}

// 6. Batched UPDATE. Supabase upsert doesn't help here (we're not
//    updating the primary key); use individual UPDATE statements,
//    batched in groups of 200 with Promise.all for throughput.
const BATCH_SIZE = 200;
const entries = [...allUpdates.entries()].filter(
  ([, v]) => v.customer_email || v.customer_shopify_id,
);
let written = 0;
for (let i = 0; i < entries.length; i += BATCH_SIZE) {
  const batch = entries.slice(i, i + BATCH_SIZE);
  await Promise.all(
    batch.map(([id, v]) =>
      sb
        .from("shopify_orders")
        .update({
          customer_email: v.customer_email,
          customer_shopify_id: v.customer_shopify_id,
        })
        .eq("id", id),
    ),
  );
  written += batch.length;
  process.stdout.write(`\r  Wrote ${written}/${entries.length}`);
}
console.log("\n\nDone.");
