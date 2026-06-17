/**
 * `start_shopify_install` is the Google Ads / GA4 conversion event for
 * install *intent*: the visitor entered a valid Shopify store domain in the
 * install modal and clicked the final "Install" button, and we are about to
 * redirect them to Shopify OAuth. It fires ONCE per submit — not on page load,
 * not on modal open, not on an empty/invalid store input. The eventual
 * end-to-end install is measured separately via Shopify's official
 * `shopify_app_install` event; this is the website-side leading indicator.
 *
 * Uses the GA4 / Google tag already bootstrapped on the site
 * (`window.gtag`, see lib/consent/ga-bootstrap.ts) — it does NOT create a new
 * tag. The redirect always happens, even if gtag is blocked/unavailable, and
 * is never delayed by more than ~1s (event_timeout). A module-level guard
 * prevents duplicate conversions from repeated clicks.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

// Guards against double-firing if the user clicks Install twice before the
// browser navigates away. Reset is unnecessary — the page unloads on redirect.
let hasFired = false;

/**
 * Fire the `start_shopify_install` GA4 conversion, then navigate to Shopify.
 *
 * Call this only after the shop domain has been validated and a redirect URL
 * built. The navigation is guaranteed (gtag callback OR fallback), so callers
 * should not also set `window.location` themselves.
 */
export function trackStartShopifyInstallAndRedirect(
  shopDomain: string,
  redirectUrl: string,
): void {
  const navigate = () => {
    window.location.href = redirectUrl;
  };

  if (hasFired) {
    // A conversion already went out for this submit — just complete the nav.
    navigate();
    return;
  }
  hasFired = true;

  const eventParams = {
    event_category: "shopify_app_install",
    event_label: "install_modal_submit",
    source_page:
      typeof window !== "undefined" ? window.location.pathname : "",
    install_destination: "shopify",
    store_domain_entered: Boolean(shopDomain),
    shop_domain: shopDomain,
  };

  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    let navigated = false;
    const navigateOnce = () => {
      if (navigated) return;
      navigated = true;
      navigate();
    };

    window.gtag("event", "start_shopify_install", {
      ...eventParams,
      event_callback: navigateOnce,
      // Cap the wait so a slow/blocked beacon never strands the user.
      event_timeout: 1000,
    });

    // Safety net: if the callback never runs (gtag silently dropped, beacon
    // blocked after the function existed), still redirect within ~1s.
    window.setTimeout(navigateOnce, 1000);
  } else {
    // gtag unavailable (blocked, not yet loaded, or no consent) — redirect now.
    navigate();
  }
}
