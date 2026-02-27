import { getServiceClient } from "@/lib/supabase/server";

export async function logSetupEvent(
  shopId: string,
  name: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const sb = getServiceClient();
  await sb.from("app_events").insert({
    shop_id: shopId,
    name,
    payload,
  });
}
