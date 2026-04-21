import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";

const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, status, completeness_score, failure_code, failure_reason, updated_at")
  .eq("id", PACK_ID)
  .single();

console.log("pack:", JSON.stringify(pack, null, 2));

const { data: jobs } = await sb
  .from("jobs")
  .select("id, job_type, status, attempts, last_error, created_at, updated_at")
  .eq("entity_id", PACK_ID)
  .order("created_at", { ascending: false })
  .limit(3);

console.log("recent jobs:", JSON.stringify(jobs, null, 2));

const { data: items } = await sb
  .from("evidence_items")
  .select("source_type, field_name, status")
  .eq("pack_id", PACK_ID);

console.log(`evidence_items (${items?.length ?? 0}):`, JSON.stringify(items, null, 2));
