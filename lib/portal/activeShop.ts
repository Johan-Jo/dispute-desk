import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/server";

const COOKIE_NAME = "active_shop_id";

/**
 * Gets the active shop ID from the cookie.
 * Returns null if not set.
 */
export async function getActiveShopId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

const DD_COOKIE_NAME = "dd_active_shop";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 90,
  path: "/",
};

/**
 * Sets the active shop cookie. Call from /portal/select-store.
 */
export async function setActiveShopId(shopId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, shopId, COOKIE_OPTS);
  cookieStore.set(DD_COOKIE_NAME, shopId, COOKIE_OPTS);
}

/**
 * Clears the active shop cookies to switch back to demo mode.
 */
export async function clearActiveShopId() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(DD_COOKIE_NAME);
}

/**
 * Requires an active shop or redirects to select-store.
 * Also verifies the user actually has access to this shop.
 */
export async function requireActiveShop(userId: string) {
  const shopId = await getActiveShopId();
  if (!shopId) {
    redirect("/portal/select-store");
  }

  const db = getServiceClient();
  const { data: link } = await db
    .from("portal_user_shops")
    .select("id")
    .eq("user_id", userId)
    .eq("shop_id", shopId)
    .single();

  if (!link) {
    redirect("/portal/select-store");
  }

  return shopId;
}

/**
 * Gets all shops linked to a portal user.
 */
export async function getLinkedShops(userId: string) {
  const db = getServiceClient();
  const { data } = await db
    .from("portal_user_shops")
    .select("shop_id, role, shops(id, shop_domain)")
    .eq("user_id", userId);

  return data ?? [];
}
