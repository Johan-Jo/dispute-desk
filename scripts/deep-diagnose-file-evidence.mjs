/**
 * Deep diagnostic for the file evidence pipeline. Dump everything that
 * could explain "save ran but file didn't land in Shopify."
 */
import { getServiceClient } from "./lib/supabase.mjs";

const disputeId = process.argv[2] || "75d2ee2b-6fd3-4a33-b11b-218ff5812602";
const sb = getServiceClient();

console.log(`\n=== DEEP DIAGNOSTIC for dispute ${disputeId} ===\n`);

// 1. Dispute row
const { data: dispute, error: dErr } = await sb
  .from("disputes")
  .select("*")
  .eq("id", disputeId)
  .maybeSingle();
console.log("--- Dispute ---");
if (dErr) console.log("  err:", dErr.message);
console.log(`  keys: ${dispute ? Object.keys(dispute).join(", ") : "null"}`);
console.log(`  dispute_gid: ${dispute?.dispute_gid}`);
console.log(`  shop_id: ${dispute?.shop_id}`);
console.log(`  normalized_status: ${dispute?.normalized_status}`);
console.log(`  submission_state: ${dispute?.submission_state}`);

// 2. Pack
const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, pack_json, completeness_score, created_at, updated_at")
  .eq("dispute_id", disputeId)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
console.log(`\n--- Pack (${pack?.id}) ---`);
console.log(`  created: ${pack?.created_at}`);
console.log(`  updated: ${pack?.updated_at}`);
console.log(`  score: ${pack?.completeness_score}`);
const pj = pack?.pack_json || {};
console.log(`  attachmentUploads: ${JSON.stringify(pj.attachmentUploads ?? null)}`);

// 3. Manual uploads
const { data: items } = await sb
  .from("evidence_items")
  .select("id, source, label, payload, created_at")
  .eq("pack_id", pack.id)
  .eq("source", "manual_upload")
  .order("created_at", { ascending: false });
console.log(`\n--- Manual uploads (${items?.length ?? 0}) ---`);
for (const it of items || []) {
  const p = it.payload || {};
  console.log(`  ${it.created_at}  ${it.id}`);
  console.log(`    field=${p.checklistField ?? "?"}  fileName=${p.fileName ?? "?"}  mimeType=${p.mimeType ?? "?"}  size=${p.fileSize ?? "?"}`);
  console.log(`    fieldsProvided=${JSON.stringify(p.fieldsProvided ?? null)}`);
  console.log(`    storage=${p.storagePath ?? p.bucket ?? "?"}`);
}

// 4. Recent audit events (all types)
const { data: events } = await sb
  .from("audit_events")
  .select("created_at, event_type, event_payload")
  .eq("dispute_id", disputeId)
  .gte("created_at", "2026-05-04T01:55:00Z")
  .order("created_at", { ascending: false })
  .limit(40);
console.log(`\n--- All audit events since 01:55 UTC ---`);
for (const ev of events || []) {
  console.log(`  [${ev.created_at}] ${ev.event_type}`);
  const p = ev.event_payload || {};
  if (p.errorMessage) console.log(`    errorMessage: ${String(p.errorMessage).slice(0, 300)}`);
  if (p.error) console.log(`    error: ${String(p.error).slice(0, 300)}`);
  if (p.failures !== undefined) console.log(`    failures: ${p.failures}`);
  if (p.outcome) console.log(`    outcome: ${p.outcome}`);
  if (p.flagEnabled !== undefined) console.log(`    flagEnabled: ${p.flagEnabled}`);
  if (p.skipped) console.log(`    skipped: ${p.skipped}`);
  if (p.skipReason) console.log(`    skipReason: ${p.skipReason}`);
  if (Array.isArray(p.attachments)) {
    for (const a of p.attachments) {
      const status = a.ok ? "OK" : `FAIL(${a.errorCode ?? "?"})`;
      console.log(`    ${status}  ${a.targetField}  errMsg=${a.errorMessage ? a.errorMessage.slice(0, 200) : "(none)"}`);
    }
  }
  if (Array.isArray(p.entries)) {
    for (const e of p.entries) {
      console.log(`    entry: ${JSON.stringify(e).slice(0, 300)}`);
    }
  }
  if (p.fields_sent) console.log(`    fields_sent: ${JSON.stringify(p.fields_sent)}`);
  if (p.fields_confirmed) console.log(`    fields_confirmed: ${JSON.stringify(p.fields_confirmed)}`);
  if (p.fields_missing) console.log(`    fields_missing: ${JSON.stringify(p.fields_missing)}`);
}

// 5. Recent jobs
const { data: jobs, error: jErr } = await sb
  .from("jobs")
  .select("*")
  .eq("entity_id", pack.id)
  .gte("created_at", "2026-05-04T01:55:00Z")
  .order("created_at", { ascending: false })
  .limit(10);
if (jErr) console.log("\njobs err:", jErr.message);
console.log(`\n--- Recent jobs for this pack ---`);
console.log(`  jobs found: ${jobs?.length ?? 0}`);
for (const j of jobs || []) {
  console.log(`  ${j.created_at}  ${j.type ?? j.job_type}  status=${j.status}  attempts=${j.attempts}`);
  if (j.error_message) console.log(`    error: ${String(j.error_message).slice(0, 300)}`);
  if (j.last_error) console.log(`    last_error: ${String(j.last_error).slice(0, 300)}`);
}

// 6. Shop scopes
const shopId = dispute?.shop_id ?? pack?.shop_id;
const { data: shop } = shopId
  ? await sb.from("shops").select("*").eq("id", shopId).maybeSingle()
  : { data: null };
console.log(`\n--- Shop ---`);
console.log(`  keys: ${shop ? Object.keys(shop).join(", ") : "null"}`);
console.log(`  domain: ${shop?.shop_domain}`);
console.log(`  scopes_granted: ${JSON.stringify(shop?.scopes_granted ?? shop?.scopes ?? null)}`);

// 7. Feature flag check (read .env.local indirectly via process.env)
console.log(`\n--- Env ---`);
console.log(`  FILE_EVIDENCE_ATTACHMENTS_ENABLED: ${process.env.FILE_EVIDENCE_ATTACHMENTS_ENABLED ?? "(not set)"}`);
