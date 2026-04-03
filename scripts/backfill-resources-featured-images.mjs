/**
 * Backfill content_items.featured_image_url (+ featured_image_alt) for published
 * Resources Hub articles that are missing images.
 *
 * Uses the Pexels API (https://www.pexels.com/api/) — images served from images.pexels.com
 * (allowed in next.config.js images.remotePatterns + CSP).
 *
 * Per pillar we search once, cache photo URLs, then assign `pool[i % pool.length]` where `i`
 * is the item's index among published Resources rows in that pillar (sorted by id).
 *
 * Requires:
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PEXELS_API_KEY
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
const pexelsKey = process.env.PEXELS_API_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!pexelsKey) {
  console.error("Missing PEXELS_API_KEY (required for Pexels image search)");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

/** Pexels search query per pillar (English). */
const PILLAR_SEARCH = {
  chargebacks: "credit card payment ecommerce",
  "dispute-resolution": "business meeting handshake",
  "small-claims": "legal documents desk",
  "mediation-arbitration": "team discussion office",
  "dispute-management-software": "data dashboard laptop",
};

const DEFAULT_SEARCH = "professional office workspace";

/** @type {Map<string, { url: string; alt: string }[]>} */
const pexelsCache = new Map();

async function fetchPexelsPool(searchQuery) {
  const u = new URL("https://api.pexels.com/v1/search");
  u.searchParams.set("query", searchQuery);
  u.searchParams.set("per_page", "40");

  const res = await fetch(u.toString(), {
    headers: { Authorization: pexelsKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pexels API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const photos = data.photos ?? [];
  return photos.map((p) => {
    const src = p.src?.large || p.src?.original || p.src?.medium;
    const alt =
      (p.alt && String(p.alt).trim()) ||
      (p.photographer ? `Photo by ${p.photographer} on Pexels` : "Stock photo");
    return { url: src, alt };
  }).filter((x) => x.url && x.url.startsWith("https://images.pexels.com"));
}

async function getPoolForPillar(primaryPillar) {
  const key = primaryPillar == null ? "" : String(primaryPillar);
  if (pexelsCache.has(key)) return pexelsCache.get(key);

  const q = PILLAR_SEARCH[primaryPillar] ?? DEFAULT_SEARCH;
  const pool = await fetchPexelsPool(q);
  if (pool.length === 0) {
    throw new Error(`Pexels returned no photos for query: ${q}`);
  }
  pexelsCache.set(key, pool);
  return pool;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {Set<string>} resourceItemIds
 */
async function buildIndexInPillarById(sb, resourceItemIds) {
  const { data: rows, error } = await sb
    .from("content_items")
    .select("id, primary_pillar")
    .eq("workflow_status", "published");

  if (error) throw error;

  /** @type {Map<string, string[]>} */
  const byPillar = new Map();
  for (const row of rows ?? []) {
    if (!resourceItemIds.has(row.id)) continue;
    const k = row.primary_pillar == null ? "" : String(row.primary_pillar);
    if (!byPillar.has(k)) byPillar.set(k, []);
    byPillar.get(k).push(row.id);
  }
  for (const ids of byPillar.values()) {
    ids.sort((a, b) => String(a).localeCompare(String(b)));
  }

  /** @type {Map<string, number>} */
  const indexById = new Map();
  for (const ids of byPillar.values()) {
    ids.forEach((id, i) => indexById.set(id, i));
  }
  return indexById;
}

async function pickHero(primaryPillar, indexInPillar) {
  const pool = await getPoolForPillar(primaryPillar);
  const hero = pool[indexInPillar % pool.length];
  return hero;
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

  const indexInPillarById = await buildIndexInPillarById(sb, resourceItemIds);

  candidates.sort((a, b) => {
    const pa = String(a.primary_pillar ?? "");
    const pb = String(b.primary_pillar ?? "");
    if (pa !== pb) return pa.localeCompare(pb);
    return String(a.id).localeCompare(String(b.id));
  });

  console.log(
    `Published Resources items: ${resourceItemIds.size}, candidates to update: ${candidates.length}${force ? " (force: overwriting URLs)" : ""}${dryRun ? " (dry-run)" : ""}`
  );

  /** Prefetch distinct pillars (rate-limit friendly) */
  if (candidates.length > 0) {
    const pillars = new Set(candidates.map((c) => c.primary_pillar));
    for (const p of pillars) {
      await getPoolForPillar(p);
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  let updated = 0;
  for (const row of candidates) {
    const idx = indexInPillarById.get(row.id) ?? 0;
    const { url: imageUrl, alt } = await pickHero(row.primary_pillar, idx);
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
