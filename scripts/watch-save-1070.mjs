import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";

const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, status, saved_to_shopify_at, completeness_score")
  .eq("id", PACK_ID)
  .single();

const { data: job } = await sb
  .from("jobs")
  .select("id, job_type, status, attempts, last_error, created_at, updated_at")
  .eq("entity_id", PACK_ID)
  .eq("job_type", "save_to_shopify")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const { data: audit } = await sb
  .from("audit_events")
  .select("event_type, event_payload, created_at")
  .eq("pack_id", PACK_ID)
  .in("event_type", ["evidence_saved_to_shopify", "save_to_shopify_failed", "auto_save_enqueued", "auto_save_blocked"])
  .order("created_at", { ascending: false })
  .limit(5);

console.log("pack:", pack);
console.log("latest save_to_shopify job:", job);
console.log("recent save-related audit events:");
console.log(JSON.stringify(audit, null, 2));
