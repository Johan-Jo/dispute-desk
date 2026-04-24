/**
 * Rebuild packs 1069 and 1070 and report the new IP & Location Check
 * checklist row + section payload for each.
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

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const PACKS = [
  { id: "aebc5405-3c21-4d27-8219-e39fdc1e330d", order: "1069" },
  { id: "0e01ba6d-9cf1-4302-837c-3cfc646326f2", order: "1070" },
];

for (const p of PACKS) {
  const { data, error } = await sb
    .from("jobs")
    .insert({ shop_id: SHOP_ID, job_type: "build_pack", entity_id: p.id })
    .select("id")
    .single();
  if (error) {
    console.error(`enqueue failed for #${p.order}:`, error);
    continue;
  }
  console.log(`#${p.order} build_pack enqueued: ${data.id}`);
}
