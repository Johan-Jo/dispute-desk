/**
 * Check what's in the checklist for pack #1069 and confirm whether
 * device_location_consistency made it into the rendered row set.
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

const PACK_ID = "aebc5405-3c21-4d27-8219-e39fdc1e330d";

const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, status, dispute_id, pack_template_id, checklist, checklist_v2, pack_json")
  .eq("id", PACK_ID)
  .single();

console.log("── pack meta ──");
console.log({
  id: pack.id,
  status: pack.status,
  pack_template_id: pack.pack_template_id,
  has_checklist: Array.isArray(pack.checklist),
  has_checklist_v2: Array.isArray(pack.checklist_v2),
});

console.log("\n── pack_json.completeness.checklist (fields only) ──");
const pjList = pack.pack_json?.completeness?.checklist ?? [];
for (const row of pjList) {
  console.log(`  - ${row.field}: status=${row.status ?? row.present ?? "?"}  priority=${row.priority ?? "?"}`);
}

console.log("\n── checklist_v2 column (fields only) ──");
const v2 = pack.checklist_v2 ?? [];
for (const row of v2) {
  console.log(`  - ${row.field}: status=${row.status}  priority=${row.priority}  source=${row.source}`);
}

console.log("\n── pack_json.sections (label → fieldsProvided) ──");
const sections = pack.pack_json?.sections ?? [];
for (const s of sections) {
  console.log(`  - ${s.label}  →  [${(s.fieldsProvided ?? []).join(", ")}]`);
}

// Device & Location section lookup
const dl = sections.find((s) => {
  const fp = s.fieldsProvided ?? [];
  return fp.includes("ip_location_check") || fp.includes("device_location_consistency");
});
console.log("\n── ip_location_check / device_location_consistency section present in sections[]? ──");
console.log(dl ? "YES" : "NO");

const dlRow = v2.find(
  (r) => r.field === "ip_location_check" || r.field === "device_location_consistency",
);
console.log("── checklist row for ip_location_check (or legacy)? ──");
console.log(dlRow ?? "NO");
