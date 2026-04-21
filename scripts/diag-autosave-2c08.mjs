import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DISPUTE_ID = "2c08fc9d-aeae-47f4-a6ca-91617c42bb43";
const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const PACK_ID = "5a9d4654-2ea1-4202-9478-549292091f0c";

console.log("── shop_settings ──");
const { data: settings } = await sb
  .from("shop_settings")
  .select("*")
  .eq("shop_id", SHOP_ID)
  .single();
console.log(settings);

console.log("\n── pack detail ──");
const { data: pack } = await sb
  .from("evidence_packs")
  .select("id, status, completeness_score, blockers, submission_readiness, saved_to_shopify_at, pack_template_id")
  .eq("id", PACK_ID)
  .single();
console.log(pack);

console.log("\n── audit events for pack ──");
const { data: audit } = await sb
  .from("audit_events")
  .select("event_type, event_payload, created_at")
  .eq("pack_id", PACK_ID)
  .order("created_at", { ascending: true });
for (const a of audit ?? []) {
  console.log(`  ${a.created_at}  ${a.event_type}  ${JSON.stringify(a.event_payload).slice(0, 200)}`);
}

console.log("\n── dispute_events for dispute ──");
const { data: events } = await sb
  .from("dispute_events")
  .select("event_type, description, visibility, metadata_json, event_at")
  .eq("dispute_id", DISPUTE_ID)
  .order("event_at", { ascending: true });
for (const e of events ?? []) {
  console.log(`  ${e.event_at}  [${e.visibility}]  ${e.event_type}  ${e.description ?? ""}`);
  if (e.metadata_json) console.log(`      meta: ${JSON.stringify(e.metadata_json).slice(0, 200)}`);
}
