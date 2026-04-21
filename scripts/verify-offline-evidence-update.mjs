/**
 * Step 0 verification — does the offline (shop-level) token work for
 * Shopify's disputeEvidenceUpdate mutation?
 *
 * Codebase's ambient claim: "requires online (user-context) session".
 * No tests, docs, or captured Shopify response back that claim today.
 * This script produces the first verbatim evidence either way.
 *
 * Safety:
 *   1. READ the current evidence first via ShopifyPaymentsDispute node.
 *      If that 401s on offline → Outcome B without any writes.
 *   2. If read succeeds, WRITE the same uncategorizedText back —
 *      idempotent at the data level. submitEvidence is never set.
 *
 * Outcomes:
 *   A. data.disputeEvidenceUpdate.disputeEvidence.id present AND
 *      userErrors empty → offline works. Proceed with offline-first swap.
 *   B. top-level errors[] / HTTP 401 with /invalid api key|unrecognized
 *      login|access denied|user context/i → offline cannot do this mutation.
 *      Proceed with narrow online fallback.
 *   ?. Anything else → inconclusive; inspect raw output.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const DISPUTE_ID = "d24340c6-d62c-4dfd-ab63-ad0365b73145";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// ── decrypt inline (mirrors lib/security/encryption.ts deserialize+decrypt) ──
function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}
function decrypt(payload) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`missing ${envName}`);
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

// ── load offline session ──
const { data: sessionRow } = await sb
  .from("shop_sessions")
  .select("id, shop_domain, access_token_encrypted")
  .eq("shop_id", SHOP_ID)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (!sessionRow) {
  console.error("No offline session row for shop", SHOP_ID);
  process.exit(2);
}
const accessToken = decrypt(deserialize(sessionRow.access_token_encrypted));
const shopDomain = sessionRow.shop_domain;
console.log(`loaded offline session: shop=${shopDomain} id=${sessionRow.id}`);

// ── load dispute GIDs ──
const { data: dispute } = await sb
  .from("disputes")
  .select("dispute_gid, dispute_evidence_gid")
  .eq("id", DISPUTE_ID)
  .single();
if (!dispute?.dispute_gid || !dispute?.dispute_evidence_gid) {
  console.error("dispute rows missing gids:", dispute);
  process.exit(2);
}
console.log(`dispute_gid: ${dispute.dispute_gid}`);
console.log(`dispute_evidence_gid: ${dispute.dispute_evidence_gid}`);

const endpoint = `https://${shopDomain}/admin/api/2025-04/graphql.json`;

async function call(query, variables) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, json, raw: text };
}

const AUTH_RE = /invalid api key|unrecognized login|access denied|user context|wrong password/i;

// ═══ READ ═══
console.log("\n── READ disputeEvidence.uncategorizedText ──");
const READ = `
  query VerifyEvidence($id: ID!) {
    node(id: $id) {
      ... on ShopifyPaymentsDispute {
        disputeEvidence {
          id
          uncategorizedText
        }
      }
    }
  }
`;
const readResp = await call(READ, { id: dispute.dispute_gid });
console.log(`HTTP ${readResp.status}`);
console.log("raw:", readResp.raw.substring(0, 1200));

if (readResp.status === 401 || AUTH_RE.test(readResp.raw)) {
  console.log("\n=== OUTCOME B (read itself fails with auth) ===");
  console.log("Offline token cannot read disputeEvidence.");
  process.exit(0);
}

const currentText = readResp.json?.data?.node?.disputeEvidence?.uncategorizedText ?? null;
console.log(`current uncategorizedText length: ${currentText == null ? "null" : currentText.length}`);

// ═══ WRITE (idempotent) ═══
console.log("\n── WRITE disputeEvidenceUpdate (idempotent) ──");
const WRITE = `
  mutation DisputeEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
    disputeEvidenceUpdate(id: $id, input: $input) {
      disputeEvidence { id }
      userErrors { field message }
    }
  }
`;
// Write back the exact same text (or an empty string if none). No submit flag.
const input = currentText != null ? { uncategorizedText: currentText } : { uncategorizedText: "" };
const writeResp = await call(WRITE, { id: dispute.dispute_evidence_gid, input });
console.log(`HTTP ${writeResp.status}`);
console.log("raw:", writeResp.raw.substring(0, 2000));

// ═══ Verdict ═══
console.log("\n=== VERDICT ===");
if (writeResp.status === 401 || AUTH_RE.test(writeResp.raw)) {
  console.log("OUTCOME B: offline token rejected for the mutation.");
  console.log("Keep online-required path; phase 2 fallback design required.");
  process.exit(0);
}
const de = writeResp.json?.data?.disputeEvidenceUpdate;
if (de?.disputeEvidence?.id && (de.userErrors ?? []).length === 0) {
  console.log("OUTCOME A: offline token SUCCEEDED on disputeEvidenceUpdate.");
  console.log(`returned evidence id: ${de.disputeEvidence.id}`);
  console.log("The 'requires online' claim in the codebase is NOT supported by this call.");
  console.log("Proceed with offline-first swap.");
  process.exit(0);
}
console.log("INCONCLUSIVE — neither A nor B matched cleanly. Inspect raw above.");
process.exit(1);
