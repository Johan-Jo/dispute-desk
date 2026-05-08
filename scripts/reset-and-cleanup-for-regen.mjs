/**
 * Aggressive pre-regen cleanup. Deletes ALL content_items that match the
 * 3 pillar topics and are in editorial review, plus their localizations,
 * publish queue entries, revisions, and tags. Then resets the 3 archive
 * items to brief_ready.
 *
 * This avoids the slug-collision failure mode where a stale row from a
 * previous regen blocks a fresh slug.
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

const PILLAR_SLUGS = [
  "shopify-chargebacks-complete-merchant-guide",
  "chargeback-evidence-guide-shopify-merchants",
  "shopify-fraud-chargebacks-explained",
];

// Pull every content_item with primary_pillar in the 3 pillar pillars,
// workflow_status in-editorial-review (i.e. not yet published).
const PILLARS = ["chargebacks", "evidence", "fraud"];
const { data: candidates, error: candErr } = await sb
  .from("content_items")
  .select("id, primary_pillar, workflow_status, generated_at")
  .in("primary_pillar", PILLARS)
  .eq("workflow_status", "in-editorial-review");

if (candErr) {
  console.error(`Lookup failed: ${candErr.message}`);
  process.exit(1);
}

console.log(`Found ${candidates?.length ?? 0} in-editorial-review candidate items.`);

const idsToDelete = (candidates ?? []).map((c) => c.id);

for (const id of idsToDelete) {
  const { data: locs } = await sb
    .from("content_localizations")
    .select("id, slug")
    .eq("content_item_id", id);
  const slugs = (locs ?? []).map((l) => l.slug);
  await sb
    .from("content_publish_queue")
    .delete()
    .in("content_localization_id", locs?.map((r) => r.id) ?? []);
  await sb.from("content_localizations").delete().eq("content_item_id", id);
  await sb.from("content_revisions").delete().eq("content_item_id", id);
  await sb.from("content_item_tags").delete().eq("content_item_id", id);
  const { error } = await sb.from("content_items").delete().eq("id", id);
  if (error) {
    console.error(`  ✗ ${id}: ${error.message}`);
  } else {
    console.log(`  ✓ deleted content_item ${id} (slugs: ${slugs.join(", ") || "none"})`);
  }
}

// Belt-and-suspenders: delete any orphan localization rows whose slugs
// match patterns we've seen the model invent, even if we missed the parent.
const ORPHAN_SLUG_PATTERNS = [
  "%shopify-chargeback%",
  "%winning-shopify%",
  "%fraud-chargeback%",
  "%avs-y%",
  "%operational-mastery%",
  "%why-fraud%",
];
for (const pat of ORPHAN_SLUG_PATTERNS) {
  const { data: orphans } = await sb
    .from("content_localizations")
    .select("id, slug, content_item_id")
    .ilike("slug", pat);
  for (const o of orphans ?? []) {
    // Only delete if the parent content_item is also gone or in editorial review.
    const { data: parent } = await sb
      .from("content_items")
      .select("id, workflow_status")
      .eq("id", o.content_item_id)
      .maybeSingle();
    if (!parent || parent.workflow_status === "in-editorial-review") {
      await sb.from("content_localizations").delete().eq("id", o.id);
      console.log(`  ✓ deleted orphan localization ${o.slug}`);
    }
  }
}

const { error: archErr } = await sb
  .from("content_archive_items")
  .update({
    status: "brief_ready",
    created_from_archive_to_content_item_id: null,
    updated_at: new Date().toISOString(),
  })
  .in("proposed_slug", PILLAR_SLUGS);
if (archErr) console.error(`Archive reset failed: ${archErr.message}`);
else console.log("\nReset all 3 pillar archive items to brief_ready.");
