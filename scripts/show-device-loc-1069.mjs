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
  .select("pack_json")
  .eq("id", PACK_ID)
  .single();

const sections = pack?.pack_json?.sections ?? [];
const s = sections.find((x) => (x.fieldsProvided ?? []).includes("device_location_consistency"));
if (!s) {
  console.log("no device_location_consistency section found");
  process.exit(1);
}
console.log(JSON.stringify(s.data, null, 2));
