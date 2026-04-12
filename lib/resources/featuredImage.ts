import "server-only";

import { getServiceClient } from "@/lib/supabase/server";
import type { ResourceHubPillar } from "./pillars";

const PILLAR_QUERIES: Record<string, string[]> = {
  chargebacks: [
    "retail store interior shopping",
    "warehouse shipping boxes",
    "customer service representative office",
    "small business storefront",
    "paperwork folder desk organized",
    "delivery package doorstep",
    "bank building architecture",
    "calendar deadline planning",
  ],
  "dispute-resolution": [
    "business handshake agreement",
    "two professionals meeting coffee",
    "negotiation office window light",
    "signing document pen desk",
    "team collaboration table",
    "listening conversation",
    "handshake silhouette sunset",
    "sticky notes planning wall",
  ],
  "small-claims": [
    "courthouse building exterior",
    "law books shelf library",
    "wooden gavel justice",
    "organized files cabinet",
    "community town hall",
    "legal consultation office",
    "paper stack organized",
    "scales justice bronze",
  ],
  "mediation-arbitration": [
    "round table meeting discussion",
    "mediation calm office",
    "whiteboard team brainstorming",
    "people talking sofa office",
    "facilitator meeting",
    "conflict resolution teamwork",
    "neutral office plants",
    "group discussion diverse",
  ],
  "dispute-management-software": [
    "abstract technology network blue",
    "automation workflow diagram",
    "cloud computing abstract",
    "minimal desk plant workspace",
    "data chart printout paper",
    "server room blue lights",
    "productivity organization desk",
    "digital transformation abstract",
  ],
};

const DEFAULT_QUERIES = [
  "professional workspace natural light",
  "business team diverse office",
  "modern office plants",
  "entrepreneur planning notebook",
];

interface PexelsPhoto {
  src: Record<string, string>;
  alt?: string;
  photographer?: string;
}

function photoToHero(p: PexelsPhoto): { url: string; alt: string } | null {
  const raw =
    p.src?.large2x || p.src?.original || p.src?.large || p.src?.medium;
  const alt =
    (p.alt && String(p.alt).trim()) ||
    (p.photographer ? `Photo by ${p.photographer} on Pexels` : "Stock photo");
  if (!raw || !String(raw).startsWith("https://images.pexels.com")) return null;
  try {
    const u = new URL(raw);
    u.searchParams.set("w", "1920");
    u.searchParams.delete("h");
    u.searchParams.delete("dpr");
    return { url: u.toString(), alt };
  } catch {
    return { url: raw, alt };
  }
}

async function fetchPexelsPhotos(
  query: string,
  apiKey: string,
): Promise<{ url: string; alt: string }[]> {
  const u = new URL("https://api.pexels.com/v1/search");
  u.searchParams.set("query", query);
  u.searchParams.set("per_page", "15");
  u.searchParams.set("page", "1");

  const res = await fetch(u.toString(), {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { photos?: PexelsPhoto[] };
  const out: { url: string; alt: string }[] = [];
  for (const p of data.photos ?? []) {
    const h = photoToHero(p);
    if (h) out.push(h);
  }
  return out;
}

/**
 * Pick a random query from the pillar's pool, fetch a page from Pexels,
 * and return the first usable result. Lightweight — only 1 API call.
 */
async function pickImageForPillar(
  pillar: string,
): Promise<{ url: string; alt: string } | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn("[featuredImage] PEXELS_API_KEY not set — skipping auto-image");
    return null;
  }

  const queries = PILLAR_QUERIES[pillar] ?? DEFAULT_QUERIES;
  const query = queries[Math.floor(Math.random() * queries.length)];
  const photos = await fetchPexelsPhotos(query, apiKey);
  if (photos.length === 0) return null;

  // Pick a random photo from results to avoid every article getting the same one
  return photos[Math.floor(Math.random() * photos.length)];
}

/**
 * Ensures a content_item has a featured_image_url. If missing, fetches one
 * from Pexels based on the item's pillar. Returns true if an image was assigned.
 *
 * Safe to call multiple times — no-ops when image already exists.
 */
export async function ensureFeaturedImage(
  contentItemId: string,
  pillar: ResourceHubPillar,
): Promise<boolean> {
  const sb = getServiceClient();

  const { data: item } = await sb
    .from("content_items")
    .select("featured_image_url")
    .eq("id", contentItemId)
    .maybeSingle();

  if (
    item?.featured_image_url &&
    typeof item.featured_image_url === "string" &&
    item.featured_image_url.trim().length > 0
  ) {
    return false; // already has an image
  }

  const hero = await pickImageForPillar(pillar);
  if (!hero) return false;

  const { error } = await sb
    .from("content_items")
    .update({
      featured_image_url: hero.url,
      featured_image_alt: hero.alt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contentItemId);

  if (error) {
    console.error("[featuredImage] Failed to assign image:", error.message);
    return false;
  }

  console.log(`[featuredImage] Assigned image to ${contentItemId} (${pillar})`);
  return true;
}
