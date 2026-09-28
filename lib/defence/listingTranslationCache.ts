/**
 * The cached translator the package job hands to `buildProductListingExhibits`.
 * One translation per listing snapshot, made once (Sonnet) and read back on
 * every rebuild (`product_listing_translations`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaudeMessages } from "./anthropicClient";
import { translateListing, type ListingText, type TranslateCall } from "./listingTranslation";

export const LISTING_TRANSLATION_MODEL = "claude-sonnet-4-6";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cachedListingTranslator(
  sb: SupabaseClient,
  shopId: string,
  call?: TranslateCall,
): (snapshotId: string | null, original: ListingText) => Promise<ListingText | null> {
  const model: TranslateCall =
    call ??
    (async (system, user) => {
      const r = await callClaudeMessages({
        model: LISTING_TRANSLATION_MODEL,
        system: [{ type: "text", text: system }],
        messages: [{ role: "user", content: user }],
        temperature: 0,
        maxTokens: 1500,
      });
      if (!r.raw) throw new Error(r.error ?? "empty translation");
      return r.raw;
    });

  return async (snapshotId, original) => {
    const cacheable = !!snapshotId && UUID.test(snapshotId);
    if (cacheable) {
      const { data } = await sb
        .from("product_listing_translations")
        .select("title, variant_line, excerpt")
        .eq("snapshot_id", snapshotId)
        .maybeSingle();
      if (data) return { title: data.title ?? null, variantLine: data.variant_line ?? null, excerpt: data.excerpt ?? null };
    }
    const english = await translateListing(original, model);
    if (english && cacheable) {
      await sb.from("product_listing_translations").upsert({
        snapshot_id: snapshotId,
        shop_id: shopId,
        title: english.title,
        variant_line: english.variantLine,
        excerpt: english.excerpt,
        model: LISTING_TRANSLATION_MODEL,
      });
    }
    return english;
  };
}
