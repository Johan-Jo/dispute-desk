/**
 * Print the IP & Location Check checklist row + section data for both
 * packs after a rebuild on the new code.
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

const PACKS = [
  { id: "aebc5405-3c21-4d27-8219-e39fdc1e330d", order: "1069" },
  { id: "0e01ba6d-9cf1-4302-837c-3cfc646326f2", order: "1070" },
];

for (const p of PACKS) {
  console.log(`\n══ pack #${p.order} (${p.id}) ══`);
  const { data: pack } = await sb
    .from("evidence_packs")
    .select("status, completeness_score, pack_json, checklist_v2")
    .eq("id", p.id)
    .single();

  console.log(`status: ${pack.status}  completeness: ${pack.completeness_score}`);

  const v2 = pack.checklist_v2 ?? [];
  const row = v2.find((r) => r.field === "ip_location_check" || r.field === "device_location_consistency");
  console.log("\n── checklist row ──");
  console.log(row ?? "(missing)");

  const sections = pack.pack_json?.sections ?? [];
  const section = sections.find((s) => {
    const fp = s.fieldsProvided ?? [];
    return fp.includes("ip_location_check") || fp.includes("device_location_consistency");
  });
  console.log("\n── section.data (pack_json.sections) ──");
  if (!section) {
    console.log("(no section)");
    continue;
  }
  const d = section.data;
  console.log(`label:           ${section.label}`);
  console.log(`fieldsProvided:  ${JSON.stringify(section.fieldsProvided)}`);
  console.log(`locationMatch:   ${d.locationMatch}`);
  console.log(`ipConsistency:   ${d.ipConsistencyLevel}`);
  console.log(`riskLevel:       ${d.riskLevel}`);
  console.log(`score:           ${d.score}`);
  console.log(`bankEligible:    ${d.bankEligible}`);
  console.log(`summary:         ${JSON.stringify(d.summary)}`);
  console.log(`bankParagraph:   ${JSON.stringify(d.bankParagraph)}`);
  console.log(`merchantGuidance: ${JSON.stringify(d.merchantGuidance)}`);
}
