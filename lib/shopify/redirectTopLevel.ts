/**
 * redirectTopLevel — navigate the browser's TOP window to a URL from inside
 * the embedded Shopify Admin iframe.
 *
 * Why this exists: doing `window.top.location.href = url` directly works only
 * when the call happens inside a real user gesture (a click handler that runs
 * synchronously). When the navigation is triggered from a `fetch()` callback
 * — e.g. after `POST /api/billing/subscribe` returns a `confirmationUrl` on
 * `admin.shopify.com` — Chrome treats it as a cross-origin top-frame
 * navigation with no user activation and BLOCKS it:
 *
 *   "Unsafe attempt to initiate navigation for frame with origin
 *    'https://admin.shopify.com' from frame with URL 'https://disputedesk.app/…'.
 *    The frame … is neither same-origin with its target nor has it received a
 *    user gesture."
 *
 * This app uses App Bridge web components (see app/(embedded)/layout.tsx —
 * `<meta name="shopify-api-key">` boots the CDN App Bridge, which exposes the
 * global `window.shopify`). App Bridge installs an interceptor on `open()` and
 * on `<a target="_top">` clicks that relays the navigation to the parent
 * admin frame over postMessage, so it is NOT subject to the user-activation
 * restriction. We therefore prefer `open(url, "_top")` and fall back to raw
 * `window.top` navigation only when App Bridge is not present (e.g. the page
 * is open standalone, outside the Admin iframe).
 */
export function redirectTopLevel(url: string): void {
  if (typeof window === "undefined") return;

  // Inside the Admin iframe with App Bridge booted: `open(url, "_top")` is
  // intercepted by App Bridge and relayed to admin.shopify.com. This is the
  // only path that survives a cross-origin redirect from a fetch callback
  // with no user gesture.
  const inIframe = window.top !== window.self;
  const hasAppBridge =
    typeof (window as { shopify?: unknown }).shopify !== "undefined";

  if (inIframe && hasAppBridge) {
    try {
      window.open(url, "_top");
      return;
    } catch {
      // fall through to the direct path below
    }
  }

  // Standalone / no App Bridge: a normal top navigation. When we're not in an
  // iframe `window.top === window`, so this is a same-origin-safe assignment.
  try {
    if (window.top) {
      window.top.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch {
    window.location.href = url;
  }
}
