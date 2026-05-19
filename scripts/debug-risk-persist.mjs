#!/usr/bin/env node
/**
 * Simulates buildPack's risk-assessment persist path against a live
 * dispute. Fetches the order with the NEW ORDER_DETAIL_QUERY (incl.
 * the `risk { ... }` selection from commit 27bdea5), prints the raw
 * risk node, and tries the existence check + insert. Useful when
 * regenerate appears to skip the persist for non-obvious reasons.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "node:crypto";

const DISPUTE_ID = process.argv[2];
if (!DISPUTE_ID) {
  console.error("Usage: node scripts/debug-risk-persist.mjs <dispute_id>");
  process.exit(2);
}

function decrypt(serialized) {
  const parts = serialized.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Invalid encrypted payload format");
  }
  const version = parseInt(parts[0].slice(1), 10);
  const keyHex = process.env[`TOKEN_ENCRYPTION_KEY_V${version}`];
  if (!keyHex) throw new Error(`TOKEN_ENCRYPTION_KEY_V${version} missing`);
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const cipher = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipher), decipher.final()]).toString(
    "utf8",
  );
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: dispute } = await sb
  .from("disputes")
  .select("id, shop_id, order_gid")
  .eq("id", DISPUTE_ID)
  .single();

const { data: shop } = await sb
  .from("shops")
  .select("shop_domain")
  .eq("id", dispute.shop_id)
  .single();

const { data: session } = await sb
  .from("shop_sessions")
  .select("access_token_encrypted")
  .eq("shop_id", dispute.shop_id)
  .is("expires_at", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .single();

const accessToken = decrypt(session.access_token_encrypted);

// The EXACT new ORDER_DETAIL_QUERY risk block.
const query = `
  query OrderRisk($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        createdAt
        risk {
          recommendation
          assessments {
            riskLevel
            provider { title }
            facts {
              description
              sentiment
            }
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
    body: JSON.stringify({ query, variables: { id: dispute.order_gid } }),
  },
);
const json = await resp.json();

if (json.errors) {
  console.log("=== Shopify ERRORS ===");
  console.log(JSON.stringify(json.errors, null, 2));
}

const order = json.data?.node;
if (!order) {
  console.log("=== order is null ===");
  process.exit(1);
}

console.log("=== order.risk ===");
console.log(JSON.stringify(order.risk, null, 2));

const risk = order.risk;
if (!risk) {
  console.log("[verdict] order.risk is falsy — buildPack would skip persist.");
  process.exit(0);
}

const assessments = risk.assessments ?? [];
console.log(`\n=== assessments count: ${assessments.length} ===`);

const pick = assessments.find(
  (a) => a.riskLevel != null || (a.facts?.length ?? 0) > 0,
);
if (!pick) {
  console.log("[verdict] no assessment with riskLevel || facts — skip.");
  process.exit(0);
}
console.log("\n=== picked assessment ===");
console.log(JSON.stringify(pick, null, 2));

const provider = pick.provider?.title?.trim() || "shopify";
console.log(`\nprovider: ${provider}`);
console.log(`riskLevel: ${pick.riskLevel}`);
console.log(`facts: ${pick.facts?.length ?? 0}`);

// Existence check (mirrors helper)
const { data: existing } = await sb
  .from("shopify_order_risk_assessments")
  .select("id")
  .eq("shop_id", dispute.shop_id)
  .eq("shopify_order_id", dispute.order_gid)
  .eq("provider", provider)
  .limit(1);

if (existing && existing.length > 0) {
  console.log(
    `\n[verdict] row already exists (id=${existing[0].id}) — helper would skip.`,
  );
  process.exit(0);
}

console.log("\n[verdict] would insert a new row. Inserting now…");
const row = {
  shop_id: dispute.shop_id,
  shopify_order_id: dispute.order_gid,
  provider,
  risk_level: pick.riskLevel ?? null,
  recommendation: risk.recommendation ?? null,
  facts_json: pick.facts ?? null,
  assessed_at: order.createdAt,
};
const { data: inserted, error } = await sb
  .from("shopify_order_risk_assessments")
  .insert(row)
  .select("id")
  .single();
if (error) {
  console.error(`\n[ERROR] insert failed: ${error.message}`);
  process.exit(1);
}
console.log(`\n[OK] inserted row id=${inserted.id}`);
