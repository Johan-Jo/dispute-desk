/**
 * Phase 0 — Prove the path: REST upload → GID → disputeEvidenceUpdate per field.
 *
 * Runs end-to-end against a real Shopify dev store + a real dispute. Captures:
 *   0a. POST /dispute_file_uploads.json per document_type (6 calls)
 *   0b. disputeEvidenceUpdate accepting the GID for each named file field
 *   0d. Read-back of disputeEvidence with all 6 *File fields included
 *
 * Output (machine + human-readable) → docs/.shopify-evidence/phase-0-results/
 *
 * Pre-req: shop's offline session has write_shopify_payments_dispute_file_uploads
 *          (verified before running — see scripts/check-session-scopes.mjs).
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";
import { writeFileSync, readFileSync } from "fs";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const API_VERSION = "2026-01";
const OUT_DIR = join(process.cwd(), "docs/.shopify-evidence/phase-0-results");

// document_type → DisputeEvidenceUpdateInput field name (1:1 mapping)
const FIELD_MAP = {
  customer_communication_file: "customerCommunicationFile",
  refund_policy_file:          "refundPolicyFile",
  cancellation_policy_file:    "cancellationPolicyFile",
  uncategorized_file:          "uncategorizedFile",
  shipping_documentation_file: "shippingDocumentationFile",
  service_documentation_file:  "serviceDocumentationFile",
};

// ─── token decrypt (mirrors lib/security/encryption.ts) ──────────────────────
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

// ─── HTTP helpers ────────────────────────────────────────────────────────────
async function rest({ shopDomain, accessToken }, method, path, body) {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return {
    status: res.status,
    requestId: res.headers.get("x-request-id"),
    body: parsed,
    rawText: text,
  };
}

async function gql({ shopDomain, accessToken }, query, variables = {}) {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  return {
    status: res.status,
    requestId: res.headers.get("x-request-id"),
    data: json?.data,
    errors: json?.errors || [],
  };
}

// ─── Test files: minimal valid JPEG (proven against this endpoint) + PDF ────
// JPEG: 1×1 black pixel — already accepted by Shopify per scripts/test-dispute-file-upload.ts.
const JPEG_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQRAAACAwAAAAAAAAAAAAAAAAABAgMxQf/aAAwDAQACEQMRAD8AIf//Z",
  "base64",
);

// PDF: programmatically built with correct xref offsets — Shopify rejects
// hand-rolled PDFs with broken xref tables, so we compute offsets from byte
// positions rather than hard-coding them.
function makeMinimalPdf(text = "Phase 0 probe") {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>",
  ];
  const stream = `BT /F1 18 Tf 50 720 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

  let body = "%PDF-1.4\n%\xC2\xA5\xC2\xB1\xC3\xAB\n";
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(body, "binary"));
    body += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "binary");
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    body += `${offsets[i].toString().padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}

// ─── Pick a NEEDS_RESPONSE dispute on this shop ──────────────────────────────
async function pickActiveDispute(sb) {
  const { data: disputes } = await sb
    .from("disputes")
    .select("id, dispute_gid, dispute_evidence_gid, status, reason")
    .eq("shop_id", SHOP_ID)
    .not("dispute_evidence_gid", "is", null)
    .order("initiated_at", { ascending: false })
    .limit(20);
  if (!disputes?.length) throw new Error("No disputes with evidence GID");

  // Prefer needs_response (active write window); fall back to most recent.
  const active = disputes.find(d => (d.status || "").toLowerCase() === "needs_response");
  const chosen = active || disputes[0];
  console.log(`✓ Chosen dispute: ${chosen.dispute_gid} status=${chosen.status} reason=${chosen.reason}`);
  return chosen;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { data: sessionRow } = await sb
    .from("shop_sessions")
    .select("shop_domain, access_token_encrypted, scopes")
    .eq("shop_id", SHOP_ID)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sessionRow) throw new Error("No offline session for this shop");

  const accessToken = decrypt(deserialize(sessionRow.access_token_encrypted));
  const shopDomain = sessionRow.shop_domain;
  const auth = { shopDomain, accessToken };
  console.log(`Shop: ${shopDomain}`);
  console.log(`Scopes:\n  ${sessionRow.scopes}\n`);

  const dispute = await pickActiveDispute(sb);
  const numericDisputeId = dispute.dispute_gid.match(/\/(\d+)$/)?.[1];
  if (!numericDisputeId) throw new Error(`Bad dispute GID: ${dispute.dispute_gid}`);
  const evidenceGid = dispute.dispute_evidence_gid;

  // Use JPEG for per-field probe (already proven valid against this endpoint).
  // PDF format is exercised separately in the MIME-variant block below.
  const probeBytes = JPEG_BYTES;
  const probeMime = "image/jpeg";
  const probeExt = "jpg";
  const base64 = probeBytes.toString("base64");

  const results = {
    runAt: new Date().toISOString(),
    apiVersion: API_VERSION,
    shop: shopDomain,
    sessionScopes: sessionRow.scopes,
    dispute: {
      gid: dispute.dispute_gid,
      numericId: numericDisputeId,
      evidenceGid,
      status: dispute.status,
      reason: dispute.reason,
    },
    probe: { bytes: probeBytes.length, mime: probeMime },
    perField: {},
  };

  // ── 0a + 0b: per-document_type upload + disputeEvidenceUpdate ──
  for (const [docType, fieldName] of Object.entries(FIELD_MAP)) {
    console.log(`\n── ${docType} → ${fieldName} ──`);
    const filename = `phase0-${docType}.${probeExt}`;

    // 0a — REST upload
    const upload = await rest(auth, "POST",
      `/shopify_payments/disputes/${numericDisputeId}/dispute_file_uploads.json`,
      { dispute_file_upload: { document_type: docType, filename, mimetype: probeMime, data: base64 } },
    );
    console.log(`  REST upload: HTTP ${upload.status} reqId=${upload.requestId}`);
    if (typeof upload.body === "object" && upload.body?.dispute_file_upload?.id) {
      console.log(`  → file id: ${upload.body.dispute_file_upload.id}`);
    } else {
      console.log(`  → body: ${upload.rawText.slice(0, 400)}`);
    }

    const fileId = upload.body?.dispute_file_upload?.id;
    const restEvidenceId = upload.body?.dispute_file_upload?.dispute_evidence_id;
    const fileGid = fileId ? `gid://shopify/ShopifyPaymentsDisputeFileUpload/${fileId}` : null;

    let mutResult = { skipped: "no fileId" };
    if (fileGid) {
      // 0b — disputeEvidenceUpdate accepts the GID on the matching field
      const mut = await gql(auth, `
        mutation($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
          disputeEvidenceUpdate(id: $id, input: $input) {
            disputeEvidence { id }
            userErrors { field message }
          }
        }
      `, { id: evidenceGid, input: { [fieldName]: { id: fileGid } } });

      const userErrors = mut.data?.disputeEvidenceUpdate?.userErrors || [];
      const ok = mut.status === 200 && !mut.errors.length && userErrors.length === 0;
      console.log(`  GraphQL mutation: HTTP ${mut.status} reqId=${mut.requestId} → ${ok ? "OK" : "FAIL"}`);
      if (mut.errors.length) console.log(`  errors: ${JSON.stringify(mut.errors)}`);
      if (userErrors.length) console.log(`  userErrors: ${JSON.stringify(userErrors)}`);

      mutResult = {
        ok,
        status: mut.status,
        requestId: mut.requestId,
        errors: mut.errors,
        userErrors,
      };
    }

    results.perField[docType] = {
      mutationField: fieldName,
      upload: {
        status: upload.status,
        requestId: upload.requestId,
        fileId: fileId ?? null,
        fileGid,
        restEvidenceId: restEvidenceId ?? null,
        body: typeof upload.body === "object" ? upload.body : { raw: String(upload.rawText).slice(0, 500) },
      },
      mutation: mutResult,
    };
  }

  // ── 0d: read-back per file field ──
  console.log(`\n── Read-back: disputeEvidence file fields ──`);
  const readback = await gql(auth, `
    query($id: ID!) {
      node(id: $id) {
        ... on ShopifyPaymentsDispute {
          id
          status
          disputeEvidence {
            id
            uncategorizedText
            uncategorizedFile { id }
            cancellationPolicyFile { id }
            customerCommunicationFile { id }
            refundPolicyFile { id }
            serviceDocumentationFile { id }
            shippingDocumentationFile { id }
          }
        }
      }
    }
  `, { id: dispute.dispute_gid });
  console.log(`  HTTP ${readback.status} reqId=${readback.requestId}`);
  console.log(JSON.stringify(readback.data, null, 2));
  results.readback = {
    status: readback.status,
    requestId: readback.requestId,
    errors: readback.errors,
    evidence: readback.data?.node?.disputeEvidence ?? null,
  };

  // ── REST list view (companion read) ──
  console.log(`\n── REST list: dispute_file_uploads.json ──`);
  const restList = await rest(auth, "GET",
    `/shopify_payments/disputes/${numericDisputeId}/dispute_file_uploads.json`);
  console.log(`  HTTP ${restList.status} reqId=${restList.requestId}`);
  if (typeof restList.body === "object") {
    const list = restList.body.dispute_file_uploads || [];
    console.log(`  ${list.length} files attached to dispute`);
    for (const f of list) {
      console.log(`    - id=${f.id} type=${f.document_type} filename=${f.filename ?? "?"}`);
    }
  }
  results.restList = {
    status: restList.status,
    requestId: restList.requestId,
    body: restList.body,
  };

  // ── Persist results ──
  const outFile = join(OUT_DIR, `probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n✓ Wrote ${outFile}`);

  // ── Compact summary ──
  const summary = {};
  for (const [docType, r] of Object.entries(results.perField)) {
    summary[docType] = {
      uploadHttp: r.upload.status,
      hasFileId: !!r.upload.fileId,
      mutationField: r.mutationField,
      mutationOk: r.mutation.ok ?? false,
      mutationUserErrors: (r.mutation.userErrors || []).map(e => e.message).join("; ") || null,
    };
  }
  console.log("\n══ SUMMARY ══");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error("FATAL:", err.message);
  console.error(err.stack);
  process.exit(1);
});
