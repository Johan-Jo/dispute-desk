/**
 * Resolve the message a shop should currently see.
 *
 * Active = published, not dismissed, and either no expiry or an expiry
 * in the future. When several qualify the newest wins — an admin who
 * writes a second message means the second one, and stacking banners
 * on a merchant's dashboard would be noise.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { ActiveMerchantMessage } from "./types";

export async function getActiveMerchantMessage(
  shopId: string,
): Promise<ActiveMerchantMessage | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("merchant_messages")
    .select("id, title, body, ask_for_contact, tone, expires_at")
    .eq("shop_id", shopId)
    .eq("status", "published")
    .is("dismissed_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const row = data[0];
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    askForContact: row.ask_for_contact,
    tone: row.tone,
  };
}
