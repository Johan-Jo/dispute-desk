import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DISPUTE_ID = process.argv[2] || "2c08fc9d-aeae-47f4-a6ca-91617c42bb43";

const { data: dispute, error: dErr } = await sb
  .from("disputes")
  .select("id, shop_id, dispute_gid, dispute_evidence_gid, order_gid, order_name, reason, status, customer_display_name, initiated_at")
  .eq("id", DISPUTE_ID)
  .maybeSingle();
if (dErr) console.error("dispute query error:", dErr);

console.log("── dispute ──");
console.log(dispute);

if (!dispute) process.exit(0);

const { data: packs } = await sb
  .from("evidence_packs")
  .select("id, status, completeness_score, failure_code, failure_reason, saved_to_shopify_at, updated_at, pack_json, checklist_v2, submission_readiness, pack_template_id")
  .eq("dispute_id", DISPUTE_ID)
  .order("created_at", { ascending: false });

console.log(`\n── packs (${packs?.length ?? 0}) ──`);
for (const p of packs ?? []) {
  console.log({
    id: p.id,
    status: p.status,
    completeness_score: p.completeness_score,
    failure_code: p.failure_code,
    failure_reason: p.failure_reason,
    saved_to_shopify_at: p.saved_to_shopify_at,
    updated_at: p.updated_at,
    submission_readiness: p.submission_readiness,
    pack_template_id: p.pack_template_id,
    sections_count: (p.pack_json?.sections ?? []).length,
    checklist_v2_count: (p.checklist_v2 ?? []).length,
    collector_errors: p.pack_json?.collectorErrors,
  });
  const sections = p.pack_json?.sections ?? [];
  if (sections.length > 0) {
    console.log(`  sections:`);
    for (const s of sections) {
      console.log(`    - ${s.label}  →  [${(s.fieldsProvided ?? []).join(", ")}]`);
    }
  }
  const checklist = p.checklist_v2 ?? [];
  if (checklist.length > 0) {
    console.log(`  checklist_v2:`);
    for (const c of checklist) {
      console.log(`    - ${c.field}: ${c.status} (${c.priority})`);
    }
  }
}

console.log(`\n── jobs for this dispute's packs (latest 10) ──`);
for (const p of packs ?? []) {
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, job_type, status, attempts, last_error, created_at, updated_at")
    .eq("entity_id", p.id)
    .order("created_at", { ascending: false })
    .limit(5);
  for (const j of jobs ?? []) {
    console.log(`  pack ${p.id.slice(0, 8)}  ${j.job_type}  ${j.status}  attempts=${j.attempts}  ${j.last_error ? `err="${j.last_error.slice(0, 120)}"` : ""}`);
  }
}
