import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data } = await sb
  .from("disputes")
  .select("order_name, initiated_at, due_at, status, submission_state, evidence_saved_to_shopify_at, normalized_status, phase")
  .eq("order_name", "#1068")
  .single();

console.log(data);
const hoursLeft = (new Date(data.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
console.log("now:", new Date().toISOString());
console.log("hoursLeft:", hoursLeft.toFixed(1));
