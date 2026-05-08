/**
 * Cleanup before regen.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DELETE_IDS = [
  "8eb0a1e1-b9d9-4dc3-b217-95c21a80aede",
  "b56138d8-409b-4a5f-8f23-dd22d9671062",
  "681a5c2d-ca52-4973-ac93-af4a02ab140f",
];

for (const id of DELETE_IDS) {
  const { data: locs } = await sb
    .from("content_localizations")
    .select("id")
    .eq("content_item_id", id);
  await sb
    .from("content_publish_queue")
    .delete()
    .in("content_localization_id", locs?.map((r) => r.id) ?? []);
  await sb.from("content_localizations").delete().eq("content_item_id", id);
  await sb.from("content_revisions").delete().eq("content_item_id", id);
  await sb.from("content_item_tags").delete().eq("content_item_id", id);
  const { error } = await sb.from("content_items").delete().eq("id", id);
  if (error) console.error(`  ✗ ${id}: ${error.message}`);
  else console.log(`  ✓ deleted content_item ${id}`);
}

const { error: archErr } = await sb
  .from("content_archive_items")
  .update({
    status: "brief_ready",
    created_from_archive_to_content_item_id: null,
    updated_at: new Date().toISOString(),
  })
  .in("proposed_slug", [
    "shopify-chargebacks-complete-merchant-guide",
    "chargeback-evidence-guide-shopify-merchants",
    "shopify-fraud-chargebacks-explained",
  ]);
if (archErr) console.error(`Archive reset failed: ${archErr.message}`);
else console.log("\nReset all 3 pillar archive items to brief_ready.");
