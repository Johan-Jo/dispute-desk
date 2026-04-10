import { NextRequest, NextResponse } from "next/server";
import { listTemplates } from "@/lib/db/templates";
import { normalizeLocale, DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { getServiceClient } from "@/lib/supabase/server";
import type { DisputePhase } from "@/lib/rules/disputeReasons";

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
 * GET /api/templates?locale=fr-FR&category=PNR&reason=FRAUDULENT&phase=inquiry
 *
 * Returns global template catalog. No shop_id required — templates are public.
 * If ?reason= is provided (Shopify dispute reason), maps it to a category automatically.
 * Explicit ?category= takes precedence over ?reason=.
 *
 * When ?phase= and ?reason= are both provided, queries reason_template_mappings
 * for a mapped default template and prioritizes it in results.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const locale = normalizeLocale(searchParams.get("locale")) ?? DEFAULT_LOCALE;
  const explicitCategory = searchParams.get("category") ?? undefined;
  const reason = searchParams.get("reason") ?? undefined;
  const phase = searchParams.get("phase") as DisputePhase | null;
  const category =
    explicitCategory ??
    (reason ? REASON_TO_CATEGORY[reason.toUpperCase()] : undefined);

  const templates = await listTemplates(locale, category);

  // Phase-aware: if phase + reason provided, look up the default mapping
  // and promote the mapped template to the top of results.
  if (phase && reason && templates.length > 0) {
    const mappedTemplateId = await getMappedTemplateId(
      reason.toUpperCase(),
      phase,
    );
    if (mappedTemplateId) {
      const idx = templates.findIndex((t) => t.id === mappedTemplateId);
      if (idx > 0) {
        // Move mapped template to front
        const [mapped] = templates.splice(idx, 1);
        templates.unshift(mapped);
      }
    }
  }

  return NextResponse.json({ templates });
}

/**
 * Query reason_template_mappings for the default template for a phase + reason.
 * Returns the template_id if one is mapped and active, or null.
 */
async function getMappedTemplateId(
  reasonCode: string,
  phase: DisputePhase,
): Promise<string | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("reason_template_mappings")
    .select("template_id")
    .eq("reason_code", reasonCode)
    .eq("dispute_phase", phase)
    .eq("is_active", true)
    .maybeSingle();
  return data?.template_id ?? null;
}
