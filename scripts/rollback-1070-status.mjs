import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";

// The earlier helper optimistically flipped status to "saved_to_shopify"
// assuming the job would succeed. The job failed — reset the pack so the
// UI stops claiming the evidence was submitted.
const { error } = await sb
  .from("evidence_packs")
  .update({
    status: "ready",
    saved_to_shopify_at: null,
    updated_at: new Date().toISOString(),
  })
  .eq("id", PACK_ID);

if (error) {
  console.error(error);
  process.exit(1);
}

const { data } = await sb
  .from("evidence_packs")
  .select("id, status, saved_to_shopify_at, completeness_score")
  .eq("id", PACK_ID)
  .single();
console.log("after rollback:", data);
