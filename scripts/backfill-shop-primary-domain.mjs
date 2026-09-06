/**
 * Backfill `shops.primary_domain` (and `shops.shop_name` when missing) for
 * shops installed before the column existed.
 *
 * Going forward `persistShopCurrency` populates both on install, on embedded
 * token-exchange, and on the shop/update webhook — but every shop already
 * installed has a null column until it next triggers one of those. This walks
 * the existing rows once.
 *
 * Reads the store's real domain from `Shop.primaryDomain.url` using the
 * offline access token captured at install. Mirrors `loadSession` in
 * lib/shopify/sessionStorage.ts — do NOT invent a second decryption path.
 * Client-credentials does not work on merchant stores.
 *
 * Usage:
 *   node scripts/backfill-shop-primary-domain.mjs --env-file .env.production.local
 *   node scripts/backfill-shop-primary-domain.mjs --env-file .env.production.local --apply
 *
 * Dry-run by default: prints what it WOULD write and exits without touching
 * the database. Pass --apply to write. Re-runnable — it only considers rows
 * whose `primary_domain` is null, and a shop whose token is dead is skipped
 * with a warning rather than failing the run.
 */

import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const envFlagIdx = argv.indexOf("--env-file");
const envFile = envFlagIdx > -1 ? argv[envFlagIdx + 1] : ".env.production.local";
const apply = argv.includes("--apply");

const envRaw = readFileSync(resolve(process.cwd(), envFile), "utf8");
const readEnv = (key) => {
  const m = envRaw.match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const SUPABASE_URL = readEnv("SUPABASE_URL") || readEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(`Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in ${envFile}`);
  process.exit(1);
}

// Print which project we are about to touch — same dev/prod confusion the
// db:query guard exists to prevent, and this script bypasses that guard.
const projectRef = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "unknown";
console.log(`env-file: ${envFile}`);
console.log(`supabase project ref: ${projectRef}`);
console.log(`mode: ${apply ? "APPLY (writes)" : "dry-run (no writes)"}\n`);

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Strip scheme/path off Shopify's primaryDomain.url — mirrors lib/shopify/domainHost.ts. */
function toDomainHost(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

async function offlineToken(shopId) {
  const { data: session } = await db
    .from("shop_sessions")
    .select("access_token_encrypted")
    .eq("shop_id", shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session?.access_token_encrypted) return null;

  // v{ver}:{iv}:{tag}:{cipher} hex, AES-256-GCM.
  const parts = session.access_token_encrypted.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) return null;
  const keyVersion = parts[0].slice(1);
  const keyHex =
    readEnv(`TOKEN_ENCRYPTION_KEY_V${keyVersion}`) ||
    (keyVersion === "1" ? readEnv("TOKEN_ENCRYPTION_KEY") : null);
  if (!keyHex) return null;

  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    Buffer.from(parts[1], "hex"),
  );
  decipher.setAuthTag(Buffer.from(parts[2], "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], "hex")),
    decipher.final(),
  ]).toString("utf8");
}

const { data: shops, error } = await db
  .from("shops")
  .select("id, shop_domain, shop_name, primary_domain, uninstalled_at")
  .is("primary_domain", null)
  .order("created_at", { ascending: true });

if (error) {
  console.error("shops query failed:", error.message);
  process.exit(1);
}

console.log(`${shops.length} shop(s) with a null primary_domain\n`);

let written = 0;
let skipped = 0;

for (const shop of shops) {
  const label = shop.shop_domain;

  // Uninstalled shops have a revoked token; the call would just 401. Their
  // domain is not worth a request, and the null column reads as the alias.
  if (shop.uninstalled_at) {
    console.log(`skip  ${label} — uninstalled`);
    skipped += 1;
    continue;
  }

  const token = await offlineToken(shop.id);
  if (!token) {
    console.log(`skip  ${label} — no usable offline session`);
    skipped += 1;
    continue;
  }

  let body;
  try {
    const res = await fetch(`https://${shop.shop_domain}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: `query { shop { name primaryDomain { url } } }` }),
    });
    body = await res.json();
    if (!res.ok || body.errors) {
      console.log(`skip  ${label} — Shopify ${res.status} ${JSON.stringify(body.errors ?? "")}`);
      skipped += 1;
      continue;
    }
  } catch (err) {
    console.log(`skip  ${label} — request failed: ${err.message}`);
    skipped += 1;
    continue;
  }

  const primaryDomain = toDomainHost(body.data?.shop?.primaryDomain?.url);
  const shopName = body.data?.shop?.name?.trim() || null;
  if (!primaryDomain) {
    console.log(`skip  ${label} — Shopify returned no primary domain`);
    skipped += 1;
    continue;
  }

  const patch = { primary_domain: primaryDomain };
  // Free ride: shops predating shop_name have the same gap, and we already
  // paid for the roundtrip. Never blank a name that is already set.
  if (!shop.shop_name && shopName) patch.shop_name = shopName;

  const suffix = patch.shop_name ? ` (+ shop_name "${patch.shop_name}")` : "";
  console.log(`${apply ? "write" : "would"} ${label} -> ${primaryDomain}${suffix}`);

  if (apply) {
    const { error: updErr } = await db.from("shops").update(patch).eq("id", shop.id);
    if (updErr) {
      console.log(`  ! update failed: ${updErr.message}`);
      skipped += 1;
      continue;
    }
  }
  written += 1;
}

console.log(`\n${apply ? "written" : "would write"}: ${written}   skipped: ${skipped}`);
if (!apply && written > 0) console.log("Re-run with --apply to write.");
