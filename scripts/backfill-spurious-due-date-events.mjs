// Audit: report spurious due_date_changed timeline events where
// old_due_at and new_due_at represent the same instant (Shopify
// returned a non-UTC offset, sync compared raw strings).
//
// NOTE: dispute_events is append-only (DB trigger), so these rows
// cannot be deleted. The timeline API filters them at read time —
// this script exists for visibility / diagnostics only.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: events, error } = await sb
  .from("dispute_events")
  .select("id, dispute_id, event_at, metadata_json")
  .eq("event_type", "due_date_changed");

if (error) {
  console.error("Query failed:", error);
  process.exit(1);
}

const spurious = [];
for (const e of events ?? []) {
  const meta = e.metadata_json ?? {};
  if (!meta.old_due_at || !meta.new_due_at) continue;
  const oldMs = new Date(meta.old_due_at).getTime();
  const newMs = new Date(meta.new_due_at).getTime();
  if (Number.isFinite(oldMs) && Number.isFinite(newMs) && oldMs === newMs) {
    spurious.push({ id: e.id, dispute_id: e.dispute_id, event_at: e.event_at });
  }
}

console.log(`due_date_changed events total: ${events?.length ?? 0}`);
console.log(`  of which spurious (same instant):  ${spurious.length}`);
console.log(`These rows will be filtered from /api/disputes/:id/timeline responses.`);
