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

const { data: disputes } = await sb
  .from("disputes")
  .select("id, shop_id, order_name, dispute_evidence_gid, reason, status")
  .eq("id", "c900456c-3895-48de-bd81-82a8d0ed19bb")
  .limit(1);

console.log("── dispute ──");
console.log(JSON.stringify(disputes, null, 2));

const d = disputes?.[0];
if (!d) { console.log("no match"); process.exit(0); }

// Get the latest pack
const { data: packs } = await sb
  .from("evidence_packs")
  .select("id, status, saved_to_shopify_at, pack_json")
  .eq("dispute_id", d.id)
  .order("created_at", { ascending: false })
  .limit(1);

const pack = packs?.[0];
console.log("\n── pack ──");
console.log("id:", pack?.id, "status:", pack?.status, "saved_at:", pack?.saved_to_shopify_at);

const sections = pack?.pack_json?.sections ?? [];
console.log("\n── pack sections (type/label/source) ──");
for (const s of sections) {
  console.log(`  - type=${s.type} label=${s.label} source=${s.source}`);
}

const hasPolicy = sections.some(s => s.type === "policy" || s.type === "refund_policy" || s.type === "refund_policy_snapshot");
console.log("\nhasPolicy section:", hasPolicy);

// Query Shopify for what was actually saved
const { data: sessionRow } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", d.shop_id)
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
        cancellationPolicyDisclosure
        refundPolicyDisclosure
        refundRefusalExplanation
        cancellationRebuttal
        uncategorizedText
      }
    }
  }
`;

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
  body: JSON.stringify({ query, variables: { id: d.dispute_evidence_gid } }),
});
const node = (await res.json())?.data?.node ?? {};

console.log("\n── Shopify evidence (what is actually saved) ──");
for (const [k, v] of Object.entries(node)) {
  const len = v == null ? 0 : String(v).length;
  const preview = v == null ? "<null>" : String(v).slice(0, 120).replace(/\n/g, "⏎");
  console.log(`  ${k}: len=${len} preview="${preview}"`);
}
