/**
 * Delete previous Tier A pillar content_items so slug collisions don't block
 * regeneration. Keeps the most recent successful pillar 2 (124ef967-...).
 *
 * Cleanup target: any content_localizations whose slug matches the 3 pillar
 * slugs from the briefs. We delete the localizations + their parent content_items
 * + any related publish_queue entries.
 *
 * Safe because: all of these are at workflow_status='in-editorial-review',
 * never published. Deleting them does not affect public URLs.
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

const KEEP_CONTENT_ITEM_IDS = new Set([
  "124ef967-cd80-4831-ae7b-39c1c5f5a8f1", // latest pillar 2 (Phase 2 evidence_deep_dive)
]);

const PILLAR_SLUGS = [
  "shopify-chargebacks-complete-merchant-guide",
  "chargeback-evidence-guide-shopify-merchants",
  "shopify-fraud-chargebacks-explained",
  // Phase-1 model-invented slugs we want to clear:
  "shopify-chargeback-evidence-guide",
  "shopify-chargebacks-dispute-strategies",
  "winning-shopify-chargebacks-evidence-tactics",
  "decoding-shopify-fraud-chargebacks",
];

const { data: locs, error: locErr } = await sb
  .from("content_localizations")
  .select("id, slug, content_item_id, content_items!inner(workflow_status)")
  .in("slug", PILLAR_SLUGS);

if (locErr) {
  console.error(`Lookup failed: ${locErr.message}`);
  process.exit(1);
}

const itemIdsToDelete = new Set();
for (const loc of locs ?? []) {
  if (KEEP_CONTENT_ITEM_IDS.has(loc.content_item_id)) continue;
  const item = Array.isArray(loc.content_items) ? loc.content_items[0] : loc.content_items;
  if (item?.workflow_status === "published") {
    console.log(`  ⊘ skip published: ${loc.slug} (item ${loc.content_item_id})`);
    continue;
  }
  itemIdsToDelete.add(loc.content_item_id);
}

console.log(`Found ${locs?.length ?? 0} localizations matching pillar slugs.`);
console.log(`Deleting ${itemIdsToDelete.size} content_items (and their localizations + queue entries).`);

for (const id of itemIdsToDelete) {
  // Order matters: queue → localizations → revisions → tags → item.
  await sb.from("content_publish_queue").delete().in(
    "content_localization_id",
    (await sb.from("content_localizations").select("id").eq("content_item_id", id)).data?.map((r) => r.id) ?? []
  );
  await sb.from("content_localizations").delete().eq("content_item_id", id);
  await sb.from("content_revisions").delete().eq("content_item_id", id);
  await sb.from("content_item_tags").delete().eq("content_item_id", id);
  const { error } = await sb.from("content_items").delete().eq("id", id);
  if (error) {
    console.error(`  ✗ failed to delete ${id}: ${error.message}`);
  } else {
    console.log(`  ✓ deleted content_item ${id}`);
  }
}

// Also reset the archive rows so they can be re-picked.
const { error: archErr } = await sb
  .from("content_archive_items")
  .update({
    status: "brief_ready",
    created_from_archive_to_content_item_id: null,
    updated_at: new Date().toISOString(),
  })
  .in("proposed_slug", [
    "shopify-chargebacks-complete-merchant-guide",
    "shopify-fraud-chargebacks-explained",
  ]);
if (archErr) {
  console.error(`Archive reset failed: ${archErr.message}`);
}
console.log("\nReset pillar 1 + pillar 3 archive items to brief_ready.");
console.log("Pillar 2 (124ef967-...) preserved.");
