import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { POLICY_TYPES, type PolicyTemplateType } from "@/lib/policy-templates/library";
import { getServiceClient } from "@/lib/supabase/server";
import { fetchShopDetails, applyShopPlaceholders } from "@/lib/shopify/shopDetails";

const VALID_TYPES = POLICY_TYPES;
const FILE_MAP: Record<PolicyTemplateType, string> = {
  terms: "terms-of-service.md",
  refunds: "refund-policy.md",
  shipping: "shipping-policy.md",
  privacy: "privacy-policy.md",
  contact: "contact-customer-service-policy.md",
};

/** Languages that have a content subfolder. English uses root. */
const TRANSLATED_LANGS = ["de", "fr", "es", "pt", "sv"] as const;

function applyDomainFallbackPlaceholders(content: string, shopDomain: string): string {
  const safeDomain = shopDomain.trim().toLowerCase();
  const storeName = safeDomain.replace(/\.myshopify\.com$/i, "").replace(/[-_]/g, " ");
  const supportEmail = `support@${safeDomain}`;
  return content
    .replace(/\[Store Name\]/g, storeName || "[Store Name]")
    .replace(/\[Legal Company Name\]/g, storeName || "[Legal Company Name]")
    .replace(/\[Support Email\]/g, supportEmail)
    .replace(/\[Privacy Email \/ Support Email\]/g, supportEmail)
    .replace(/\[Privacy Email\]/g, supportEmail);
}

/**
 * GET /api/policy-templates/[type]/content
 * Query: shop_id (optional). If present, uses shop's policy_template_lang to serve
 * content in that language (en = root, de/fr/es/pt/sv = subfolder when available).
 * User chooses the language in Settings (e.g. English even when UI locale is German).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;
  if (!VALID_TYPES.includes(type as PolicyTemplateType)) {
    return NextResponse.json({ error: "Invalid template type" }, { status: 400 });
  }

  const filename = FILE_MAP[type as PolicyTemplateType];
  const baseDir = join(process.cwd(), "content", "policy-templates");
  let contentLang: string | null = null;

  const shopId = req.nextUrl?.searchParams?.get("shop_id") ?? null;
  if (shopId) {
    const sb = getServiceClient();
    const { data: shop } = await sb
      .from("shops")
      .select("policy_template_lang")
      .eq("id", shopId)
      .single();

    const pref = shop?.policy_template_lang;
    if (pref && pref !== "en" && TRANSLATED_LANGS.includes(pref as (typeof TRANSLATED_LANGS)[number])) {
      contentLang = pref;
    }
  }

  let path: string;
  if (contentLang) {
    const translatedPath = join(baseDir, contentLang, filename);
    if (existsSync(translatedPath)) {
      path = translatedPath;
    } else {
      path = join(baseDir, filename);
    }
  } else {
    path = join(baseDir, filename);
  }

  try {
    let body = await readFile(path, "utf-8");

    // Best-effort placeholder substitution. Never block template loading if
    // Shopify/session lookup fails; return raw template instead.
    if (shopId) {
      try {
        const shopDetails = await fetchShopDetails(shopId);
        if (shopDetails) {
          body = applyShopPlaceholders(body, shopDetails);
        } else {
          const sb = getServiceClient();
          const { data: shop } = await sb
            .from("shops")
            .select("shop_domain")
            .eq("id", shopId)
            .maybeSingle();
          if (shop?.shop_domain && /\.myshopify\.com$/i.test(shop.shop_domain)) {
            body = applyDomainFallbackPlaceholders(body, shop.shop_domain);
          }
        }
      } catch (shopErr) {
        console.warn("[policy-templates/content] placeholder substitution skipped", {
          shopId,
          reason: shopErr instanceof Error ? shopErr.message : String(shopErr),
        });
      }
    }

    return NextResponse.json({ body });
  } catch (err) {
    console.error("[policy-templates/content]", err);
    return NextResponse.json(
      { error: "Template not found" },
      { status: 404 }
    );
  }
}
