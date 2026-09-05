/**
 * Resolve the message a shop should currently see.
 *
 * Active = published, not dismissed, NOT already answered, and either
 * no expiry or an expiry in the future. When several qualify the newest
 * wins — an admin who writes a second message means the second one, and
 * stacking banners on a merchant's dashboard would be noise.
 *
 * `responded_at` matters as much as `dismissed_at`: the banner's own
 * "sent" confirmation is component state, so without this filter a
 * merchant who replied saw the empty form again on their next page
 * navigation — asking a second time for something they had just given
 * us. Answered is done; the reply lives on the row and in the ops
 * inbox, and the admin card is where it gets read.
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
    .is("responded_at", null)
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
