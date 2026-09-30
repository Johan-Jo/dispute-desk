import { getServiceClient } from "@/lib/supabase/server";

export interface ShopSettings {
  shop_id: string;
  auto_build_enabled: boolean;
  auto_save_enabled: boolean;
  auto_save_min_score: number;
  enforce_no_blockers: boolean;
  /** Fix C4: customers ask for returns/refunds by email, chat or phone. */
  returns_outside_shopify: boolean;
  created_at: string;
  updated_at: string;
}

export async function getShopSettings(shopId: string): Promise<ShopSettings> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("ensure_shop_settings", {
    p_shop_id: shopId,
  });

  if (error) throw new Error(`Failed to load shop settings: ${error.message}`);
  return data as ShopSettings;
}

export async function updateShopSettings(
  shopId: string,
  updates: Partial<
    Pick<
      ShopSettings,
      | "auto_build_enabled"
      | "auto_save_enabled"
      | "auto_save_min_score"
      | "enforce_no_blockers"
      | "returns_outside_shopify"
    >
  >
): Promise<ShopSettings> {
  const sb = getServiceClient();

  await sb.rpc("ensure_shop_settings", { p_shop_id: shopId });

  const { data, error } = await sb
    .from("shop_settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .select()
    .single();

  if (error)
    throw new Error(`Failed to update shop settings: ${error.message}`);
  return data as ShopSettings;
}
