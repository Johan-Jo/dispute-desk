/**
 * DisputeDesk Web Pixel — LSE-4 storefront session capture.
 *
 * Subscribes to checkout-flow analytics events and forwards a
 * privacy-safe payload to DisputeDesk's /api/sessions/ingest endpoint.
 * Runs in Shopify's sandboxed pixel environment (strict runtime
 * context) — fetch is the only network primitive available, no DOM
 * access. Never reads form input values.
 *
 * Complements the theme app embed (which fires on page load). The
 * pixel fires authoritative events at checkout_started and
 * checkout_completed, which is exactly when the cart_token + customer
 * state is stable.
 */

import { register } from "@shopify/web-pixels-extension";

interface DisputeDeskPixelSettings {
  accountID: string;
}

interface SessionIngestPayload {
  shop_id: string;
  cart_token: string;
  session_started_at?: string;
  user_agent?: string;
  customer_id?: string | null;
  customer_login_state_at_checkout?: "logged_in" | "guest" | "unknown";
  session_history?: Array<{ path: string; at?: string }>;
  dnt?: boolean;
  gpc?: boolean;
}

const INGEST_URL = "https://disputedesk.app/api/sessions/ingest";
const FETCH_TIMEOUT_MS = 5000;

register(({ analytics, browser, init, settings }) => {
  // The merchant configures accountID = their DisputeDesk shop ID at
  // pixel install time. Without it, drop everything.
  const typedSettings = settings as DisputeDeskPixelSettings;
  const shopId = typedSettings?.accountID;
  if (!shopId) return;

  // Capture page views into a tail buffer the next dispatch will flush.
  const sessionHistory: Array<{ path: string; at: string }> = [];
  const MAX_HISTORY = 20;

  analytics.subscribe("page_viewed", (event) => {
    try {
      const ctx = event?.context as
        | { document?: { location?: { pathname?: string } } }
        | undefined;
      const path = ctx?.document?.location?.pathname ?? "/";
      sessionHistory.push({ path, at: new Date().toISOString() });
      if (sessionHistory.length > MAX_HISTORY) sessionHistory.shift();
    } catch (_e) {
      // Pixel sandbox: log silently — never throw upward.
    }
  });

  // checkout_started carries cart_token + (when logged in) customer.
  analytics.subscribe("checkout_started", (event) => {
    dispatch(event, shopId, sessionHistory).catch(() => {
      // Best-effort. Silent fail.
    });
  });

  // checkout_completed is the final authoritative capture moment.
  analytics.subscribe("checkout_completed", (event) => {
    dispatch(event, shopId, sessionHistory).catch(() => {});
  });
});

async function dispatch(
  event: unknown,
  shopId: string,
  history: Array<{ path: string; at: string }>,
): Promise<void> {
  const checkout = readCheckoutFromEvent(event);
  if (!checkout?.cart_token) return;

  const payload: SessionIngestPayload = {
    shop_id: shopId,
    cart_token: checkout.cart_token,
    session_started_at: new Date().toISOString(),
    user_agent: readUserAgent(event),
    customer_id: checkout.customer_id ?? null,
    customer_login_state_at_checkout: checkout.customer_id
      ? "logged_in"
      : "guest",
    session_history: history.slice(),
  };

  // Hard timeout via AbortController so a slow ingest never holds the
  // pixel lifecycle.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function readCheckoutFromEvent(
  event: unknown,
): { cart_token: string | null; customer_id: string | null } | null {
  if (!event || typeof event !== "object") return null;
  const data = (event as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const checkout = (data as { checkout?: unknown }).checkout;
  if (!checkout || typeof checkout !== "object") return null;
  const c = checkout as {
    token?: string | null;
    cart_token?: string | null;
    order?: { customer?: { id?: string | null } } | null;
  };
  return {
    cart_token: c.cart_token ?? c.token ?? null,
    customer_id: c.order?.customer?.id ?? null,
  };
}

function readUserAgent(event: unknown): string | undefined {
  try {
    const ctx = (event as { context?: { navigator?: { userAgent?: string } } })
      .context;
    return ctx?.navigator?.userAgent;
  } catch {
    return undefined;
  }
}
