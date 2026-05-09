import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PILLAR_IDS = [
  "b290ba8e-d5d7-4694-8dc1-4a637a754858",
  "d69418a1-aace-4ca7-bf85-3520447dd591",
  "835a85d2-b8b0-4741-9c2b-3562300c41d2",
];

for (const id of PILLAR_IDS) {
  const { error } = await sb
    .from("content_items")
    .update({
      workflow_status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) console.error(`  ✗ ${id}: ${error.message}`);
  else console.log(`  ✓ promoted ${id} → published`);
}
