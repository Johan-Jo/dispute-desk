/**
 * Probe Shopify directly: ask for the dispute and the evidence currently
 * attached to it, so we can compare against what we wrote.
 *
 * Looking for the case where Shopify replaced or reset the evidence record
 * at "Submit Response" time, orphaning our writes.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DISPUTE_ID = "aee832ad-62d4-44dc-aa3e-fa7e3cafca93";

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
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

const { data: dispute } = await sb
  .from("disputes")
  .select("shop_id, dispute_gid, dispute_evidence_gid")
  .eq("id", DISPUTE_ID)
  .single();

const { data: sessionRow } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", dispute.shop_id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const token = decrypt(deserialize(sessionRow.access_token_encrypted));
const endpoint = `https://${sessionRow.shop_domain}/admin/api/2026-01/graphql.json`;

const query = `
  query($id: ID!) {
    node(id: $id) {
      ... on ShopifyPaymentsDispute {
        id
        legacyResourceId
        status
        finalizedOn
        evidenceDueBy
        disputeEvidence {
          id
          uncategorizedText
          accessActivityLog
          refundPolicyDisclosure
          customerEmailAddress
          customerFirstName
          customerLastName
        }
      }
    }
  }
`;

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
  body: JSON.stringify({ query, variables: { id: dispute.dispute_gid } }),
});
const json = await res.json();
console.log("── full Shopify response (dispute + evidence) ──");
console.log(JSON.stringify(json, null, 2));

console.log("\n── side-by-side ──");
console.log("our DB dispute_evidence_gid:", dispute.dispute_evidence_gid);
console.log("Shopify current evidence id:", json?.data?.node?.disputeEvidence?.id);
console.log("Shopify legacyResourceId:", json?.data?.node?.disputeEvidence?.legacyResourceId);
console.log("URL the user shared was: .../dispute_evidences/104951644734");
console.log("dispute legacyResourceId:", json?.data?.node?.legacyResourceId);
