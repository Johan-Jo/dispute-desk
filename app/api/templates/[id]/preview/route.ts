import { NextRequest, NextResponse } from "next/server";
import { getTemplatePreview } from "@/lib/db/templates";
import { normalizeLocale, DEFAULT_LOCALE } from "@/lib/i18n/locales";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/templates/:id/preview?locale=fr-FR
 *
 * Returns full template with sections, items, and resolved i18n.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const locale =
    normalizeLocale(req.nextUrl.searchParams.get("locale")) ?? DEFAULT_LOCALE;

  const preview = await getTemplatePreview(id, locale);

  if (!preview) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json(preview);
}
