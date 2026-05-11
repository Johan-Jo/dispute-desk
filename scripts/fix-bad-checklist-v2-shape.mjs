// One-shot: null out any `evidence_packs.checklist_v2` that is stored
// in the legacy v1 wrapper shape `{items: [...]}` instead of the v2
// flat array. The route at `/api/disputes/[id]/workspace` casts
// `checklist_v2` as `ChecklistItemV2[]` and calls `.map`, so the
// wrapper shape throws `TypeError: a.map is not a function`. Setting
// to null is safe — the route returns `[]` for null checklist_v2.
//
// Origin: `scripts/seed-surasvenne-evidence-packs.mjs` historically
// wrote the v1 shape into the v2 column. That script is now fixed to
// write null; this script cleans up the existing bad rows.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "node:path";

config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: packs, error } = await sb
  .from("evidence_packs")
  .select("id, checklist_v2, created_by")
  .not("checklist_v2", "is", null);

if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}

const bad = packs.filter((p) => p.checklist_v2 && !Array.isArray(p.checklist_v2));

console.log(`scanned ${packs.length} packs with non-null checklist_v2`);
console.log(`found ${bad.length} with the bad wrapper shape`);
if (bad.length === 0) {
  console.log("nothing to migrate. exiting clean.");
  process.exit(0);
}

const sample = bad.slice(0, 5).map((p) => ({
  id: p.id,
  created_by: p.created_by,
  shape_keys:
    p.checklist_v2 && typeof p.checklist_v2 === "object"
      ? Object.keys(p.checklist_v2)
      : null,
}));
console.log("sample bad rows:", JSON.stringify(sample, null, 2));

let updated = 0;
for (const p of bad) {
  const { error: updErr } = await sb
    .from("evidence_packs")
    .update({ checklist_v2: null, updated_at: new Date().toISOString() })
    .eq("id", p.id);
  if (updErr) {
    console.error(`failed to null pack ${p.id}:`, updErr.message);
    continue;
  }
  updated += 1;
}

console.log(`\ndone — nulled ${updated} of ${bad.length} bad-shape packs.`);
