#!/usr/bin/env node
/**
 * One-shot: fetch a single Shopify order's risk assessment to confirm
 * what Shopify actually has on file. Used to validate the ingestion
 * gap fix (commit 27bdea5) before merchant-facing copy depends on
 * "we have no data" claims.
 *
 * Usage:
 *   node scripts/check-order-risk.mjs <dispute_id>
 *
 * Reads the dispute's order_gid + shop_id from Supabase, decrypts
 * the offline session token, hits Admin GraphQL, prints the raw risk
 * assessment.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "node:crypto";

const DISPUTE_ID = process.argv[2];
if (!DISPUTE_ID) {
  console.error("Usage: node scripts/check-order-risk.mjs <dispute_id>");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(3);
}

/**
 * Mirrors lib/security/encryption.ts decrypt() — picks the key from
 * TOKEN_ENCRYPTION_KEY_V{n} based on the version prefix in the stored
 * payload (format: v{n}:{iv}:{tag}:{ciphertext}).
 */
function decrypt(serialized) {
  const parts = serialized.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Invalid encrypted payload format");
  }
  const version = parseInt(parts[0].slice(1), 10);
  const ivHex = parts[1];
  const tagHex = parts[2];
  const cipherHex = parts[3];
  const keyHex = process.env[`TOKEN_ENCRYPTION_KEY_V${version}`];
  if (!keyHex) {
    throw new Error(`TOKEN_ENCRYPTION_KEY_V${version} missing from env`);
  }
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const cipher = Buffer.from(cipherHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
  return plain.toString("utf8");
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: dispute, error: dErr } = await sb
  .from("disputes")
  .select("id, shop_id, order_gid")
  .eq("id", DISPUTE_ID)
  .single();

if (dErr || !dispute) {
  console.error("Dispute lookup failed:", dErr?.message);
  process.exit(2);
}
if (!dispute.order_gid) {
  console.error("Dispute has no order_gid");
  process.exit(2);
}

const { data: shop, error: sErr } = await sb
  .from("shops")
  .select("shop_domain")
  .eq("id", dispute.shop_id)
  .single();

if (sErr || !shop) {
  console.error("Shop lookup failed:", sErr?.message);
  process.exit(2);
}

const { data: session, error: tErr } = await sb
  .from("shop_sessions")
  .select("access_token_encrypted")
  .eq("shop_id", dispute.shop_id)
  .is("expires_at", null) // offline session
  .order("created_at", { ascending: false })
  .limit(1)
  .single();

if (tErr || !session) {
  console.error("Session lookup failed:", tErr?.message);
  process.exit(2);
}

const accessToken = decrypt(session.access_token_encrypted);

const query = `
  query OrderRisk($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        name
        createdAt
        risk {
          recommendation
          assessments {
            riskLevel
            provider { title }
            facts { description sentiment }
          }
        }
      }
    }
  }
`;

const resp = await fetch(
  `https://${shop.shop_domain}/admin/api/2026-01/graphql.json`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query,
      variables: { id: dispute.order_gid },
    }),
  },
);

const json = await resp.json();
if (json.errors) {
  console.error("Shopify returned errors:");
  console.error(JSON.stringify(json.errors, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(json.data?.node ?? null, null, 2));
