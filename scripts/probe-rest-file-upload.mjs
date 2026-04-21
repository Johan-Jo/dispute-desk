/**
 * Probe — does the REST /shopify_payments/disputes/:id/dispute_file_uploads.json
 * endpoint accept our offline (shop-level) token?
 *
 * Old code claimed 404 / missing scope. That claim predates the auth refactor
 * (commits ee7c3de / c15c817). Verify it again with the current offline token,
 * which we KNOW works for disputeEvidenceUpdate.
 *
 * Uploads a tiny valid PDF ("probe.pdf") to dispute 10488086585's
 * dispute_file_uploads.json. Does NOT attach it to disputeEvidence.
 *
 * Outcomes:
 *   A. HTTP 201/200 + response { dispute_file_upload: { id } } → Path 1 works.
 *   B. HTTP 404 → endpoint truly blocked; consider stagedUploadsCreate path.
 *   C. HTTP 401/403 / auth error → another scope issue.
 *   D. 4xx validation → endpoint is reachable; just tune payload.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const DISPUTE_NUMERIC_ID = "10488086585"; // pack 1070's dispute

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

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

// Minimal valid PDF (real bytes — Shopify validates the MIME/magic)
const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>/Contents 4 0 R>>endobj\n" +
  "4 0 obj<</Length 44>>stream\n" +
  "BT /F1 12 Tf 50 750 Td (DisputeDesk probe) Tj ET\n" +
  "endstream endobj\n" +
  "xref\n" +
  "0 5\n" +
  "0000000000 65535 f \n" +
  "0000000009 00000 n \n" +
  "0000000052 00000 n \n" +
  "0000000101 00000 n \n" +
  "0000000189 00000 n \n" +
  "trailer<</Size 5/Root 1 0 R>>\nstartxref\n270\n%%EOF\n",
  "utf8",
);

const base64 = MINIMAL_PDF.toString("base64");

// Try a couple of API versions, since the current disputeFileUpload.ts uses
// whatever SHOPIFY_API_VERSION is pinned in lib/shopify/client.ts. Cover both
// the 2025-04 we used for disputeEvidenceUpdate and 2026-01 (latest stable).
const VERSIONS = ["2025-04", "2026-01", "2024-10"];

for (const version of VERSIONS) {
  const url = `https://${shopDomain}/admin/api/${version}/shopify_payments/disputes/${DISPUTE_NUMERIC_ID}/dispute_file_uploads.json`;
  const body = {
    dispute_file_upload: {
      document_type: "UNCATEGORIZED_FILE",
      filename: "probe.pdf",
      mimetype: "application/pdf",
      data: base64,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify(body),
  });
  const requestId = res.headers.get("x-request-id");
  const text = await res.text();
  console.log(`\n── version ${version} ──`);
  console.log(`URL: ${url}`);
  console.log(`HTTP ${res.status}  X-Request-Id=${requestId}`);
  console.log("body:", text.substring(0, 800));
  if (res.ok) {
    console.log(">>> SUCCESS on this version. Stop here.");
    break;
  }
}
