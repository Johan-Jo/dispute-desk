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
const PACK_ID = "aebc5405-3c21-4d27-8219-e39fdc1e330d";

const { data, error } = await sb
  .from("jobs")
  .insert({ shop_id: SHOP_ID, job_type: "save_to_shopify", entity_id: PACK_ID })
  .select("id, status, created_at")
  .single();

if (error) { console.error(error); process.exit(1); }
console.log("save_to_shopify enqueued:", data);
