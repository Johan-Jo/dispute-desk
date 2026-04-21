import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await sb
  .from("disputes")
  .select("id, order_name, order_gid, reason, normalized_status, shop_id")
  .or("order_name.eq.#1070,order_name.eq.1070")
  .order("created_at", { ascending: false })
  .limit(5);

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
