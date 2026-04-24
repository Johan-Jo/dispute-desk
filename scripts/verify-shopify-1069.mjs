/**
 * Re-fetch the disputeEvidence from Shopify and print accessActivityLog
 * verbatim so we can check the Device & Location gate end-to-end.
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

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const DISPUTE_EVIDENCE_GID = "gid://shopify/ShopifyPaymentsDisputeEvidence/10483267257";

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

// Find the dispute_evidence_gid for #1069
const { data: dispute } = await sb
  .from("disputes")
  .select("dispute_gid, dispute_evidence_gid")
  .eq("id", "39960467-4310-4943-a540-320050d9a4d6")
  .single();
const eg = dispute?.dispute_evidence_gid ?? DISPUTE_EVIDENCE_GID;
console.log("evidence_gid:", eg);

const { data: sessionRow } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", SHOP_ID)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const token = decrypt(deserialize(sessionRow.access_token_encrypted));
const endpoint = `https://${sessionRow.shop_domain}/admin/api/2025-04/graphql.json`;

const query = `
  query($id: ID!) {
    node(id: $id) {
      ... on ShopifyPaymentsDisputeEvidence {
        id
        accessActivityLog
        uncategorizedText
        refundPolicyDisclosure
      }
    }
  }
`;

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
  body: JSON.stringify({ query, variables: { id: eg } }),
});
const body = await res.json();
const node = body?.data?.node;
if (!node) {
  console.log("no node returned:", JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log("\n── accessActivityLog (full, verbatim) ──");
console.log(node.accessActivityLog ?? "(empty)");

console.log("\n── device-location check ──");
const REVIEWED = "Device and access patterns were reviewed as part of the transaction assessment.";
const MISSING = "Device-level location data was not available for this transaction.";
const log = node.accessActivityLog ?? "";
console.log({
  contains_reviewed_fallback: log.includes(REVIEWED),
  contains_missing_fallback: log.includes(MISSING),
  contains_support_legitimacy: /support customer legitimacy/i.test(log),
  leaks_mismatch: /mismatch|differs from|different country/i.test(log),
  leaks_vpn_proxy: /VPN|proxy|data-center|data center/i.test(log),
  leaks_rio: /Rio de Janeiro|Brazil|BR/.test(log),
});
