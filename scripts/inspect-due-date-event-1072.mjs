// Inspect the due_date_changed event(s) for dispute #1072
// to see whether it was a null→value transition (first sync) or a
// real deadline move by Shopify.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: disputes, error: dErr } = await sb
  .from("disputes")
  .select("*")
  .eq("order_name", "#1072");
if (dErr) console.log("select error:", dErr);

console.log("── dispute ──");
console.log(disputes);

if (!disputes?.length) {
  console.log("No dispute row for order #1072");
  process.exit(0);
}

const disputeId = disputes[0].id;

const { data: events } = await sb
  .from("dispute_events")
  .select("event_type, description, event_at, created_at, metadata_json, actor_type, source_type")
  .eq("dispute_id", disputeId)
  .order("event_at", { ascending: true });

console.log("\n── timeline events ──");
for (const e of events ?? []) {
  console.log({
    event_type: e.event_type,
    description: e.description,
    event_at: e.event_at,
    metadata: e.metadata_json,
  });
}
