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
const DISPUTE_ID = "d24340c6-d62c-4dfd-ab63-ad0365b73145";

function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return { keyVersion: parseInt(ver.slice(1), 10), iv: Buffer.from(iv, "hex"), tag: Buffer.from(tag, "hex"), ciphertext: Buffer.from(ct, "hex") };
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
  .select("dispute_evidence_gid")
  .eq("id", DISPUTE_ID)
  .single();
const eg = dispute.dispute_evidence_gid;

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
        accessActivityLog
      }
    }
  }
`;

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
  body: JSON.stringify({ query, variables: { id: eg } }),
});
const log = (await res.json())?.data?.node?.accessActivityLog ?? "";

const REVIEWED = "Device and access patterns were reviewed as part of the transaction assessment.";
const POSITIVE = "The purchase originated from a location consistent with the customer's billing details and prior activity.";

console.log("── full accessActivityLog ──");
console.log(log);
console.log("\n── lines containing Brazil/BR/Rio ──");
for (const line of log.split("\n")) {
  if (/Rio de Janeiro|Brazil|\bBR\b/.test(line)) console.log(`  > ${line}`);
}
console.log("\n── checks ──");
console.log({
  contains_neutral_reviewed: log.includes(REVIEWED),
  contains_new_positive_sentence: log.includes(POSITIVE),
  contains_old_legitimacy_phrase: /support customer legitimacy/i.test(log),
  leaks_mismatch: /mismatch|differs from/i.test(log),
  leaks_vpn_proxy: /VPN|proxy|data-center/i.test(log),
  leaks_brazil: /Rio de Janeiro|Brazil|\bBR\b/.test(log),
});
