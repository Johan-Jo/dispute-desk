import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

const ALLOWED_LANGS = ["en", "de", "fr", "es", "pt", "sv"] as const;
type AllowedLang = (typeof ALLOWED_LANGS)[number];

/**
 * GET /api/shop/policy-template-lang?shop_id=...
 * Returns the shop's current policy_template_lang.
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl?.searchParams?.get("shop_id") ?? null;
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("shops")
    .select("policy_template_lang, locale")
    .eq("id", shopId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Derive the 2-letter "local" language hint from the shop's BCP-47 locale.
  // `locale` is stored as BCP-47 (e.g. "pt-BR"); templates are keyed by 2 letters.
  const bcp47 = (data?.locale as string | null) ?? null;
  const localShort = bcp47 ? bcp47.split("-")[0]?.toLowerCase() ?? null : null;
  const LOCAL_SUPPORTED = ["de", "fr", "es", "pt", "sv"] as const;
  const localLang = localShort && LOCAL_SUPPORTED.includes(localShort as (typeof LOCAL_SUPPORTED)[number])
    ? localShort
    : null;

  return NextResponse.json({
    policy_template_lang: data?.policy_template_lang ?? "en",
    local_lang: localLang,
  });
}

/**
 * PATCH /api/shop/policy-template-lang
 * Body: { shop_id, policy_template_lang }
 * Updates the active shop's policy template language. Used by the embedded
 * onboarding wizard (same trust model as /api/policies/apply).
 */
export async function PATCH(req: NextRequest) {
  let body: { shop_id?: string; policy_template_lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = body.shop_id;
  const lang = body.policy_template_lang;

  if (!shopId || !lang) {
    return NextResponse.json(
      { error: "shop_id and policy_template_lang are required" },
      { status: 400 }
    );
  }

  if (!ALLOWED_LANGS.includes(lang as AllowedLang)) {
    return NextResponse.json(
      { error: `policy_template_lang must be one of: ${ALLOWED_LANGS.join(", ")}` },
      { status: 400 }
    );
  }

  const sb = getServiceClient();
  const { error } = await sb
    .from("shops")
    .update({
      policy_template_lang: lang,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shopId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, policy_template_lang: lang });
}
