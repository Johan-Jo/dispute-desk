/**
 * LSE-4 storefront session ingest.
 *
 * Receives session data from the storefront extensions (theme app
 * embed, Web Pixel, Checkout UI extension), validates against the
 * privacy-safe v1 capture set, honors DNT / GPC, and persists to
 * checkout_sessions.
 *
 * Fail-open: any error returns 200 to the storefront so we never block
 * checkout. Diagnostics go to console + (later) signal-radar.
 */

import { createHash } from "node:crypto";
import { getServiceClient } from "@/lib/supabase/server";
import { encrypt, serializeEncrypted } from "@/lib/security/encryption";
import { resolveCustomerTenureDays } from "./enrichCustomerTenure";

export interface SessionIngestPayload {
  shopId: string;
  cartToken: string;
  sessionStartedAt?: string;
  userAgent?: string;
  ip?: string;
  ipGeoCountry?: string;
  ipGeoRegion?: string;
  customerId?: string;
  customerAccountAgeDays?: number;
  customerLoginStateAtCheckout?: "logged_in" | "guest" | "unknown";
  sessionHistory?: Array<{ path: string; dwellMs?: number; at?: string }>;
  timeOnCheckoutPageMs?: number;
  /** Honored: when true, the ingest is dropped server-side. */
  dnt?: boolean;
  gpc?: boolean;
}

export interface SessionIngestResult {
  persisted: boolean;
  dropped: boolean;
  reason?: string;
}

const MAX_SESSION_HISTORY_ENTRIES = 50;
const MAX_USER_AGENT_LEN = 512;
const MAX_PATH_LEN = 256;

export async function ingestCheckoutSession(
  input: SessionIngestPayload,
): Promise<SessionIngestResult> {
  const dnt = input.dnt === true;
  const gpc = input.gpc === true;

  // Privacy gate — DNT / GPC drop the record before it touches the DB.
  if (dnt) {
    return { persisted: false, dropped: true, reason: "dnt_signal" };
  }
  if (gpc) {
    return { persisted: false, dropped: true, reason: "gpc_signal" };
  }
  if (!input.cartToken || input.cartToken.length < 4) {
    return { persisted: false, dropped: true, reason: "invalid_cart_token" };
  }

  const sb = getServiceClient();

  // Per-shop IP salt: a deterministic value derived from shop_id. The
  // hash never identifies a person — it's used to join sessions to
  // priors during qualification, then dropped from query results.
  const ipHash = input.ip ? hashIp(input.ip, input.shopId) : null;
  const ipRawEncrypted = input.ip ? encryptIp(input.ip) : null;

  const sessionHistory = Array.isArray(input.sessionHistory)
    ? input.sessionHistory
        .slice(0, MAX_SESSION_HISTORY_ENTRIES)
        .map((entry) => ({
          path:
            typeof entry.path === "string"
              ? entry.path.slice(0, MAX_PATH_LEN)
              : "",
          dwellMs:
            typeof entry.dwellMs === "number" && entry.dwellMs > 0
              ? Math.floor(entry.dwellMs)
              : undefined,
          at: typeof entry.at === "string" ? entry.at : undefined,
        }))
        .filter((entry) => entry.path.length > 0)
    : [];

  const consentSignals = {
    dnt,
    gpc,
    observedAt: new Date().toISOString(),
  };

  // Customer tenure: the storefront extensions can't see
  // customer.created_at, so when the caller doesn't supply
  // customer_account_age_days but does send a customer_id, look it up
  // server-side via the Shopify Admin API (cached 1h). Silent failure —
  // tenure is informational, not a gate.
  let customerAccountAgeDays = input.customerAccountAgeDays ?? null;
  if (customerAccountAgeDays == null && input.customerId) {
    customerAccountAgeDays = await resolveCustomerTenureDays({
      shopId: input.shopId,
      customerId: input.customerId,
    });
  }

  const row = {
    shop_id: input.shopId,
    cart_token: input.cartToken,
    session_started_at: input.sessionStartedAt ?? new Date().toISOString(),
    ip_hash: ipHash,
    ip_raw_encrypted: ipRawEncrypted,
    ip_geo_country: input.ipGeoCountry ?? null,
    ip_geo_region: input.ipGeoRegion ?? null,
    user_agent: input.userAgent?.slice(0, MAX_USER_AGENT_LEN) ?? null,
    customer_id: input.customerId ?? null,
    customer_account_age_days: customerAccountAgeDays,
    customer_login_state_at_checkout:
      input.customerLoginStateAtCheckout ?? null,
    session_history: sessionHistory,
    time_on_checkout_page_ms: input.timeOnCheckoutPageMs ?? null,
    consent_signals: consentSignals,
  };

  const { error } = await sb
    .from("checkout_sessions")
    .upsert(row, { onConflict: "shop_id,cart_token" });

  if (error) {
    return { persisted: false, dropped: false, reason: error.message };
  }
  return { persisted: true, dropped: false };
}

/**
 * Match a fresh order to its checkout_session row.
 *
 * Called from the orders/create webhook handler. Sets shopify_order_id
 * and order_placed_at; idempotent under retry.
 */
export async function matchSessionToOrder(input: {
  shopId: string;
  cartToken: string;
  shopifyOrderId: string;
  orderPlacedAt: string;
}): Promise<{ matched: boolean }> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("checkout_sessions")
    .update({
      shopify_order_id: input.shopifyOrderId,
      order_placed_at: input.orderPlacedAt,
    })
    .eq("shop_id", input.shopId)
    .eq("cart_token", input.cartToken)
    .select("id");
  if (error) {
    console.warn(
      "[matchSessionToOrder] failed:",
      error.message,
      input.cartToken,
    );
    return { matched: false };
  }
  return { matched: (data?.length ?? 0) > 0 };
}

function hashIp(ip: string, shopId: string): string {
  const salt = `dd-lse4:${shopId}`;
  return createHash("sha256").update(`${salt}:${ip.trim()}`).digest("hex");
}

function encryptIp(ip: string): Buffer {
  const enc = encrypt(ip.trim());
  // serializeEncrypted returns the format `v{ver}:{ivHex}:{tagHex}:{ctHex}`
  // — already a printable ASCII string. Encode as UTF-8 bytes to store
  // in the bytea column. (Earlier code passed it to
  // `Buffer.from(..., "base64")` which silently mangled the value
  // because colons aren't valid base64 — every IP stored before
  // 2026-05-14 is un-decryptable. New rows from now on are recoverable.)
  return Buffer.from(serializeEncrypted(enc), "utf8");
}
