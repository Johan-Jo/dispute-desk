import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const DISPUTE_ID = "d24340c6-d62c-4dfd-ab63-ad0365b73145";
const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";

const { data: events } = await sb
  .from("dispute_events")
  .select("event_type, event_at, metadata_json")
  .eq("dispute_id", DISPUTE_ID)
  .in("event_type", ["pack_blocked", "auto_save_triggered", "auto_build_triggered", "parked_for_review"])
  .order("event_at", { ascending: false })
  .limit(10);

console.log("recent automation events:");
console.log(JSON.stringify(events, null, 2));

const { data: audit } = await sb
  .from("audit_events")
  .select("event_type, event_payload, created_at")
  .eq("pack_id", PACK_ID)
  .order("created_at", { ascending: false })
  .limit(10);

console.log("\nrecent audit events on pack:");
console.log(JSON.stringify(audit, null, 2));

const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, status, completeness_score, blockers, submission_readiness, checklist_v2")
  .eq("id", PACK_ID)
  .single();

console.log("\npack snapshot:");
console.log(JSON.stringify({
  id: pack.id,
  status: pack.status,
  completeness_score: pack.completeness_score,
  submission_readiness: pack.submission_readiness,
  blockers: pack.blockers,
}, null, 2));
