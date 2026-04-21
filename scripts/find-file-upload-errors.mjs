/**
 * Diagnostic — look for any job/audit event anywhere in the DB that
 * contains the string "File upload failed" (or close variants).
 * Answers the question: is this a real observed failure or a
 * forward-looking concern?
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

console.log("── jobs with save_to_shopify userError/File error ──");
const { data: jobs } = await sb
  .from("jobs")
  .select("id, status, attempts, last_error, entity_id, created_at")
  .eq("job_type", "save_to_shopify")
  .ilike("last_error", "%file%")
  .order("created_at", { ascending: false })
  .limit(20);
console.log(JSON.stringify(jobs, null, 2));

console.log("\n── recent save_to_shopify jobs (any status, last 20) ──");
const { data: all } = await sb
  .from("jobs")
  .select("id, status, attempts, last_error, entity_id, created_at, updated_at")
  .eq("job_type", "save_to_shopify")
  .order("created_at", { ascending: false })
  .limit(20);
console.log(JSON.stringify(all, null, 2));

console.log("\n── audit events with 'file' in payload (last 20) ──");
const { data: events } = await sb
  .from("audit_events")
  .select("event_type, event_payload, created_at")
  .order("created_at", { ascending: false })
  .limit(200);
const fileEvents = (events ?? []).filter((e) => {
  const json = JSON.stringify(e.event_payload ?? {});
  return /file upload|upload.*fail|FileUpload/i.test(json);
});
console.log(JSON.stringify(fileEvents.slice(0, 20), null, 2));
