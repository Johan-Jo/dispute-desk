import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PACK_ID = "5a9d4654-2ea1-4202-9478-549292091f0c";
const DISPUTE_ID = "2c08fc9d-aeae-47f4-a6ca-91617c42bb43";
const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";

const now = new Date().toISOString();

// Mark pack as saved_to_shopify (pending job run)
const { error: upErr } = await sb
  .from("evidence_packs")
  .update({ status: "saved_to_shopify", saved_to_shopify_at: now, updated_at: now })
  .eq("id", PACK_ID);
if (upErr) { console.error(upErr); process.exit(1); }

// Enqueue save_to_shopify job
const { data: job, error: jobErr } = await sb
  .from("jobs")
  .insert({ shop_id: SHOP_ID, job_type: "save_to_shopify", entity_id: PACK_ID })
  .select("id")
  .single();
if (jobErr) { console.error(jobErr); process.exit(1); }
console.log("enqueued job", job.id);

// Audit + dispute event so timeline reflects the retriggered save
await sb.from("audit_events").insert({
  shop_id: SHOP_ID,
  dispute_id: DISPUTE_ID,
  pack_id: PACK_ID,
  actor_type: "system",
  event_type: "auto_save_enqueued",
  event_payload: {
    reason: "rule_override_retrigger",
    note: "retriggered after rules-vs-review-gate fix",
  },
});

await sb.from("dispute_events").insert({
  dispute_id: DISPUTE_ID,
  shop_id: SHOP_ID,
  event_type: "auto_save_triggered",
  description: "Auto-save triggered after rules fix",
  event_at: now,
  actor_type: "disputedesk_system",
  source_type: "pack_engine",
  metadata_json: { pack_id: PACK_ID, retrigger: true },
  dedupe_key: `${DISPUTE_ID}:auto_save_triggered:${PACK_ID}:retrigger`,
});

console.log("done — save_to_shopify job enqueued for pack", PACK_ID);
