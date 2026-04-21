/**
 * Enqueue ONE save_to_shopify job for pack 0e01ba6d. No pack-status writes —
 * the handler itself owns status transitions (replaces the buggy step-5 in
 * scripts/lower-threshold-and-retrigger-1070.mjs that optimistically flipped
 * status to saved_to_shopify before the worker even ran).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";

const { data, error } = await sb
  .from("jobs")
  .insert({
    shop_id: SHOP_ID,
    job_type: "save_to_shopify",
    entity_id: PACK_ID,
  })
  .select("id, status, created_at")
  .single();

if (error) {
  console.error("enqueue failed:", error);
  process.exit(1);
}

console.log("job enqueued:", data);
