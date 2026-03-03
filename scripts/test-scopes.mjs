#!/usr/bin/env node
/**
 * Scope & functional test script.
 *
 * Loads an offline session from Supabase, decrypts the token,
 * then runs 4 checks:
 *   1. List granted scopes (GET /admin/oauth/access_scopes.json)
 *   2. Fetch/list disputes (shopifyPaymentsAccount.disputes)
 *   3. Read dispute evidence detail (node query)
 *   4. Save dispute evidence (disputeEvidenceUpdate – dry-run with empty input)
 *
 * Usage:
 *   node scripts/test-scopes.mjs [--shop <domain>]
 *
 * If --shop is omitted, picks the first offline session found.
 */

import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENC_KEY_V1 = process.env.TOKEN_ENCRYPTION_KEY_V1;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!ENC_KEY_V1) {
  console.error("Missing TOKEN_ENCRYPTION_KEY_V1");
  process.exit(1);
}

const args = process.argv.slice(2);
const shopIdx = args.indexOf("--shop");
const shopFilter = shopIdx !== -1 ? args[shopIdx + 1] : null;

function decryptToken(raw) {
  const parts = raw.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) throw new Error("Bad token format");
  const keyVersion = parseInt(parts[0].slice(1), 10);
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const ciphertext = Buffer.from(parts[3], "hex");
  const envKey = keyVersion === 1 ? ENC_KEY_V1 : null;
  if (!envKey) throw new Error(`No key for version ${keyVersion}`);
  const key = Buffer.from(envKey, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function gql(shop, token, query, variables) {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: await res.json() };
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let query = db
  .from("shop_sessions")
  .select("*, shops!inner(shop_domain)")
  .eq("session_type", "offline")
  .is("user_id", null);

if (shopFilter) {
  query = query.eq("shops.shop_domain", shopFilter);
}

const { data: sessions, error } = await query.order("created_at", { ascending: false }).limit(1);

if (error || !sessions?.length) {
  console.error("No offline session found.", error?.message);
  process.exit(1);
}

const session = sessions[0];
const shopDomain = session.shops?.shop_domain ?? session.shop_domain;
const token = decryptToken(session.access_token_encrypted);

console.log(`\n=== Scope & Functional Tests ===`);
console.log(`Shop: ${shopDomain}`);
console.log(`Session scopes (stored): ${session.scopes}`);
console.log(`API version: ${API_VERSION}\n`);

// ── Test 1: List granted scopes ─────────────────────────
console.log(`── Test 1: Granted Scopes ──`);
try {
  const res = await fetch(
    `https://${shopDomain}/admin/oauth/access_scopes.json`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  const body = await res.json();
  if (res.ok && body.access_scopes) {
    const handles = body.access_scopes.map((s) => s.handle);
    console.log(`Status: ${res.status} OK`);
    console.log(`Granted scopes (${handles.length}):`);
    handles.forEach((h) => console.log(`  - ${h}`));
    const important = [
      "read_shopify_payments_disputes",
      "read_shopify_payments_dispute_evidences",
      "write_shopify_payments_dispute_evidences",
    ];
    console.log(`\nKey scope check:`);
    important.forEach((s) =>
      console.log(`  ${handles.includes(s) ? "✅" : "❌"} ${s}`)
    );
  } else {
    console.log(`Status: ${res.status}`);
    console.log(JSON.stringify(body, null, 2));
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
}

// ── Test 2: List disputes ───────────────────────────────
console.log(`\n── Test 2: List Disputes (root query, read_shopify_payments_disputes) ──`);
try {
  const { status, body } = await gql(shopDomain, token, `{
    disputes(first: 3) {
      edges { node { id status initiatedAt amount { amount currencyCode } disputeEvidence { id } } }
      pageInfo { hasNextPage }
    }
  }`);
  if (body.errors) {
    console.log(`Status: ${status} — ERRORS:`);
    body.errors.forEach((e) => console.log(`  ${e.message}`));
  } else {
    const disputes = body.data?.disputes?.edges ?? [];
    console.log(`Status: ${status} OK — ${disputes.length} dispute(s) returned`);
    disputes.forEach((d) =>
      console.log(`  ${d.node.id} | ${d.node.status} | ${d.node.amount?.amount} ${d.node.amount?.currencyCode} | evidence: ${d.node.disputeEvidence?.id ?? "none"}`)
    );
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
}

// ── Test 3: Read dispute evidence ───────────────────────
console.log(`\n── Test 3: Read Dispute Evidence (read_shopify_payments_dispute_evidences) ──`);
try {
  const listRes = await gql(shopDomain, token, `{
    disputes(first: 1) {
      edges { node { id disputeEvidence { id accessActivityLog customerEmailAddress } } }
    }
  }`);
  const firstDispute = listRes.body.data?.disputes?.edges?.[0]?.node;
  if (!firstDispute) {
    console.log("SKIP — no disputes in store to test evidence read");
  } else if (!firstDispute.disputeEvidence?.id) {
    console.log(`Dispute ${firstDispute.id} has no evidence record — cannot test read`);
  } else {
    const evidenceGid = firstDispute.disputeEvidence.id;
    console.log(`Testing with evidence GID: ${evidenceGid}`);
    const { status, body } = await gql(shopDomain, token, `
      query ReadEvidence($id: ID!) {
        node(id: $id) {
          ... on ShopifyPaymentsDisputeEvidence {
            id
            accessActivityLog
            customerEmailAddress
            refundPolicyDisclosure
            shippingDocumentation
            uncategorizedText
          }
        }
      }
    `, { id: evidenceGid });
    if (body.errors) {
      console.log(`Status: ${status} — ERRORS:`);
      body.errors.forEach((e) => console.log(`  ${e.message}`));
    } else {
      console.log(`Status: ${status} OK`);
      console.log(`Evidence fields:`, JSON.stringify(body.data?.node, null, 2));
    }
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
}

// ── Test 4: Save dispute evidence (dry-run) ─────────────
console.log(`\n── Test 4: Save Evidence dry-run (write_shopify_payments_dispute_evidences) ──`);
try {
  const listRes = await gql(shopDomain, token, `{
    disputes(first: 1) {
      edges { node { id disputeEvidence { id } } }
    }
  }`);
  const firstDispute = listRes.body.data?.disputes?.edges?.[0]?.node;
  if (!firstDispute?.disputeEvidence?.id) {
    console.log("SKIP — no dispute with evidence to test mutation");
  } else {
    const evidenceGid = firstDispute.disputeEvidence.id;
    console.log(`Testing mutation on evidence GID: ${evidenceGid}`);
    console.log(`(Sending empty input — no data will change)`);
    const { status, body } = await gql(shopDomain, token, `
      mutation TestEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
        disputeEvidenceUpdate(id: $id, input: $input) {
          disputeEvidence { id }
          userErrors { field message }
        }
      }
    `, { id: evidenceGid, input: {} });
    if (body.errors) {
      console.log(`Status: ${status} — ERRORS:`);
      body.errors.forEach((e) => console.log(`  ${e.message}`));
    } else {
      const result = body.data?.disputeEvidenceUpdate;
      if (result?.userErrors?.length) {
        console.log(`Status: ${status} — userErrors:`);
        result.userErrors.forEach((e) => console.log(`  ${e.field}: ${e.message}`));
      } else {
        console.log(`Status: ${status} OK — mutation accepted (no-op)`);
        console.log(`Evidence: ${result?.disputeEvidence?.id}`);
      }
    }
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
}

console.log(`\n=== Done ===\n`);
