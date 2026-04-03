/**
 * Backfill content_items.featured_image_url (+ featured_image_alt) for published
 * Resources Hub articles that are missing images.
 *
 * Uses Unsplash hotlink URLs (allowed in next.config.js images.remotePatterns + CSP).
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/backfill-resources-featured-images.mjs           # apply updates
 *   node scripts/backfill-resources-featured-images.mjs --dry-run # print only
 *   node scripts/backfill-resources-featured-images.mjs --force   # overwrite existing URLs too
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

/** Stable Unsplash URLs (w=1200, crop) — pillar-themed stock imagery. */
const PILLAR_HERO = {
  chargebacks: {
    url: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=1200&auto=format&fit=crop&q=80",
    alt: "Retail payment terminal — chargebacks and card payments context",
  },
  "dispute-resolution": {
    url: "https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200&auto=format&fit=crop&q=80",
    alt: "Professional discussion — dispute resolution and collaboration",
  },
  "small-claims": {
    url: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1200&auto=format&fit=crop&q=80",
    alt: "Legal documents and workspace — small claims context",
  },
  "mediation-arbitration": {
    url: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1200&auto=format&fit=crop&q=80",
    alt: "Mediation and conversation — alternative dispute resolution",
  },
  "dispute-management-software": {
    url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&auto=format&fit=crop&q=80",
    alt: "Business analytics dashboard — dispute operations software",
  },
};

const DEFAULT_HERO = {
  url: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&auto=format&fit=crop&q=80",
  alt: "Desk with documents — DisputeDesk resources",
};

function heroForPillar(primaryPillar) {
  return PILLAR_HERO[primaryPillar] ?? DEFAULT_HERO;
}

const sb = createClient(url, key);

async function main() {
  const { data: locRows, error: locErr } = await sb
    .from("content_localizations")
    .select("content_item_id")
    .eq("route_kind", "resources")
    .eq("is_published", true);

  if (locErr) throw locErr;
  const resourceItemIds = new Set((locRows ?? []).map((r) => r.content_item_id));

  const { data: items, error: itemsErr } = await sb
    .from("content_items")
    .select("id, primary_pillar, featured_image_url, featured_image_alt")
    .eq("workflow_status", "published");

  if (itemsErr) throw itemsErr;

  const candidates = (items ?? []).filter((row) => {
    if (!resourceItemIds.has(row.id)) return false;
    if (force) return true;
    return !row.featured_image_url || String(row.featured_image_url).trim() === "";
  });

  console.log(
    `Published Resources items: ${resourceItemIds.size}, candidates to update: ${candidates.length}${force ? " (force: overwriting URLs)" : ""}${dryRun ? " (dry-run)" : ""}`
  );

  let updated = 0;
  for (const row of candidates) {
    const { url: imageUrl, alt } = heroForPillar(row.primary_pillar);
    const nextAlt = row.featured_image_alt?.trim() || alt;

    if (dryRun) {
      console.log(`  [dry-run] ${row.id} pillar=${row.primary_pillar} → ${imageUrl}`);
      continue;
    }

    const { error: upErr } = await sb
      .from("content_items")
      .update({
        featured_image_url: imageUrl,
        featured_image_alt: nextAlt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (upErr) {
      console.error(`  FAIL ${row.id}:`, upErr.message);
      continue;
    }
    updated += 1;
    console.log(`  OK ${row.id} (${row.primary_pillar})`);
  }

  if (!dryRun) {
    console.log(`Done. Updated ${updated} row(s).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
