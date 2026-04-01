import { redirect } from "next/navigation";
import { requirePortalUser } from "@/lib/supabase/portal";
import { getActiveShopId, getLinkedShops } from "@/lib/portal/activeShop";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * Post–Shopify OAuth hop for portal sign-in/sign-up: same-origin redirect target
 * for Supabase generateLink, then 302 to Shopify Admin embedded app URL.
 */
export default async function OpenInShopifyPage() {
  const user = await requirePortalUser();
  const shopId = await getActiveShopId();

  if (!shopId) {
    redirect("/portal/select-store");
  }

  const linked = await getLinkedShops(user.id);
  const allowed = linked.some((row) => row.shop_id === shopId);
  if (!allowed) {
    redirect("/portal/select-store");
  }

  let shopDomain: string | null = null;
  const fromLink = linked.find((row) => row.shop_id === shopId);
  const nested = fromLink?.shops as { shop_domain?: string } | null | undefined;
  if (nested && typeof nested.shop_domain === "string") {
    shopDomain = nested.shop_domain;
  }

  if (!shopDomain) {
    const db = getServiceClient();
    const { data } = await db
      .from("shops")
      .select("shop_domain")
      .eq("id", shopId)
      .single();
    shopDomain = data?.shop_domain ?? null;
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!shopDomain || !apiKey) {
    redirect("/portal/dashboard");
  }

  redirect(`https://${shopDomain}/admin/apps/${apiKey}`);
}
