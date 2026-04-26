/**
 * Diagnostic for dispute 83a94dcf-cfab-4649-ae66-4328656b4ed5.
 * User reports: "we lost all evidence in this case, and this was a strong one.
 * Now there's nothing there."
 *
 * Outputs the latest pack's checklistV2, evidenceItemsByField,
 * sections, and runs the v3 categorizer/contributions to see what the
 * Overview tab is actually computing.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DISPUTE_ID = "83a94dcf-cfab-4649-ae66-4328656b4ed5";

function preview(s, n = 200) {
  if (!s) return "<empty>";
  const flat = String(s).replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

const { data: dispute } = await sb
  .from("disputes")
  .select("id, shop_id, order_name, dispute_gid, dispute_evidence_gid, reason, status, submission_state, evidence_saved_to_shopify_at, amount, currency_code")
  .eq("id", DISPUTE_ID)
  .maybeSingle();

if (!dispute) {
  console.log("dispute row NOT FOUND");
  process.exit(1);
}
console.log("── dispute ──");
console.log(JSON.stringify(dispute, null, 2));

const { data: packs } = await sb
  .from("evidence_packs")
  .select("id, status, completeness_score, submission_readiness, saved_to_shopify_at, created_at, updated_at, pack_json, checklist_json")
  .eq("dispute_id", DISPUTE_ID)
  .order("created_at", { ascending: false });

if (!packs?.length) {
  console.log("\nNO packs for this dispute");
  process.exit(0);
}

const pack = packs[0];
console.log(`\n── packs (${packs.length} total) ──`);
for (const p of packs) {
  console.log(`  id=${p.id} status=${p.status} score=${p.completeness_score} readiness=${p.submission_readiness} saved_at=${p.saved_to_shopify_at} created=${p.created_at}`);
}

console.log(`\n── latest pack (${pack.id}) ──`);
console.log(`  status=${pack.status}`);
console.log(`  pack_json keys: ${Object.keys(pack.pack_json ?? {}).join(", ")}`);

const sections = pack.pack_json?.sections ?? [];
console.log(`\n── sections (${sections.length}) ──`);
for (const s of sections) {
  console.log(`  - type=${s.type}  source=${s.source ?? "?"}  fieldsProvided=${JSON.stringify(s.fieldsProvided ?? [])}`);
  console.log(`    data keys: ${s.data ? Object.keys(s.data).join(", ") : "<no data>"}`);
}

console.log(`\n── checklist_json (top-level) ──`);
const checklist = pack.checklist_json ?? [];
console.log(`  total items: ${checklist.length}`);
for (const c of checklist) {
  console.log(`  - field=${c.field}  status=${c.status}  collectionType=${c.collectionType ?? "?"}  priority=${c.priority}  blocking=${c.blocking}`);
}

const { data: evItems } = await sb
  .from("evidence_items")
  .select("id, label, source, payload, created_at")
  .eq("pack_id", pack.id);

console.log(`\n── evidence_items (${evItems?.length ?? 0}) ──`);
for (const it of evItems ?? []) {
  const p = it.payload ?? {};
  console.log(`  id=${it.id} source=${it.source} label=${JSON.stringify(it.label)}`);
  console.log(`    payload keys: ${Object.keys(p).join(", ")}`);
  console.log(`    fieldsProvided: ${JSON.stringify(p.fieldsProvided ?? "<none>")}`);
  console.log(`    checklistField: ${p.checklistField ?? "<none>"}`);
  if (p.proofType) console.log(`    proofType: ${p.proofType}`);
  if (p.avsResultCode) console.log(`    avsResultCode: ${p.avsResultCode}`);
  if (p.cvvResultCode) console.log(`    cvvResultCode: ${p.cvvResultCode}`);
}

// Now hit the same workspace API the embedded UI uses, so we see what
// `evidenceItemsByField` and `effectiveChecklist` look like to the hook.
console.log(`\n── what the API would return for evidenceItemsByField ──`);
const byField = {};
for (const s of sections) {
  if (!s.fieldsProvided) continue;
  for (const f of s.fieldsProvided) {
    if (!byField[f]) byField[f] = { source: s.source ?? s.type, payload: s.data };
  }
}
console.log(`  fields keyed: ${Object.keys(byField).join(", ") || "<none>"}`);
console.log(`  sample payloads:`);
for (const [k, v] of Object.entries(byField).slice(0, 5)) {
  console.log(`    ${k}: payload keys = ${Object.keys(v.payload ?? {}).join(", ")}`);
}

console.log(`\n── audit_events for pack (newest 10) ──`);
const { data: audits } = await sb
  .from("audit_events")
  .select("event_type, actor_type, event_payload, created_at")
  .eq("pack_id", pack.id)
  .order("created_at", { ascending: false })
  .limit(10);
for (const a of audits ?? []) {
  console.log(`  ${a.created_at}  ${a.actor_type}/${a.event_type}  ${preview(JSON.stringify(a.event_payload), 280)}`);
}
