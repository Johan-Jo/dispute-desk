#!/usr/bin/env node
/**
 * Backfill `Order.client_details` (browser_ip + user_agent) into
 * shopify_order_risk_signals for Visa Compelling Evidence 3.0 matching.
 *
 * WHY: CE3.0 (Visa 10.4 remedy) needs 2+ prior undisputed transactions in a
 * 120-365 day window sharing >=2 data elements with the disputed order, at
 * least one being IP or device ID. We had client_ip at 73% and no device
 * element at all. `client_details` is read-only ORDER data, so it is
 * retrievable historically with `read_all_orders` (which this app holds).
 *
 * Measured coverage (prod, 1,000 most-recent blume-box orders):
 *   browser_ip 76.0% · user_agent 75.3% · session_hash 0.0% (dead field)
 * Orders not placed via online checkout (POS/API/draft) legitimately have
 * no client_details — those are recorded as fetched-but-empty so a re-run
 * doesn't keep retrying them.
 *
 * SAFETY
 *   - Read-only against Shopify; writes ONLY the three client_details
 *     columns on shopify_order_risk_signals (never touches parsed risk
 *     fields, orders, or disputes).
 *   - Idempotent: skips orders already fetched unless --refetch.
 *   - Resumable: processes newest-first in pages; re-run continues.
 *   - Rate-limited: respects Shopify's 2 req/s REST bucket with backoff.
 *   - --dry-run prints what it would write and exits.
 *
 * CE3.0 only cares about priors <365 days old, and coverage on old orders
 * collapses (8.9% in 2018), so --since defaults to 400 days back rather
 * than walking all history for nothing.
 *
 * Usage:
 *   node scripts/backfill-order-client-details.mjs --shop blume-box.myshopify.com [--dry-run] [--since-days 400] [--max-pages 50] [--refetch]
 *   node scripts/backfill-order-client-details.mjs --all-shops
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

loadEnv({ path: resolve(process.cwd(), ".env.production.local"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const val = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const DRY_RUN = flag("dry-run");
const REFETCH = flag("refetch");
const ALL_SHOPS = flag("all-shops");
const SHOP_DOMAIN = val("shop", null);
const SINCE_DAYS = Number(val("since-days", 400));
const MAX_PAGES = Number(val("max-pages", 50));
const API_VERSION = "2026-01";
const PAGE_SIZE = 250;

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!SHOP_DOMAIN && !ALL_SHOPS) {
  console.error("Specify --shop <domain> or --all-shops");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

/* ── token decryption (mirrors lib/security/encryption.ts) ── */
function getKey(version) {
  let hex = process.env[`TOKEN_ENCRYPTION_KEY_V${version}`];
  if (!hex && version === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`Missing TOKEN_ENCRYPTION_KEY_V${version}`);
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error("key must be 32 bytes (64 hex chars)");
  return buf;
}
function decryptToken(raw) {
  const parts = raw.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Invalid encrypted payload format");
  }
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(parseInt(parts[0].slice(1), 10)),
    Buffer.from(parts[1], "hex"),
  );
  d.setAuthTag(Buffer.from(parts[2], "hex"));
  return Buffer.concat([
    d.update(Buffer.from(parts[3], "hex")),
    d.final(),
  ]).toString("utf8");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shopify REST GET with 429/5xx backoff. */
