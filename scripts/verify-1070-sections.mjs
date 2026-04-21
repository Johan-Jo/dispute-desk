import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";

const { data: items } = await sb
  .from("evidence_items")
  .select("source_type, field_name, label, status")
  .eq("pack_id", PACK_ID)
  .order("created_at", { ascending: true });

console.log(`evidence_items (${items?.length ?? 0}):`);
for (const it of items ?? []) {
  console.log(`  - ${it.source_type}\t${it.field_name}\t${it.label}\t(${it.status})`);
}

const { data: pack } = await sb
  .from("evidence_packs")
  .select("pack_json, checklist_v2, completeness_score")
  .eq("id", PACK_ID)
  .single();

const sections = pack?.pack_json?.sections ?? [];
console.log(`\npack_json.sections (${sections.length}):`);
for (const s of sections) {
  console.log(`  - source=${s.source} fields=${JSON.stringify(s.fieldsProvided)} label="${s.label}"`);
}

const checklist = pack?.checklist_v2 ?? [];
console.log(`\nchecklist_v2 (${checklist.length}):`);
for (const c of checklist) {
  console.log(`  - field=${c.field}\tlabel="${c.label}"\tstatus=${c.status}`);
}
