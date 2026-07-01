/**
 * `demo_install_click` is a DEMO-ONLY GA4 event: a visitor clicked Install
 * inside the `/demo` experience (reached almost entirely via the "Live demo"
 * button on the Shopify App Store listing), entered a valid store domain, and
 * is about to be redirected to Shopify OAuth.
 *
 * It is deliberately SEPARATE from `start_shopify_install`
 * (lib/analytics/startShopifyInstall.ts), which is the Google Ads / GA4
 * *conversion* fired from the marketing install modals. Demo install clicks
 * must NOT count as paid-ads conversions — doing so would inflate Google Ads
 * conversion counts and corrupt bid optimization. So this fires a plain event
 * that is never imported into Google Ads. (You may still mark it a conversion
 * inside GA4 if you want it in funnels — that GA4 flag does not feed Ads.)
 *
 * Uses the GA4 / Google tag already bootstrapped on the site
 * (`window.gtag`, see lib/consent/ga-bootstrap.ts) — it does NOT create a new
 * tag. The redirect always happens, even if gtag is blocked/unavailable, and
 * is never delayed by more than ~1s. A module-level guard prevents duplicate
 * events from repeated clicks.
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
 * Fire `demo_install_cta_click` — a visitor clicked an Install call-to-action
 * inside the demo (e.g. the guided tour's final "DisputeDesk is free to try!"
 * button, the top-bar / floating Install buttons). This fires on the CLICK
 * itself, before the install modal opens, so it counts demo-driven interest
 * even when the visitor never enters a domain and never installs.
 *
 * No redirect, so there is no page-unload race — this is the reliable
 * top-of-intent signal. Like `demo_install_click`, it is a plain GA4 event and
 * must NEVER be imported into Google Ads as a conversion. `cta` labels which
 * button was clicked (e.g. "guided_tour_final", "topbar", "floating").
 */
export function trackDemoInstallCtaClick(cta: string): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", "demo_install_cta_click", {
    event_category: "demo",
    event_label: cta,
    cta,
    source_page: window.location.pathname,
  });
}

/**
 * Fire the `demo_install_click` GA4 event, then navigate to Shopify OAuth.
 *
 * Call this only after the shop domain has been validated and a redirect URL
 * built. The navigation is guaranteed (gtag callback OR fallback), so callers
 * should not also set `window.location` themselves.
 */
export function trackDemoInstallClickAndRedirect(
  shopDomain: string,
  redirectUrl: string,
): void {
  const navigate = () => {
    window.location.href = redirectUrl;
  };

  if (hasFired) {
    // An event already went out for this submit — just complete the nav.
    navigate();
    return;
  }
  hasFired = true;

  const eventParams = {
    event_category: "demo",
    event_label: "demo_install_modal_submit",
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

    window.gtag("event", "demo_install_click", {
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
