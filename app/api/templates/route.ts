import { NextRequest, NextResponse } from "next/server";
import { listTemplates } from "@/lib/db/templates";
import { normalizeLocale, DEFAULT_LOCALE } from "@/lib/i18n/locales";

/**
 * GET /api/templates?locale=fr-FR&category=PNR
 *
 * Returns global template catalog. No shop_id required — templates are public.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const locale = normalizeLocale(searchParams.get("locale")) ?? DEFAULT_LOCALE;
  const category = searchParams.get("category") ?? undefined;

  const templates = await listTemplates(locale, category);

  return NextResponse.json({ templates });
}
