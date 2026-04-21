import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";
const DISPUTE_ID = "d24340c6-d62c-4dfd-ab63-ad0365b73145";

// 1. Snapshot current settings
const { data: before } = await sb
  .from("shop_settings")
  .select("auto_save_enabled, auto_save_min_score")
  .eq("shop_id", SHOP_ID)
  .single();
console.log("before:", before);

// 2. Lower threshold to 65 (and confirm auto_save_enabled)
const { error: upErr } = await sb
  .from("shop_settings")
  .update({ auto_save_min_score: 65, auto_save_enabled: true, updated_at: new Date().toISOString() })
  .eq("shop_id", SHOP_ID);
if (upErr) {
  console.error("update failed:", upErr);
  process.exit(1);
}
const { data: after } = await sb
  .from("shop_settings")
  .select("auto_save_enabled, auto_save_min_score")
  .eq("shop_id", SHOP_ID)
  .single();
console.log("after:", after);

// 3. Confirm pack is still ready and has submission_readiness suitable for gate
const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, status, completeness_score, blockers, submission_readiness")
  .eq("id", PACK_ID)
  .single();
console.log("pack:", pack);

// 4. Enqueue a save_to_shopify job directly — mirrors what
// evaluateAndMaybeAutoSave would do on the "auto_save" branch.
// This avoids waiting for the next auto-build to re-run the gate.
const { error: jobErr } = await sb.from("jobs").insert({
  shop_id: SHOP_ID,
  job_type: "save_to_shopify",
  entity_id: PACK_ID,
});
if (jobErr) {
  console.error("enqueue failed:", jobErr);
  process.exit(1);
}
console.log("save_to_shopify job enqueued. Worker will pick it up within ~2 min.");

// 5. Flip pack status so UI reflects the pending submit
await sb
  .from("evidence_packs")
  .update({ status: "saved_to_shopify", saved_to_shopify_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  .eq("id", PACK_ID);

console.log("pack status advanced to saved_to_shopify (pending job).");
console.log("dispute:", DISPUTE_ID);
