/**
 * Assign distinct structural_archetype_variant per pillar so the 3 Tier A
 * articles use different frames (Phase 2 — structural diversity mandate).
 *
 *   Pillar 1 (Chargebacks Complete) → operational_breakdown
 *   Pillar 2 (Evidence Guide)        → evidence_deep_dive
 *   Pillar 3 (Fraud Chargebacks)     → merchant_failure_analysis
 *
 * Variant lives in the archive item's notes JSON. The system prompt + tier
 * archetype block read it and pick the corresponding structural frame.
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

const ASSIGNMENTS = [
  {
    slug: "shopify-chargebacks-complete-merchant-guide",
    variant: "operational_breakdown",
    rationale:
      "Broad operational topic — workflow lifecycle from inquiry to outcome, where it breaks, what to do.",
  },
  {
    slug: "chargeback-evidence-guide-shopify-merchants",
    variant: "evidence_deep_dive",
    rationale:
      "Single category focus — evidence types analyzed comparatively, with operational interpretation per type.",
  },
  {
    slug: "shopify-fraud-chargebacks-explained",
    variant: "merchant_failure_analysis",
    rationale:
      "Sharp, corrective tone — why merchants lose fraud cases, false assumptions, weak evidence myths.",
  },
];

for (const a of ASSIGNMENTS) {
  const { data: row, error: getErr } = await sb
    .from("content_archive_items")
    .select("id, notes")
    .eq("proposed_slug", a.slug)
    .maybeSingle();
  if (getErr || !row) {
    console.error(`Lookup failed for ${a.slug}: ${getErr?.message ?? "no row"}`);
    process.exit(1);
  }

  let notesObj = {};
  try {
    notesObj = row.notes ? JSON.parse(row.notes) : {};
  } catch {
    notesObj = {};
  }
  notesObj.structural_archetype_variant = a.variant;
  notesObj.structural_archetype_rationale = a.rationale;

  const { error: updErr } = await sb
    .from("content_archive_items")
    .update({
      notes: JSON.stringify(notesObj, null, 2),
      // Reset for regen.
      status: "brief_ready",
      created_from_archive_to_content_item_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (updErr) {
    console.error(`Update failed for ${a.slug}: ${updErr.message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${a.slug.padEnd(50)} → variant=${a.variant}`);
}
