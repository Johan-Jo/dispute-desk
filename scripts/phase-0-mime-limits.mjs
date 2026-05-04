/**
 * Phase 0e — Empirical MIME + size limits.
 *
 * Tests upload variants against `/shopify_payments/disputes/:id/dispute_file_uploads.json`:
 *   - real PDF (programmatically built; correct xref offsets)
 *   - PNG
 *   - JPEG (sanity baseline; we already proved this in phase-0-file-evidence.mjs)
 *   - corrupt PDF
 *   - oversized payload (10 MB)
 *
 * Each call uses document_type=uncategorized_file to isolate format/size as the
 * variable. We do NOT attach via disputeEvidenceUpdate — pure upload-side test.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";
import { writeFileSync } from "fs";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const API_VERSION = "2026-01";
const OUT_DIR = join(process.cwd(), "docs/.shopify-evidence/phase-0-results");

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

function makeMinimalPdf(text = "Phase 0 PDF probe") {
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

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQRAAACAwAAAAAAAAAAAAAAAAABAgMxQf/aAAwDAQACEQMRAD8AIf//Z",
  "base64",
);

// Minimal valid PNG (1×1 transparent).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const PDF_SMALL = makeMinimalPdf();
const PDF_CORRUPT = Buffer.from("not a real pdf — broken header\n%%EOF\n", "utf8");
// 10 MB PNG-ish blob (random bytes with PNG header) to test size cap.
const TEN_MB_BLOB = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(10 * 1024 * 1024 - 8, 0x42),
]);

const VARIANTS = [
  { name: "valid-jpeg",     bytes: JPEG,        mime: "image/jpeg",     filename: "probe.jpg" },
  { name: "valid-png",      bytes: PNG,         mime: "image/png",      filename: "probe.png" },
  { name: "valid-pdf-tiny", bytes: PDF_SMALL,   mime: "application/pdf", filename: "probe.pdf" },
  { name: "corrupt-pdf",    bytes: PDF_CORRUPT, mime: "application/pdf", filename: "corrupt.pdf" },
  { name: "oversized-10mb", bytes: TEN_MB_BLOB, mime: "image/png",      filename: "huge.png" },
];

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

const { data: disputes } = await sb
  .from("disputes")
  .select("id, dispute_gid, status")
  .eq("shop_id", SHOP_ID)
  .not("dispute_evidence_gid", "is", null)
  .order("initiated_at", { ascending: false })
  .limit(10);
const active = disputes.find(d => (d.status || "").toLowerCase() === "needs_response") || disputes[0];
const numericId = active.dispute_gid.match(/\/(\d+)$/)?.[1];

console.log(`Shop: ${shopDomain}  dispute: ${active.dispute_gid}\n`);

const results = { runAt: new Date().toISOString(), shop: shopDomain, dispute: active.dispute_gid, variants: {} };

for (const v of VARIANTS) {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/shopify_payments/disputes/${numericId}/dispute_file_uploads.json`;
  console.log(`── ${v.name} (${v.bytes.length} bytes, ${v.mime}) ──`);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      dispute_file_upload: {
        document_type: "uncategorized_file",
        filename: v.filename,
        mimetype: v.mime,
        data: v.bytes.toString("base64"),
      },
    }),
  });
  const elapsed = Date.now() - t0;
  const requestId = res.headers.get("x-request-id");
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  console.log(`  HTTP ${res.status}  ${elapsed}ms  reqId=${requestId}`);
  if (typeof parsed === "object" && parsed?.dispute_file_upload?.id) {
    console.log(`  → file id ${parsed.dispute_file_upload.id}`);
  } else {
    console.log(`  → body: ${String(text).slice(0, 300)}`);
  }
  results.variants[v.name] = {
    bytes: v.bytes.length,
    mime: v.mime,
    httpStatus: res.status,
    elapsedMs: elapsed,
    requestId,
    fileId: parsed?.dispute_file_upload?.id ?? null,
    body: typeof parsed === "object" ? parsed : { raw: String(text).slice(0, 400) },
  };
  console.log("");
}

const outFile = join(OUT_DIR, `mime-limits-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`✓ Wrote ${outFile}`);
console.log("\n══ SUMMARY ══");
for (const [name, r] of Object.entries(results.variants)) {
  console.log(`  ${name.padEnd(20)} ${r.httpStatus}  ${r.fileId ? "id=" + r.fileId : "(no id)"}`);
}
