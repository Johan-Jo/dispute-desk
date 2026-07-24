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

/** Retry a Supabase call through transient network blips (`fetch failed`
 *  killed a 40k-order run mid-write). Returns the resolved value or
 *  throws after `tries` attempts with exponential backoff. */
async function withRetry(fn, label, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${label} failed: ${e.message}`);
      await sleep(2 ** i * 500);
    }
  }
}

/**
 * Refresh an expiring offline token.
 *
 * Blume-box (and any shop migrated to Shopify's expiring offline tokens,
 * `shop_sessions.token_expiring = true`) holds a token that dies after
 * ~24h. A long backfill WILL outlive it — the first prod run died with
 * HTTP 401 after 7,500 orders. Mirrors the contract in
 * lib/shopify/sessions/refreshOfflineToken.ts (that module is TS and
 * can't be imported from this .mjs script).
 *
 * Persists the new token so the rest of the app benefits too, rather than
 * holding a fresher token than the DB.
 */
async function refreshOfflineToken(shopDomain, refreshToken) {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `token refresh failed ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

/**
 * Shopify REST GET with 429/5xx backoff AND 401 token refresh.
 *
 * `ctx` is mutable so a refresh mid-run updates the token for every
 * subsequent page: { token, shopDomain, shopId, refreshToken }.
 */
async function shopifyGet(url, ctx, attempt = 0) {
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": ctx.token },
  });

  // Expiring offline token died mid-run — refresh and retry.
  //
  // NOT single-shot: a full-history backfill can outlive several ~24h
  // token lifetimes (the prod run refreshed once at ~7.5k orders and then
  // died at ~33.5k when the SECOND expiry hit a one-shot guard). Bounded
  // by `refreshCount` so a genuinely revoked token can't spin forever.
  if (res.status === 401 && ctx.refreshToken && ctx.refreshCount < 10) {
    ctx.refreshCount++;
    console.log(`\n  token expired — refreshing (#${ctx.refreshCount})…`);
    const fresh = await refreshOfflineToken(ctx.shopDomain, ctx.refreshToken);
    ctx.token = fresh.access_token;
    if (fresh.refresh_token) ctx.refreshToken = fresh.refresh_token;
    await persistRefreshedToken(ctx, fresh);
    return shopifyGet(url, ctx, attempt);
  }

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`HTTP ${res.status} after retries`);
    const retryAfter = Number(res.headers.get("retry-after") ?? 2);
    await sleep(Math.max(retryAfter * 1000, 2 ** attempt * 500));
    return shopifyGet(url, ctx, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

/** Write the refreshed token back so the whole app benefits, not just
 *  this script. Encrypts with the same v1 format sessionStorage uses. */
async function persistRefreshedToken(ctx, fresh) {
  try {
    const key = getKey(1);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([
      cipher.update(Buffer.from(fresh.access_token, "utf8")),
      cipher.final(),
    ]);
    const serialized = [
      "v1",
      iv.toString("hex"),
      cipher.getAuthTag().toString("hex"),
      ct.toString("hex"),
    ].join(":");
    const patch = { access_token_encrypted: serialized };
    if (fresh.expires_in) {
      patch.expires_at = new Date(
        Date.now() + Number(fresh.expires_in) * 1000,
      ).toISOString();
    }
    await sb
      .from("shop_sessions")
      .update(patch)
      .eq("shop_id", ctx.shopId)
      .eq("session_type", "offline")
      .is("user_id", null);
    console.log("  token refreshed and persisted");
  } catch (e) {
    // Non-fatal: the in-memory token still works for this run.
    console.warn(`  ! could not persist refreshed token: ${e.message}`);
  }
}

async function backfillShop(shop) {
  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, refresh_token_encrypted, scopes")
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

  // Mutable auth context so a mid-run 401 refresh applies to later pages.
  const ctx = {
    token: decryptToken(session.access_token_encrypted),
    shopDomain: shop.shop_domain,
    shopId: shop.id,
    refreshToken: session.refresh_token_encrypted
      ? decryptToken(session.refresh_token_encrypted)
      : null,
    refreshCount: 0,
  };
  const since = new Date(Date.now() - SINCE_DAYS * 86400_000).toISOString();

  let url =
    `https://${shop.shop_domain}/admin/api/${API_VERSION}/orders.json` +
    `?status=any&limit=${PAGE_SIZE}&order=created_at+desc` +
    `&created_at_min=${encodeURIComponent(since)}` +
    `&fields=id,created_at,client_details`;

  const stats = { scanned: 0, updated: 0, empty: 0, skipped: 0, noRow: 0 };

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await shopifyGet(url, ctx);
    const orders = (await res.json()).orders ?? [];
    if (orders.length === 0) break;

    // Which of these already have client_details fetched? (idempotency)
    const gids = orders.map((o) => `gid://shopify/Order/${o.id}`);
    let alreadyFetched = new Set();
    if (!REFETCH) {
      const { data: existing } = await withRetry(
        () =>
          sb
            .from("shopify_order_risk_signals")
            .select("shopify_order_id")
            .eq("shop_id", shop.id)
            .in("shopify_order_id", gids)
            .not("client_details_fetched_at", "is", null),
        "idempotency check",
      );
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

    // UPDATE-only, never INSERT.
    //
    // An upsert here would be actively destructive: on conflict Postgres
    // updates EVERY supplied column, and `parser_version` is NOT NULL with
    // no default — so supplying it would overwrite the real risk-parser
    // version (v1) on the ~355k existing rows, silently erasing parser
    // state; omitting it makes the INSERT path fail outright (which is how
    // this was caught). The risk-signal row is owned by the risk parser
    // (lib/fraudIntel/signalWriter.ts); this backfill only decorates rows
    // that already exist with client_details. Orders with no row yet are
    // counted as `noRow` and left alone for the parser to create.
    if (rows.length > 0 && !DRY_RUN) {
      for (const row of rows) {
        const { shop_id, shopify_order_id, ...patch } = row;
        const { data, error } = await withRetry(
          () =>
            sb
              .from("shopify_order_risk_signals")
              .update(patch)
              .eq("shop_id", shop_id)
              .eq("shopify_order_id", shopify_order_id)
              .select("id"),
          "update",
        );
        if (error) throw new Error(`update failed: ${error.message}`);
        if (!data || data.length === 0) stats.noRow++;
      }
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

  const totals = { scanned: 0, updated: 0, empty: 0, skipped: 0, noRow: 0 };
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
  console.log(`  no row:   ${totals.noRow}  (no risk-signal row yet — left for the risk parser)`);
  if (DRY_RUN) console.log("\n(dry run — nothing written)");
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e.message);
  process.exit(1);
});
