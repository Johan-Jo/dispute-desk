/**
 * DisputeDesk Checkout UI extension — LSE-4 session capture.
 *
 * Zero-configuration. Renders nothing visible. At the checkout step,
 * captures the authoritative login state + cart_token via Shopify's
 * checkout extension APIs and POSTs to /api/sessions/ingest.
 *
 * The shop is identified by `shopify.shop.myshopifyDomain` — every
 * checkout extension receives this for free at runtime. The DisputeDesk
 * server resolves shop_domain → shop_id via Supabase.
 *
 * The pixel and theme embed also fire — this one is the most reliable
 * source for `customer_login_state_at_checkout` because it runs in the
 * checkout context after the customer-step decision is final.
 */

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";

const INGEST_URL = "https://disputedesk.app/api/sessions/ingest";
const FETCH_TIMEOUT_MS = 5000;

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    void (async () => {
      try {
        // shop_domain — provided by Shopify, no merchant config required.
        const shopDomain =
          shopify?.shop?.myshopifyDomain ||
          shopify?.shop?.value?.myshopifyDomain ||
          null;
        if (!shopDomain) return;

        const cartToken = readCartToken();
        if (!cartToken) return;

        const customer = shopify?.customer?.value ?? shopify?.customer ?? null;
        const customerId = customer?.id ? String(customer.id) : null;
        const loginState = customerId ? "logged_in" : "guest";

        const payload = {
          shop_domain: shopDomain,
          cart_token: cartToken,
          session_started_at: new Date().toISOString(),
          customer_id: customerId,
          customer_login_state_at_checkout: loginState,
          session_history: [
            { path: "/checkout", at: new Date().toISOString() },
          ],
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          await fetch(INGEST_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            mode: "cors",
            credentials: "omit",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (_e) {
        // Silent — capture is best-effort and must never block checkout.
      }
    })();
  }, []);

  return null;
}

function readCartToken() {
  // Checkout UI extension APIs vary slightly across versions. Probe a
  // few well-known paths in order of preference.
  try {
    return (
      shopify?.cost?.cart?.token ||
      shopify?.cart?.value?.token ||
      shopify?.checkoutToken?.value ||
      null
    );
  } catch {
    return null;
  }
}
