#!/usr/bin/env node
/**
 * CE3.0 feasibility spike — READ ONLY.
 *
 * Samples Shopify's REST `Order.client_details` on HISTORICAL orders to
 * answer: can we backfill the data Visa's Compelling Evidence 3.0 remedy
 * needs (2+ prior undisputed transactions in a 120-365 day window sharing
 * >=2 data elements, at least one being IP address or device ID)?
 *
 * Reports:
 *   - % of sampled orders with browser_ip
 *   - % with session_hash and/or user_agent (the device-ish identifiers)
 *   - how order age affects coverage (are OLD orders missing it?)
 *
 * Writes nothing. Makes no mutations. Uses the offline token already
 * stored for the shop (requires read_all_orders for >60d history, which
 * this app holds).
 *
 * Usage:
 *   node scripts/ce3-client-details-spike.mjs blume-box.myshopify.com [pages]
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

loadEnv({ path: resolve(process.cwd(), ".env.production.local"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const SHOP_DOMAIN = process.argv[2] ?? "blume-box.myshopify.com";
const PAGES = Number(process.argv[3] ?? 3); // 250 orders/page
const API_VERSION = "2026-01";

// ── AES-256-GCM decrypt (mirrors lib/security/encryption.ts exactly) ──
// Serialized form: `v{keyVersion}:{iv}:{tag}:{ciphertext}`, all hex.
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
  const keyVersion = parseInt(parts[0].slice(1), 10);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(keyVersion),
    Buffer.from(parts[1], "hex"),
  );
  decipher.setAuthTag(Buffer.from(parts[2], "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], "hex")),
    decipher.final(),
  ]).toString("utf8");
}

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { data: shop } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("shop_domain", SHOP_DOMAIN)
    .maybeSingle();
  if (!shop) throw new Error(`Shop not found: ${SHOP_DOMAIN}`);

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, scopes")
    .eq("shop_id", shop.id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) throw new Error("No offline session for shop");

  const token = decryptToken(session.access_token_encrypted);
  const hasReadAll = (session.scopes ?? "").includes("read_all_orders");
  console.log(`Shop: ${SHOP_DOMAIN}`);
  console.log(`read_all_orders granted: ${hasReadAll}`);
  console.log("");

  // REST: client_details is REST-only (not exposed on the GraphQL Order).
  let url =
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/orders.json` +
    `?status=any&limit=250&order=created_at+desc` +
    `&fields=id,created_at,client_details,customer`;

  const stats = {
    total: 0,
    withClientDetails: 0,
    withBrowserIp: 0,
    withSessionHash: 0,
    withUserAgent: 0,
    withAnyDeviceId: 0,
    byYear: {},
  };

  for (let page = 0; page < PAGES && url; page++) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      break;
    }
    const body = await res.json();
    const orders = body.orders ?? [];
    if (orders.length === 0) break;

    for (const o of orders) {
      stats.total++;
      const cd = o.client_details ?? null;
      const year = (o.created_at ?? "").slice(0, 4);
      stats.byYear[year] ??= { n: 0, ip: 0, device: 0 };
      stats.byYear[year].n++;
      if (cd && Object.keys(cd).length > 0) stats.withClientDetails++;
      if (cd?.browser_ip) {
        stats.withBrowserIp++;
        stats.byYear[year].ip++;
      }
      if (cd?.session_hash) stats.withSessionHash++;
      if (cd?.user_agent) stats.withUserAgent++;
      if (cd?.session_hash || cd?.user_agent) {
        stats.withAnyDeviceId++;
        stats.byYear[year].device++;
      }
    }

    // Cursor pagination via Link header.
    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    process.stdout.write(`  page ${page + 1}: ${stats.total} orders scanned\r`);
  }

  const pct = (n) => (stats.total ? ((n / stats.total) * 100).toFixed(1) : "0.0");
  console.log("\n");
  console.log(`Sampled orders:        ${stats.total}`);
  console.log(`  client_details set:  ${stats.withClientDetails} (${pct(stats.withClientDetails)}%)`);
  console.log(`  browser_ip:          ${stats.withBrowserIp} (${pct(stats.withBrowserIp)}%)`);
  console.log(`  session_hash:        ${stats.withSessionHash} (${pct(stats.withSessionHash)}%)`);
  console.log(`  user_agent:          ${stats.withUserAgent} (${pct(stats.withUserAgent)}%)`);
  console.log(`  ANY device id:       ${stats.withAnyDeviceId} (${pct(stats.withAnyDeviceId)}%)`);
  console.log("");
  console.log("By order year (n / ip% / device%):");
  for (const y of Object.keys(stats.byYear).sort()) {
    const b = stats.byYear[y];
    console.log(
      `  ${y}: n=${String(b.n).padStart(4)}  ip=${((b.ip / b.n) * 100).toFixed(0).padStart(3)}%  device=${((b.device / b.n) * 100).toFixed(0).padStart(3)}%`,
    );
  }
}

main().catch((e) => {
  console.error("SPIKE FAILED:", e.message);
  process.exit(1);
});