async function shopifyGet(url, token, attempt = 0) {
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`HTTP ${res.status} after retries`);
    const retryAfter = Number(res.headers.get("retry-after") ?? 2);
    await sleep(Math.max(retryAfter * 1000, 2 ** attempt * 500));
    return shopifyGet(url, token, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

async function backfillShop(shop) {
  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, scopes")
    .eq("shop_id", shop.id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) {
    console.log(`  ! no offline session — skipping ${shop.shop_domain}`);
    return { scanned: 0, updated: 0, empty: 0 };
  }
  if (!(session.scopes ?? "").includes("read_all_orders")) {
    console.log(
      `  ! ${shop.shop_domain} lacks read_all_orders — only last 60d reachable`,
    );
  }

  const token = decryptToken(session.access_token_encrypted);
  const since = new Date(Date.now() - SINCE_DAYS * 86400_000).toISOString();

  let url =
    `https://${shop.shop_domain}/admin/api/${API_VERSION}/orders.json` +
    `?status=any&limit=${PAGE_SIZE}&order=created_at+desc` +
    `&created_at_min=${encodeURIComponent(since)}` +
    `&fields=id,created_at,client_details`;

  const stats = { scanned: 0, updated: 0, empty: 0, skipped: 0 };

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await shopifyGet(url, token);
    const orders = (await res.json()).orders ?? [];
    if (orders.length === 0) break;

    // Which of these already have client_details fetched? (idempotency)
    const gids = orders.map((o) => `gid://shopify/Order/${o.id}`);
    let alreadyFetched = new Set();
    if (!REFETCH) {
      const { data: existing } = await sb
        .from("shopify_order_risk_signals")
        .select("shopify_order_id")
        .eq("shop_id", shop.id)
        .in("shopify_order_id", gids)
        .not("client_details_fetched_at", "is", null);
      alreadyFetched = new Set((existing ?? []).map((r) => r.shopify_order_id));
    }

    const rows = [];
    const now = new Date().toISOString();
    for (const o of orders) {
      stats.scanned++;
      const gid = `gid://shopify/Order/${o.id}`;
      if (alreadyFetched.has(gid)) {
        stats.skipped++;
        continue;
      }
      const cd = o.client_details ?? {};
      const ip = cd.browser_ip || null;
      const ua = cd.user_agent || null;
      if (!ip && !ua) stats.empty++;
      else stats.updated++;
      rows.push({
        shop_id: shop.id,
        shopify_order_id: gid,
        // Only set client_ip when we actually have one — never null out an
        // existing value recovered from the GraphQL risk projection.
        ...(ip ? { client_ip: ip } : {}),
        user_agent: ua,
        client_details_source: "rest_backfill",
        client_details_fetched_at: now,
      });
    }

    if (rows.length > 0 && !DRY_RUN) {
      const { error } = await sb
        .from("shopify_order_risk_signals")
        .upsert(rows, { onConflict: "shop_id,shopify_order_id" });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    }

    process.stdout.write(
      `  page ${page + 1}: scanned=${stats.scanned} updated=${stats.updated} empty=${stats.empty} skipped=${stats.skipped}\r`,
    );

    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    await sleep(600); // stay under the 2 req/s REST bucket
  }

  console.log("");
  return stats;
}

async function main() {
  console.log(
    `CE3.0 client_details backfill${DRY_RUN ? " (DRY RUN — no writes)" : ""}`,
  );
  console.log(`  window: last ${SINCE_DAYS} days · max ${MAX_PAGES} pages/shop`);
  console.log("");

  let shops;
  if (ALL_SHOPS) {
    const { data } = await sb.from("shops").select("id, shop_domain");
    shops = data ?? [];
  } else {
    const { data } = await sb
      .from("shops")
      .select("id, shop_domain")
      .eq("shop_domain", SHOP_DOMAIN)
      .maybeSingle();
    if (!data) throw new Error(`Shop not found: ${SHOP_DOMAIN}`);
    shops = [data];
  }

  const totals = { scanned: 0, updated: 0, empty: 0, skipped: 0 };
  for (const shop of shops) {
    console.log(`${shop.shop_domain}:`);
    const s = await backfillShop(shop);
    for (const k of Object.keys(totals)) totals[k] += s[k] ?? 0;
  }

  console.log("");
  console.log("TOTALS");
  console.log(`  scanned:  ${totals.scanned}`);
  console.log(`  updated:  ${totals.updated}  (had ip and/or user_agent)`);
  console.log(`  empty:    ${totals.empty}  (no client_details — POS/API/draft)`);
  console.log(`  skipped:  ${totals.skipped}  (already fetched)`);
  if (DRY_RUN) console.log("\n(dry run — nothing written)");
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e.message);
  process.exit(1);
});
