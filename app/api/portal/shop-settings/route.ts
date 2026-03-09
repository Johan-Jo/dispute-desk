import { NextRequest, NextResponse } from "next/server";
import { getPortalUser } from "@/lib/supabase/portal";
import { getLinkedShops } from "@/lib/portal/activeShop";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/portal/shop-settings
 * Body: { shop_id: string, policy_template_lang?: "en" | "locale" }
 * Updates the active shop's policy template language preference.
 * User must have access to the shop.
 */
export async function PATCH(req: NextRequest) {
  const user = await getPortalUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { shop_id?: string; policy_template_lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = body.shop_id;
  const policyTemplateLang = body.policy_template_lang;

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const shops = await getLinkedShops(user.id);
  const hasAccess = shops.some((s) => s.shop_id === shopId);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ALLOWED_LANGS = ["en", "de", "fr", "es", "pt", "sv"] as const;
  if (policyTemplateLang !== undefined) {
    if (!ALLOWED_LANGS.includes(policyTemplateLang as (typeof ALLOWED_LANGS)[number])) {
      return NextResponse.json(
        { error: "policy_template_lang must be one of: en, de, fr, es, pt, sv" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();
    const { error } = await sb
      .from("shops")
      .update({
        policy_template_lang: policyTemplateLang,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shopId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
