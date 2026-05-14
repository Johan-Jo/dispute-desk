/**
 * One-shot: flip a pack from `saved_to_shopify*` back to `ready` so the
 * merchant can re-save with new file evidence. Use only for testing —
 * the proper fix is in lib/jobs/handlers/saveToShopifyJob.ts +
 * app/api/packs/[packId]/save-to-shopify/route.ts.
 */
import { getServiceClient } from "./lib/supabase.mjs";

const packId = process.argv[2] || "eb7c527a-ac49-4fb4-bccd-51a408c285ba";
const sb = getServiceClient();

const { data: before } = await sb
  .from("evidence_packs")
  .select("id, status")
  .eq("id", packId)
  .single();
console.log("Before:", before);

const { error } = await sb
  .from("evidence_packs")
  .update({ status: "ready", updated_at: new Date().toISOString() })
  .eq("id", packId);
if (error) {
  console.error("update failed:", error.message);
  process.exit(1);
}

const { data: after } = await sb
  .from("evidence_packs")
  .select("id, status")
  .eq("id", packId)
  .single();
console.log("After:", after);
