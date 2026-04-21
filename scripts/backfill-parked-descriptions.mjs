import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Pull all parked_for_review events with null description where metadata.reason exists
const { data: events, error } = await sb
  .from("dispute_events")
  .select("id, description, metadata_json")
  .eq("event_type", "parked_for_review")
  .is("description", null);

if (error) {
  console.error("query error:", error);
  process.exit(1);
}

console.log(`found ${events?.length ?? 0} parked_for_review rows with null description`);

let updated = 0;
for (const e of events ?? []) {
  const reason = e.metadata_json?.reason;
  if (!reason) continue;
  const { error: upErr } = await sb
    .from("dispute_events")
    .update({ description: reason })
    .eq("id", e.id);
  if (upErr) {
    console.error(`  failed ${e.id}: ${upErr.message}`);
  } else {
    updated++;
  }
}
console.log(`updated ${updated} rows`);
