/**
 * GET /api/defence-packages/:id/listing-exhibit
 *
 * The product-listing exhibit the PDF prints (photos, excerpt, English
 * translation), for the in-app letter view. Same builder, same gate: only
 * when the package's own facts cite a collected listing. Translation is
 * read from the cache only — a page view never spends an LLM call.
 * Shop-scoped: the package's `shop_id` must match the request's shop.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { buildProductListingExhibits } from "@/lib/defence/productListingExhibit";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();
  const { data: pkg } = await sb
    .from("defence_packages")
    .select("source_pack_id, facts_json")
    .eq("id", id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const facts = Array.isArray(pkg.facts_json) ? (pkg.facts_json as Array<{ category?: string; value?: unknown }>) : [];
  const listingCited = facts.some(
    (f) => f.category === "product_listing" && (f.value as { collected?: unknown } | null)?.collected === true,
  );
  if (!listingCited || !pkg.source_pack_id) return NextResponse.json({ exhibits: [] });

  const { data: item } = await sb
    .from("evidence_items")
    .select("source, payload")
    .eq("pack_id", pkg.source_pack_id)
    .eq("source", "shopify_product")
    .limit(1)
    .maybeSingle();
  if (!item) return NextResponse.json({ exhibits: [] });

  const exhibits = await buildProductListingExhibits({
    sb,
    sections: [{ source: "shopify_product", data: item.payload as Record<string, unknown> }],
    listingCited,
    translate: async (snapshotId) => {
      if (!snapshotId) return null;
      const { data } = await sb
        .from("product_listing_translations")
        .select("title, variant_line, excerpt")
        .eq("snapshot_id", snapshotId)
        .maybeSingle();
      return data ? { title: data.title ?? null, variantLine: data.variant_line ?? null, excerpt: data.excerpt ?? null } : null;
    },
  });
  return NextResponse.json({ exhibits });
}
