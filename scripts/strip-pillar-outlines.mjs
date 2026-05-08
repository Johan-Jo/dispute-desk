/**
 * Strip the prescriptive `outline` array from the 3 Tier A pillar archive
 * items' notes JSON. The outline was forcing the model to mirror a
 * heading-by-heading skeleton — Phase 2's frame guidance can't beat an
 * explicit list. Topical context (audience, shopify_specifics, must_cover)
 * stays.
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

const SLUGS = [
  "shopify-chargebacks-complete-merchant-guide",
  "chargeback-evidence-guide-shopify-merchants",
  "shopify-fraud-chargebacks-explained",
];

for (const slug of SLUGS) {
  const { data: row, error: getErr } = await sb
    .from("content_archive_items")
    .select("id, notes")
    .eq("proposed_slug", slug)
    .maybeSingle();
  if (getErr || !row) {
    console.error(`${slug}: ${getErr?.message ?? "no row"}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = row.notes ? JSON.parse(row.notes) : {};
  } catch {
    parsed = {};
  }
  delete parsed.outline;
  // Keep structural_archetype_variant if previously set by assign-pillar-frames

  const { error: updErr } = await sb
    .from("content_archive_items")
    .update({
      notes: JSON.stringify(parsed, null, 2),
      status: "brief_ready",
      created_from_archive_to_content_item_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (updErr) {
    console.error(`${slug} update failed: ${updErr.message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${slug.padEnd(50)} → outline removed`);
}
