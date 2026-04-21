import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const DISPUTE_ID = "d24340c6-d62c-4dfd-ab63-ad0365b73145";
const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";

const { data: pack } = await sb
  .from("evidence_packs")
  .select("status, completeness_score")
  .eq("id", PACK_ID)
  .single();

const { data: lastCreated } = await sb
  .from("audit_events")
  .select("event_payload, created_at")
  .eq("pack_id", PACK_ID)
  .eq("event_type", "pack_created")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const { data: lastBlocked } = await sb
  .from("dispute_events")
  .select("description, metadata_json, event_at")
  .eq("dispute_id", DISPUTE_ID)
  .eq("event_type", "pack_blocked")
  .order("event_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const dbScore = pack?.completeness_score;
const activityScore = lastCreated?.event_payload?.completenessScore;
const blockReason = lastBlocked?.description;

console.log("DB column (v2):           ", dbScore);
console.log("pack_created event score: ", activityScore);
console.log("pack_blocked description: ", blockReason);
console.log("");
console.log(activityScore === dbScore ? "MATCH: v1 leak fixed ✓" : "MISMATCH: v1 leak still present");
