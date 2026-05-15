/**
 * On-demand checkout_session lookup for LSE-1 / LSE-3 qualification.
 *
 * Historically the Shopify Order GraphQL query supplied `cartToken`,
 * which we used as the join key to find the LSE-4 session row captured
 * when the customer was on the storefront. `Order.cartToken` was
 * removed from Admin API 2026-01 (incident 2026-05-15), so callers
 * now pass `null` here unless an alternate source (e.g. the
 * orders/create webhook payload, which still carries cart_token in the
 * REST shape) has been persisted upstream. When the lookup yields no
 * session, qualification falls back to the leaner `Order.clientIp`
 * field — accuracy degrades but the chain does not break.
 *
 * Replaces the older webhook-based match-back approach: instead of
 * writing `shopify_order_id` onto the session row at orders/create
 * time, we look up the session by cart_token whenever the qualification
 * engine needs the data. Simpler, no webhook ordering races, idempotent.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { decrypt, deserializeEncrypted } from "@/lib/security/encryption";

export interface SessionEnrichment {
  ip: string | null;
  /** Reserved — LSE-4 v1 doesn't capture device fingerprint. */
  deviceFingerprint: string | null;
  customerLoginStateAtCheckout: "logged_in" | "guest" | "unknown" | null;
  customerAccountAgeDays: number | null;
}

const EMPTY: SessionEnrichment = {
  ip: null,
  deviceFingerprint: null,
  customerLoginStateAtCheckout: null,
  customerAccountAgeDays: null,
};

export async function lookupSessionForOrder(input: {
  shopId: string;
  cartToken: string | null | undefined;
}): Promise<SessionEnrichment> {
  if (!input.cartToken) return EMPTY;
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("checkout_sessions")
    .select(
      "ip_raw_encrypted, customer_login_state_at_checkout, customer_account_age_days",
    )
    .eq("shop_id", input.shopId)
    .eq("cart_token", input.cartToken)
    .maybeSingle();
  if (error || !data) return EMPTY;

  let ip: string | null = null;
  const raw = data.ip_raw_encrypted as unknown as
    | Buffer
    | { type?: "Buffer"; data?: number[] }
    | string
    | null;
  if (raw) {
    try {
      // bytea comes back from Supabase as either a Buffer-like object
      // ({type:'Buffer', data:[...]}) or a hex/base64 string depending
      // on the driver path. Normalize to Buffer, then to the UTF-8
      // serialized form we stored in ingest.ts → encryptIp().
      const buf = Buffer.isBuffer(raw)
        ? raw
        : typeof raw === "string"
          ? Buffer.from(raw.replace(/^\\x/, ""), "hex")
          : Array.isArray((raw as { data?: number[] }).data)
            ? Buffer.from((raw as { data: number[] }).data)
            : null;
      if (buf) {
        ip = decrypt(deserializeEncrypted(buf.toString("utf8")));
      }
    } catch {
      // Decrypt failure — pre-2026-05-14 sessions (stored with the
      // base64 bug), rotated key, or corrupt ciphertext. Silent
      // fall-through; qualification uses Shopify Order.clientIp instead.
      ip = null;
    }
  }

  return {
    ip,
    deviceFingerprint: null,
    customerLoginStateAtCheckout:
      (data.customer_login_state_at_checkout as
        | "logged_in"
        | "guest"
        | "unknown"
        | null) ?? null,
    customerAccountAgeDays:
      typeof data.customer_account_age_days === "number"
        ? data.customer_account_age_days
        : null,
  };
}
