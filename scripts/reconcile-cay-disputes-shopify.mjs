/**
 * Reconcile cay-collective disputes: Shopify Admin API (source of truth) vs our DB.
 *
 * Purpose: prove/disprove that cay-collective's disputes are 100% Klarna by asking
 * Shopify directly for the FULL dispute list (not just what we synced), and reading
 * the card/network fields that reveal whether any dispute went through the card rails.
 *
 * - GraphQL `disputes` (root query, needs read_shopify_payments_disputes) → authoritative
 *   full count + type/reason/order per dispute, paginated to the end.
 * - REST `/shopify_payments/disputes/{id}.json` → exposes `network_reason_code`, which the
 *   GraphQL schema omits. A card (Visa/MC) dispute ALWAYS carries a network_reason_code;
 *   a Klarna dispute does not. This is the discriminator.
 * - Reconciles the Shopify-side total against our stored disputes for the shop.
 *
 * Read-only. Loads cay-collective's stored OFFLINE token from prod and decrypts it locally.
 *
 * Usage: node scripts/reconcile-cay-disputes-shopify.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "c497df8d-632d-49da-b385-eb523f57f341"; // cay-collective.myshopify.com (prod)
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

// --- token decryption (mirrors lib/security/encryption.ts) ---
function getKey(version) {
  let hex = process.env[`TOKEN_ENCRYPTION_KEY_V${version}`];
  if (!hex && version === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`Missing encryption key env var: TOKEN_ENCRYPTION_KEY_V${version}`);
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error(`Key V${version} must be 32 bytes, got ${buf.length}`);
  return buf;
}
function decryptToken(raw) {
  const parts = raw.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) throw new Error("Bad encrypted payload format");
  const version = parseInt(parts[0].slice(1), 10);
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const ciphertext = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv("aes-256-gcm", getKey(version), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const DISPUTE_LIST_QUERY = `
  query DisputeList($first: Int!, $after: String) {
    disputes(first: $first, after: $after) {
      edges {
        node {
          id
          type
          status
          reasonDetails { reason }
          amount { amount currencyCode }
          initiatedAt
          order { id legacyResourceId name }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

async function gql(shopDomain, token, query, variables) {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GraphQL ${res.status}: ${JSON.stringify(json.errors || json).slice(0, 500)}`);
  }
  return json.data;
}

async function restGet(shopDomain, token, path) {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}${path}`, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`REST ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  // 1) Load + decrypt cay-collective's offline token.
  const { data: sessionRow, error: sErr } = await sb
    .from("shop_sessions")
    .select("shop_domain, access_token_encrypted, scopes")
    .eq("shop_id", SHOP_ID)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sErr || !sessionRow) {
    console.error("No offline session for cay-collective:", sErr?.message);
    process.exit(1);
  }
  const shopDomain = sessionRow.shop_domain;
  const token = decryptToken(sessionRow.access_token_encrypted);
  console.log(`Shop: ${shopDomain}`);
  console.log(`Scopes include read_shopify_payments_disputes: ${sessionRow.scopes?.includes("read_shopify_payments_disputes")}`);
  console.log("---");

  // 2) Paginate the FULL GraphQL dispute list.
  const all = [];
  let after = null;
  let page = 0;
  for (;;) {
    const data = await gql(shopDomain, token, DISPUTE_LIST_QUERY, { first: 100, after });
    const conn = data.disputes;
    for (const e of conn.edges) all.push(e.node);
    page++;
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.edges[conn.edges.length - 1].cursor;
    if (page > 50) { console.warn("Stopped at 50 pages (safety)."); break; }
  }
  console.log(`Shopify GraphQL returned ${all.length} disputes across ${page} page(s).`);

  // 3) Bucket by type/reason (GraphQL-side).
  const byType = {};
  const byReason = {};
  for (const d of all) {
    byType[d.type || "(null)"] = (byType[d.type || "(null)"] || 0) + 1;
    const r = d.reasonDetails?.reason || "(null)";
    byReason[r] = (byReason[r] || 0) + 1;
  }
  console.log("By type:", byType);
  console.log("By reason:", byReason);
  console.log("---");

  // 4) REST per-dispute: read network_reason_code (the card discriminator).
  //    Card disputes carry a network_reason_code; Klarna disputes do not.
  let withNetworkCode = 0;
  const networkCodeSamples = [];
  let restErrors = 0;
  for (const d of all) {
    const legacyId = d.id.split("/").pop();
    try {
      const j = await restGet(shopDomain, token, `/shopify_payments/disputes/${legacyId}.json`);
      const disp = j.dispute || j;
      const nrc = disp.network_reason_code ?? null;
      if (nrc) {
        withNetworkCode++;
        if (networkCodeSamples.length < 10)
          networkCodeSamples.push({ id: legacyId, order: d.order?.name, nrc, type: d.type, reason: d.reasonDetails?.reason });
      }
    } catch (e) {
      restErrors++;
      if (restErrors <= 3) console.warn(`  REST fetch failed for ${legacyId}: ${e.message}`);
    }
  }
  console.log(`Disputes WITH a network_reason_code (card fingerprint): ${withNetworkCode} / ${all.length}`);
  if (networkCodeSamples.length) console.log("  samples:", networkCodeSamples);
  if (restErrors) console.log(`  (${restErrors} REST lookups failed — network_reason_code endpoint may be gated)`);
  console.log("---");

  // 5) Reconcile against our DB.
  const { count: dbCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", SHOP_ID);
  console.log(`Our DB stored disputes for cay-collective: ${dbCount}`);
  console.log(`Shopify-side disputes: ${all.length}`);
  const delta = all.length - (dbCount ?? 0);
  console.log(delta === 0
    ? "RECONCILED: Shopify count == DB count. We synced every dispute."
    : `DELTA: Shopify has ${delta} dispute(s) we did NOT sync — investigate these.`);

  // 6) If there's a delta, list the unsynced ones so we can see their channel.
  if (delta !== 0) {
    const { data: dbGids } = await sb.from("disputes").select("dispute_gid").eq("shop_id", SHOP_ID);
    const known = new Set((dbGids || []).map((r) => r.dispute_gid));
    const missing = all.filter((d) => !known.has(d.id));
    console.log(`Unsynced dispute nodes (${missing.length}):`);
    for (const d of missing.slice(0, 25))
      console.log(`  ${d.id} type=${d.type} reason=${d.reasonDetails?.reason} order=${d.order?.name} at=${d.initiatedAt}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
