import { NextRequest, NextResponse } from "next/server";
import { listTemplates } from "@/lib/db/templates";
import { normalizeLocale, DEFAULT_LOCALE } from "@/lib/i18n/locales";

const REASON_TO_CATEGORY: Record<string, string> = {
  FRAUDULENT: "fraud",
  FRAUD: "fraud",
  PRODUCT_NOT_RECEIVED: "not_received",
  PNR: "not_received",
  PRODUCT_UNACCEPTABLE: "unacceptable",
  NOT_AS_DESCRIBED: "unacceptable",
  DUPLICATE: "duplicate",
  SUBSCRIPTION_CANCELED: "subscription",
  SUBSCRIPTION: "subscription",
  CREDIT_NOT_PROCESSED: "credit",
  REFUND: "credit",
};

/**
 * GET /api/templates?locale=fr-FR&category=PNR&reason=FRAUDULENT
 *
 * Returns global template catalog. No shop_id required — templates are public.
 * If ?reason= is provided (Shopify dispute reason), maps it to a category automatically.
 * Explicit ?category= takes precedence over ?reason=.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const locale = normalizeLocale(searchParams.get("locale")) ?? DEFAULT_LOCALE;
  const explicitCategory = searchParams.get("category") ?? undefined;
  const reason = searchParams.get("reason") ?? undefined;
  const category =
    explicitCategory ??
    (reason ? REASON_TO_CATEGORY[reason.toUpperCase()] : undefined);

  const templates = await listTemplates(locale, category);

  return NextResponse.json({ templates });
}
