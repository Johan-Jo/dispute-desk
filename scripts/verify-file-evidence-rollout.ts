/**
 * Rollout smoke test for FILE_EVIDENCE_ATTACHMENTS_ENABLED.
 *
 * Mirrors the file-evidence pipeline inside `saveToShopifyJob` exactly,
 * but driven from a script so we can verify on a real pack + dispute
 * before flipping the flag for a merchant. Reads the same data sources
 * (evidence_packs.pack_json, evidence_items, shop_sessions) and runs:
 *
 *   1. Build candidates from manual_upload evidence items (filter by
 *      isFileEligible(checklistField))
 *   2. decideFileAttachments → per-entry plan
 *   3. For each native entry: generateEvidenceAttachmentPdf → REST upload
 *   4. disputeEvidenceUpdate mutation with the matching *File field set
 *   5. Read-back to confirm the GIDs landed
 *
 * Required env: FILE_EVIDENCE_ATTACHMENTS_ENABLED=true (this script
 * doesn't gate on the flag itself — that's the production code path —
 * but we sanity-check it's set so test results match prod intent).
 *
 * Usage:
 *   node scripts/verify-file-evidence-rollout.mjs <packId>
 *
 * Default packId targets the surasvenne dev store's most recent pack
 * with manual uploads.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const PACK_ID = process.argv[2] || "11652786-7d1e-43ce-a3fb-6e18958e6aa6";
const API_VERSION = "2026-01";

if (process.env.FILE_EVIDENCE_ATTACHMENTS_ENABLED !== "true") {
  console.warn("⚠ FILE_EVIDENCE_ATTACHMENTS_ENABLED is not 'true' in env — script will still run, but production won't.");
}

function deserialize(raw: string) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}
function decrypt(payload: ReturnType<typeof deserialize>): string {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`Missing ${envName}`);
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing Supabase env");
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function main() {
// ── Load pack + dispute + session ───────────────────────────────────
const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, shop_id, dispute_id, status, pack_json")
  .eq("id", PACK_ID)
  .single<{ id: string; shop_id: string; dispute_id: string; status: string; pack_json: Record<string, unknown> | null }>();
if (!pack) throw new Error(`Pack ${PACK_ID} not found`);
console.log(`Pack:   ${pack.id}  status=${pack.status}`);

const { data: dispute } = await sb
  .from("disputes")
  .select("id, dispute_gid, dispute_evidence_gid, status, reason")
  .eq("id", pack.dispute_id)
  .single<{ id: string; dispute_gid: string; dispute_evidence_gid: string; status: string; reason: string }>();
if (!dispute) throw new Error(`Dispute ${pack.dispute_id} not found`);
console.log(`Dispute: ${dispute.dispute_gid}  status=${dispute.status}  reason=${dispute.reason}`);

const numericDisputeId = dispute.dispute_gid.match(/\/(\d+)$/)?.[1];

const { data: sessionRow } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted, scopes")
  .eq("shop_id", pack.shop_id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .single<{ shop_domain: string; access_token_encrypted: string; scopes: string | null }>();
if (!sessionRow) throw new Error(`No offline session for shop ${pack.shop_id}`);
const accessToken = decrypt(deserialize(sessionRow.access_token_encrypted));
const shopDomain = sessionRow.shop_domain;
console.log(`Shop:   ${shopDomain}`);
const hasFileScope = sessionRow.scopes?.includes("write_shopify_payments_dispute_file_uploads");
console.log(`Has file-upload scope: ${hasFileScope ? "✓" : "✗"}`);

// ── Build candidates ────────────────────────────────────────────────
const { data: manualItems } = await sb
  .from("evidence_items")
  .select("id, label, payload")
  .eq("pack_id", pack.id)
  .eq("source", "manual_upload");

console.log(`\nManual uploads found: ${manualItems?.length ?? 0}`);
for (const it of manualItems ?? []) {
  const meta = it.payload || {};
  console.log(`  - ${it.id}  field=${meta.checklistField}  file=${meta.fileName}  size=${meta.fileSize}`);
}

if (!manualItems?.length) {
  console.log("\nNothing to attach. Exiting.");
  process.exit(0);
}

// ── Run the pipeline using the same code paths the job uses ─────────
const { isFileEligible } = await import("../lib/argument/canonicalEvidence");
const { decideFileAttachments } = await import("../lib/shopify/decideFileAttachments");
const { generateEvidenceAttachmentPdf } = await import("../lib/packs/generateEvidenceAttachmentPdf");
const { uploadDisputeFile, DOCUMENT_TYPE_TO_MUTATION_FIELD } = await import("../lib/shopify/disputeFileUpload");

const candidates = [];
for (const item of manualItems) {
  const meta = item.payload || {};
  const checklistField = typeof meta.checklistField === "string" ? meta.checklistField : null;
  if (!checklistField || !isFileEligible(checklistField)) continue;
  candidates.push({
    evidenceItemId: String(item.id),
    evidenceFieldKey: checklistField,
    payload: meta,
    label: item.label ?? null,
    fileName: meta.fileName ?? null,
  });
}

const packJson = (pack.pack_json ?? {}) as {
  case_strength?: { overall?: "strong" | "moderate" | "weak" | "insufficient" };
  coverage?: { state?: string };
  fatal_loss?: { triggered?: boolean };
  sections?: unknown[];
};
const plan = decideFileAttachments({
  caseStrength: packJson.case_strength?.overall ?? "insufficient",
  disputeReason: dispute.reason,
  coverageActive: packJson.coverage?.state === "covered_shopify",
  fatalLossActive: packJson.fatal_loss?.triggered === true,
  candidates,
});

console.log(`\nPlan: ${plan.length} entries`);
for (const e of plan) {
  console.log(`  - ${e.evidenceFieldKey}  priority=${e.priority}  → ${e.resolvedSlot.kind}${e.resolvedSlot.kind === "native" ? `:${e.resolvedSlot.targetField}` : `:${e.resolvedSlot.fallbackReason}`}`);
}

const reverseDocType = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_TO_MUTATION_FIELD).map(([d, f]) => [f, d]),
);

// Get sections from pack_json for PDF generation
const sections = Array.isArray(packJson.sections) ? packJson.sections : [];

// ── Per-entry: generate PDF + REST upload + record GID ──────────────
const resolvedPlan = [];
for (const entry of plan) {
  if (entry.resolvedSlot.kind !== "native") {
    resolvedPlan.push({ ...entry, fileGid: null });
    continue;
  }
  if (!numericDisputeId) throw new Error("Missing numeric dispute id");
  const cand = candidates.find(c => c.evidenceItemId === entry.evidenceItemId);
  console.log(`\n→ Generating PDF for ${entry.evidenceFieldKey}…`);
  const pdfBytes = await generateEvidenceAttachmentPdf({
    attachmentType: entry.attachmentType,
    evidenceFieldKey: entry.evidenceFieldKey,
    reason: entry.reason,
    shopDomain,
    disputeId: numericDisputeId,
    sections: sections as never,
    label: cand?.label ?? null,
    payload: cand?.payload ?? null,
  });
  console.log(`  PDF: ${pdfBytes.length} bytes`);

  const targetField = entry.resolvedSlot.targetField;
  const documentType = reverseDocType[targetField];
  if (!documentType) throw new Error(`No document_type for ${targetField}`);
  console.log(`  Uploading as ${documentType} → ${targetField}…`);
  try {
    const result = await uploadDisputeFile({
      shopDomain,
      accessToken,
      disputeNumericId: numericDisputeId,
      documentType: documentType as Parameters<typeof uploadDisputeFile>[0]["documentType"],
      filename: `${entry.evidenceFieldKey}.pdf`,
      mimeType: "application/pdf",
      fileBytes: pdfBytes,
    });
    console.log(`  ✓ fileGid=${result.fileGid}  reqId=${result.requestId}`);
    resolvedPlan.push({ ...entry, fileGid: result.fileGid });
  } catch (err) {
    const e = err as { message?: string; requestId?: string };
    console.error(`  ✗ ${e.message ?? String(err)}`, e.requestId ? `reqId=${e.requestId}` : "");
    resolvedPlan.push({ ...entry, fileGid: null });
  }
}

// ── disputeEvidenceUpdate mutation with the *File fields set ────────
console.log(`\n→ Running disputeEvidenceUpdate…`);
const input: Record<string, { id: string }> = {};
for (const e of resolvedPlan) {
  if (e.resolvedSlot.kind === "native" && e.fileGid) {
    input[e.resolvedSlot.targetField] = { id: e.fileGid };
  }
}
console.log(`  input: ${JSON.stringify(input)}`);

const mutation = `
  mutation($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
    disputeEvidenceUpdate(id: $id, input: $input) {
      disputeEvidence { id }
      userErrors { field message }
    }
  }`;
const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  },
  body: JSON.stringify({ query: mutation, variables: { id: dispute.dispute_evidence_gid, input } }),
});
const body = await res.json();
console.log(`  HTTP ${res.status}  reqId=${res.headers.get("x-request-id")}`);
console.log(`  userErrors: ${JSON.stringify(body?.data?.disputeEvidenceUpdate?.userErrors || [])}`);

// ── Read-back ───────────────────────────────────────────────────────
console.log(`\n→ Read-back…`);
const rb = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  },
  body: JSON.stringify({
    query: `
      query($id: ID!) {
        node(id: $id) {
          ... on ShopifyPaymentsDispute {
            disputeEvidence {
              shippingDocumentationFile { id }
              customerCommunicationFile { id }
              serviceDocumentationFile { id }
              uncategorizedFile { id }
              refundPolicyFile { id }
              cancellationPolicyFile { id }
            }
          }
        }
      }`,
    variables: { id: dispute.dispute_gid },
  }),
});
const rbBody = await rb.json();
console.log(JSON.stringify(rbBody?.data?.node?.disputeEvidence, null, 2));

console.log(`\n✓ Done. View in Admin: https://admin.shopify.com/store/surasvenne/payments/disputes/${numericDisputeId}`);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
