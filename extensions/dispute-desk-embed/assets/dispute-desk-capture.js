/**
 * DisputeDesk session capture — LSE-4 storefront client.
 *
 * Reads session signals from Shopify's storefront context and POSTs
 * them to /api/sessions/ingest. Privacy-safe:
 *   - Never reads form input values
 *   - Honors Do Not Track and Global Privacy Control client-side
 *     (server also honors these as the authoritative gate)
 *   - 5-second hard timeout — never blocks checkout
 *   - Debounced: one ingest call per pageview cycle per cart_token
 *
 * The script tag carries the merchant config via data-* attributes
 * (rendered by dispute_desk_capture.liquid).
 */
(function () {
  try {
    var script = document.currentScript;
    if (!script) return;

    var shopDomain = script.getAttribute("data-dd-shop-domain");
    var cartToken = script.getAttribute("data-dd-cart-token");
    var customerId = script.getAttribute("data-dd-customer-id") || null;
    var customerCreated = script.getAttribute("data-dd-customer-created") || null;
    var loggedIn = script.getAttribute("data-dd-logged-in") === "true";
    var ingestUrl =
      script.getAttribute("data-dd-ingest-url") ||
      "https://disputedesk.app/api/sessions/ingest";

    // Privacy gates — drop client-side before any network. The server
    // also drops, so this is belt-and-suspenders.
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
    if (navigator.globalPrivacyControl === true) return;
    if (!shopDomain || !cartToken || cartToken.length < 4) return;

    // Compute customer account age (days). Null when not logged in.
    var customerAccountAgeDays = null;
    if (customerCreated) {
      var created = Date.parse(customerCreated);
      if (!isNaN(created)) {
        customerAccountAgeDays = Math.max(
          0,
          Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24)),
        );
      }
    }

    // Build payload. shop_domain is the merchant identifier — the server
    // resolves it to the DisputeDesk shop_id via a cached Supabase lookup.
    // No merchant config required: every Shopify storefront knows its own
    // permanent_domain.
    var payload = {
      shop_domain: shopDomain,
      cart_token: cartToken,
      session_started_at: new Date().toISOString(),
      user_agent: navigator.userAgent,
      customer_id: customerId,
      customer_account_age_days: customerAccountAgeDays,
      customer_login_state_at_checkout: loggedIn ? "logged_in" : "guest",
      session_history: [
        {
          path: location.pathname,
          at: new Date().toISOString(),
        },
      ],
      // dnt/gpc redundant — server also reads request headers — but
      // we send them so the consent_signals row is complete.
      dnt: navigator.doNotTrack === "1" || window.doNotTrack === "1",
      gpc: navigator.globalPrivacyControl === true,
    };

    // Debounce per-pageview using sessionStorage so SPA-style theme
    // re-renders don't double-fire on the same cart.
    var dedupeKey = "dd_lse4_sent:" + cartToken + ":" + location.pathname;
    try {
      if (sessionStorage.getItem(dedupeKey)) return;
      sessionStorage.setItem(dedupeKey, "1");
    } catch (_e) {
      // SessionStorage disabled — proceed anyway, the server has its
      // own dedup via (shop_id, cart_token) unique index.
    }

    // Fetch with hard timeout. Fail-open: never throw to the page.
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, 5000);

    fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
    })
      .catch(function () {
        // Silent — capture is best-effort.
      })
      .finally(function () {
        clearTimeout(timeoutId);
      });
  } catch (_e) {
    // Top-level catch — capture must never break the storefront.
  }
})();
