import { NextRequest, NextResponse } from "next/server";
import { installTemplate } from "@/lib/db/packs";
import { getServiceClient } from "@/lib/supabase/server";
import { CHARGEBACK_TO_INQUIRY_TEMPLATE } from "@/lib/setup/recommendTemplates";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Silently install the inquiry-phase sibling of a chargeback template, if any.
 * Skips the insert if this shop already has a library pack for that inquiry
 * template (active or draft), so repeated installs stay idempotent.
 */
async function installInquiryPairIfNeeded(
  chargebackTemplateId: string,
  shopId: string,
  activate: boolean
): Promise<void> {
  const inquiryTemplateId = CHARGEBACK_TO_INQUIRY_TEMPLATE[chargebackTemplateId];
  if (!inquiryTemplateId) return;

  const sb = getServiceClient();
  const { data: existing } = await sb
    .from("packs")
    .select("id")
    .eq("shop_id", shopId)
    .eq("template_id", inquiryTemplateId)
    .in("status", ["ACTIVE", "DRAFT"])
    .limit(1);

  if (existing && existing.length > 0) return;

  const paired = await installTemplate(inquiryTemplateId, shopId, { activate });
  if (!paired) {
    console.warn("[templates/install] inquiry pair failed to install", {
      chargebackTemplateId,
      inquiryTemplateId,
      shopId,
    });
  }
}

/**
 * POST /api/templates/:id/install
 *
 * Body: { shopId: string, overrides?: { name?: string }, activate?: boolean }
 *
 * Creates a new pack from the global template for the given shop. When the
 * template is a chargeback variant with a matching inquiry sibling (see
 * `CHARGEBACK_TO_INQUIRY_TEMPLATE`), the inquiry pair is silently installed
 * alongside it so pre-chargeback inquiries are automatically covered.
 * Set `activate: true` when the user finished the setup "Activate" step
 * (e.g. onboarding wizard) so the library packs are ACTIVE instead of DRAFT.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  let body: { shopId?: string; overrides?: { name?: string }; activate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Embedded UI calls this without relying on reading httpOnly cookies in the browser.
  // The embedded middleware forwards the per-request shop id via `x-shop-id`.
  const shopId =
    body.shopId ??
    req.headers.get("x-shop-id") ??
    req.cookies.get("shopify_shop_id")?.value ??
    null;
  if (!shopId) {
    return NextResponse.json({ error: "shopId is required" }, { status: 400 });
  }

  const activate = body.activate === true;
  const pack = await installTemplate(id, shopId, {
    ...body.overrides,
    activate,
  });

  if (!pack) {
    return NextResponse.json(
      { error: "Failed to install template. Template may not exist." },
      { status: 500 }
    );
  }

  // Silent pairing: install matching inquiry template so pre-chargeback
  // inquiries are covered without the merchant having to know or click.
  await installInquiryPairIfNeeded(id, shopId, activate);

  return NextResponse.json(pack, { status: 201 });
}
