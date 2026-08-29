/**
 * Read a merchant store's REAL name from the Shopify Admin API, using the
 * offline access token captured at install.
 *
 * The `shops` table stores only `shop_domain` (the myshopify subdomain, e.g.
 * `6a8848-dd`), which is NOT the merchant-facing store name. The name lives
 * only in Shopify, so it must be fetched live.
 *
 * Mirrors `loadSession` in lib/shopify/sessionStorage.ts — do not invent a
 * second decryption path. Client-credentials does NOT work on merchant
 * stores; the offline token is the only route.
 *
 * Usage:
 *   node scripts/shopify/shop-name.mjs <shopDomain> [--env-file .env.production.local]
 */

import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const shopDomain = process.argv[2];
const envFlagIdx = process.argv.indexOf("--env-file");
const envFile = envFlagIdx > -1 ? process.argv[envFlagIdx + 1] : ".env.production.local";

if (!shopDomain) {
  console.error("Usage: node scripts/shopify/shop-name.mjs <shopDomain> [--env-file <path>]");
  process.exit(1);
}

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

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: shop, error: shopErr } = await db
  .from("shops")
  .select("id, shop_domain")
  .eq("shop_domain", shopDomain)
  .single();
if (shopErr || !shop) {
  console.error(`Shop ${shopDomain} not found:`, shopErr?.message);
  process.exit(1);
}

// Newest offline session, matching loadSession's ordering.
const { data: session, error: sessErr } = await db
  .from("shop_sessions")
  .select("access_token_encrypted, created_at")
  .eq("shop_id", shop.id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
if (sessErr || !session) {
  console.error("No offline session:", sessErr?.message);
  process.exit(1);
}

// v{ver}:{iv}:{tag}:{cipher} hex, AES-256-GCM.
const parts = session.access_token_encrypted.split(":");
if (parts.length !== 4 || !parts[0].startsWith("v")) {
  console.error("Unexpected token format");
  process.exit(1);
}
const keyVersion = parts[0].slice(1);
const keyHex =
  readEnv(`TOKEN_ENCRYPTION_KEY_V${keyVersion}`) ||
  (keyVersion === "1" ? readEnv("TOKEN_ENCRYPTION_KEY") : null);
if (!keyHex) {
  console.error(`Missing TOKEN_ENCRYPTION_KEY_V${keyVersion} in ${envFile}`);
  process.exit(1);
}

const decipher = createDecipheriv(
  "aes-256-gcm",
  Buffer.from(keyHex, "hex"),
  Buffer.from(parts[1], "hex"),
);
decipher.setAuthTag(Buffer.from(parts[2], "hex"));
const accessToken = Buffer.concat([
  decipher.update(Buffer.from(parts[3], "hex")),
  decipher.final(),
]).toString("utf8");

const res = await fetch(`https://${shopDomain}/admin/api/2026-01/graphql.json`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  },
  body: JSON.stringify({
    query: `query { shop { name email contactEmail myshopifyDomain primaryDomain { url } } }`,
  }),
});

const body = await res.json();
if (!res.ok || body.errors) {
  console.error("Shopify error:", res.status, JSON.stringify(body.errors ?? body));
  process.exit(1);
}
console.log(JSON.stringify(body.data.shop, null, 2));
