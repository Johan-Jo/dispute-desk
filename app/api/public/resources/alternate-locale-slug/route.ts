import { NextRequest, NextResponse } from "next/server";
import { HUB_CONTENT_LOCALES, type HubContentLocale } from "@/lib/resources/constants";
import { isResourceHubPillar } from "@/lib/resources/pillars";
import { getAlternatePublishedResourceSlug } from "@/lib/resources/queries";

export const dynamic = "force-dynamic";

function isHubLocale(s: string): s is HubContentLocale {
  return (HUB_CONTENT_LOCALES as readonly string[]).includes(s);
}

/**
 * GET ?pillar=&slug=&from=en-US&to=fr-FR — published resources article slug in `to` locale for same item.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pillar = searchParams.get("pillar")?.trim() ?? "";
  const slug = searchParams.get("slug")?.trim() ?? "";
  const from = searchParams.get("from")?.trim() ?? "";
  const to = searchParams.get("to")?.trim() ?? "";

  if (!pillar || !slug || !from || !to) {
    return NextResponse.json({ error: "pillar, slug, from, and to are required" }, { status: 400 });
  }
  if (!isResourceHubPillar(pillar)) {
    return NextResponse.json({ error: "Invalid pillar" }, { status: 400 });
  }
  if (!isHubLocale(from) || !isHubLocale(to)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }

  try {
    const result = await getAlternatePublishedResourceSlug({
      fromLocale: from,
      toLocale: to,
      pillar,
      slug,
    });
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
