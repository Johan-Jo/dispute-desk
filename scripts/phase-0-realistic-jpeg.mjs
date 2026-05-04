/**
 * Phase 0c follow-up — does a realistic-size photographic JPEG render in
 * Shopify Admin's chargeback-response preview?
 *
 * Earlier probes used 1×1 pixel JPEGs (327 bytes), which Admin attached but
 * couldn't preview. This re-uploads a real screenshot (artifact PNG → JPEG
 * via `sharp`) into `customer_communication_file` so the maintainer can
 * confirm the 👁️ icon now opens an actual image.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import sharp from "sharp";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const API_VERSION = "2026-01";
const SOURCE_PNG = join(process.cwd(), "artifacts/real-disputes/2026-03-04-mmcjvc8d/step-1-checkout-page.png");
const TARGET_DOC_TYPE = "customer_communication_file";
const TARGET_FIELD = "customerCommunicationFile";

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

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: sessionRow } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_id", SHOP_ID)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
const accessToken = decrypt(deserialize(sessionRow.access_token_encrypted));
const shopDomain = sessionRow.shop_domain;

const { data: dispute } = await sb
  .from("disputes")
  .select("id, dispute_gid, dispute_evidence_gid, status")
  .eq("shop_id", SHOP_ID)
  .eq("status", "needs_response")
  .not("dispute_evidence_gid", "is", null)
  .order("initiated_at", { ascending: false })
  .limit(1)
  .maybeSingle();
const numericId = dispute.dispute_gid.match(/\/(\d+)$/)?.[1];

// Convert PNG → JPEG (quality 85, no resize — keeps it photographic)
const pngBytes = readFileSync(SOURCE_PNG);
const jpegBytes = await sharp(pngBytes)
  .flatten({ background: "#ffffff" })
  .jpeg({ quality: 85, progressive: true })
  .toBuffer();
console.log(`Source PNG: ${pngBytes.length} bytes  →  JPEG: ${jpegBytes.length} bytes`);

// Save the bytes locally so the maintainer can compare with what Admin shows.
const outPath = join(process.cwd(), "docs/.shopify-evidence/phase-0-results/realistic-jpeg-uploaded.jpg");
writeFileSync(outPath, jpegBytes);
console.log(`✓ Wrote ${outPath}`);

// REST upload
const url = `https://${shopDomain}/admin/api/${API_VERSION}/shopify_payments/disputes/${numericId}/dispute_file_uploads.json`;
const upload = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  },
  body: JSON.stringify({
    dispute_file_upload: {
      document_type: TARGET_DOC_TYPE,
      filename: "phase0-realistic.jpg",
      mimetype: "image/jpeg",
      data: jpegBytes.toString("base64"),
    },
  }),
});
const uploadBody = await upload.json();
console.log(`REST upload: HTTP ${upload.status} reqId=${upload.headers.get("x-request-id")}`);
console.log(`  fileId: ${uploadBody?.dispute_file_upload?.id}`);

const fileId = uploadBody?.dispute_file_upload?.id;
if (!fileId) {
  console.error("Upload failed:", JSON.stringify(uploadBody, null, 2));
  process.exit(1);
}
const fileGid = `gid://shopify/ShopifyPaymentsDisputeFileUpload/${fileId}`;

// Replace the existing file in customerCommunicationFile (overwrites the 1×1 pixel one).
const gqlUrl = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;
const mut = await fetch(gqlUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  },
  body: JSON.stringify({
    query: `
      mutation($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
        disputeEvidenceUpdate(id: $id, input: $input) {
          disputeEvidence { id }
          userErrors { field message }
        }
      }
    `,
    variables: { id: dispute.dispute_evidence_gid, input: { [TARGET_FIELD]: { id: fileGid } } },
  }),
});
const mutBody = await mut.json();
console.log(`GraphQL: HTTP ${mut.status} reqId=${mut.headers.get("x-request-id")}`);
console.log(`  userErrors: ${JSON.stringify(mutBody?.data?.disputeEvidenceUpdate?.userErrors || [])}`);

console.log(`\n✓ Replaced ${TARGET_FIELD} with realistic JPEG. Refresh the Shopify Admin chargeback response screen and click 👁️ on Customer communication.`);
