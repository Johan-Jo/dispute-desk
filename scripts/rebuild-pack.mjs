/**
 * Rebuild an evidence pack by re-enqueuing a build_pack job.
 *
 * Usage: node scripts/rebuild-pack.mjs <dispute-id>
 *
 * Requires .env.local with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const disputeId = process.argv[2];
if (!disputeId) {
  console.error("Usage: node scripts/rebuild-pack.mjs <dispute-id>");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // Find the latest pack for this dispute
  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, shop_id, status")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (packErr || !pack) {
    console.error("No pack found for dispute", disputeId, packErr?.message);
    process.exit(1);
  }

  console.log(`Pack: ${pack.id} (status: ${pack.status})`);

  // Delete old evidence_items so the rebuild starts fresh
  const { count: deletedItems } = await sb
    .from("evidence_items")
    .delete({ count: "exact" })
    .eq("pack_id", pack.id);
  console.log(`Deleted ${deletedItems ?? 0} old evidence_items`);

  // Delete old argument_maps so they regenerate
  const { count: deletedArgs } = await sb
    .from("argument_maps")
    .delete({ count: "exact" })
    .eq("pack_id", pack.id);
  console.log(`Deleted ${deletedArgs ?? 0} old argument_maps`);

  // Reset pack status to queued
  await sb
    .from("evidence_packs")
    .update({
      status: "queued",
      completeness_score: null,
      checklist: null,
      checklist_v2: null,
      blockers: null,
      recommended_actions: null,
      submission_readiness: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", pack.id);
  console.log("Pack status reset to 'queued'");

  // Enqueue build_pack job
  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_pack",
    entity_id: pack.id,
  });

  if (jobErr) {
    console.error("Failed to enqueue job:", jobErr.message);
    process.exit(1);
  }

  console.log("build_pack job enqueued. The job runner will pick it up shortly.");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
