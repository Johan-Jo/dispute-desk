import { NextRequest, NextResponse } from "next/server";
import { listPacks, createPack } from "@/lib/db/packs";
import { getServiceClient } from "@/lib/supabase/server";
import { normalizeLocale, DEFAULT_LOCALE } from "@/lib/i18n/locales";

/**
 * GET /api/packs?shopId=...&status=DRAFT&q=search
 *
 * Lists all packs for a shop from the new `packs` table.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  // Embedded UI calls this without relying on reading httpOnly cookies in the browser.
  // The embedded middleware forwards the per-request shop id via `x-shop-id`.
  const shopId =
    searchParams.get("shopId") ??
    req.headers.get("x-shop-id") ??
    req.cookies.get("shopify_shop_id")?.value ??
    null;

  if (!shopId) {
    return NextResponse.json({ error: "shopId required" }, { status: 400 });
  }

  const packs = await listPacks(shopId, {
    status: searchParams.get("status") ?? undefined,
    search: searchParams.get("q") ?? undefined,
  });

  // Resolve localized template names for template-based packs
  const locale = normalizeLocale(searchParams.get("locale")) ?? DEFAULT_LOCALE;
  const templateIds = [...new Set(packs.filter((p) => p.template_id).map((p) => p.template_id as string))];

  if (templateIds.length > 0) {
    const sb = getServiceClient();
    const { data: i18nRows } = await sb
      .from("pack_template_i18n")
      .select("template_id, locale, name")
      .in("template_id", templateIds);

    if (i18nRows && i18nRows.length > 0) {
      const byTemplate = new Map<string, Array<{ locale: string; name: string }>>();
      for (const row of i18nRows) {
        const list = byTemplate.get(row.template_id) ?? [];
        list.push({ locale: row.locale, name: row.name });
        byTemplate.set(row.template_id, list);
      }

      for (const pack of packs) {
        if (!pack.template_id) continue;
        const rows = byTemplate.get(pack.template_id);
        if (!rows) continue;
        const baseLang = locale.split("-")[0];
        const exact = rows.find((r) => r.locale === locale);
        const base = rows.find((r) => r.locale.split("-")[0] === baseLang);
        const en = rows.find((r) => r.locale === DEFAULT_LOCALE);
        const resolved = exact ?? base ?? en ?? rows[0];
        if (resolved) pack.name = resolved.name;
      }
    }
  }

  return NextResponse.json({ packs });
}

/**
 * POST /api/packs
 *
 * Body: { shopId, name, disputeType, code? }
 *
 * Creates a manual pack (source = MANUAL).
 */
export async function POST(req: NextRequest) {
  let body: { shopId?: string; name?: string; disputeType?: string; code?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const shopId =
    body.shopId ??
    req.headers.get("x-shop-id") ??
    req.cookies.get("shopify_shop_id")?.value ??
    null;

  if (!shopId || !body.name || !body.disputeType) {
    return NextResponse.json(
      { error: "shopId, name, and disputeType are required" },
      { status: 400 }
    );
  }

  const pack = await createPack(shopId, {
    name: body.name,
    disputeType: body.disputeType,
    code: body.code,
    description: body.description,
  });

  if (!pack) {
    return NextResponse.json(
      { error: "Failed to create pack" },
      { status: 500 }
    );
  }

  return NextResponse.json(pack, { status: 201 });
}
