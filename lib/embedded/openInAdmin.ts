/**
 * Open the current shop’s Shopify Admin in the same or new context.
 * Uses App Bridge Redirect (primary); falls back to window.top.location.href.
 * For use in the embedded app only (browser/client).
 */

function getShopFromPage(): string | null {
  if (typeof window === "undefined") return null;
  const u = new URL(window.location.href);
  const shop = u.searchParams.get("shop")?.trim();
  if (shop) return shop;
  const match = document.cookie.match(/\bshopify_shop=([^;]+)/);
  return match ? decodeURIComponent(match[1]).trim() : null;
}

function buildAdminUrl(shop: string): string {
  const base = shop.startsWith("http") ? shop : `https://${shop}`;
  try {
    const url = new URL(base);
    return `https://${url.hostname}/admin`;
  } catch {
    return `https://${shop}/admin`;
  }
}

/**
 * Open Shopify Admin (optionally in a new tab).
 * Primary: App Bridge Redirect.dispatch(REMOTE, { url, newContext: true }).
 * Fallback: window.top.location.href = url.
 */
export function openInAdmin(options?: { newContext?: boolean }): boolean {
  const shop = getShopFromPage();
  if (!shop) return false;
  const url = buildAdminUrl(shop);
  const newContext = options?.newContext !== false;

  const w = typeof window !== "undefined" ? window : null;
  if (!w) return false;

  try {
    const win = w as Window & { "app-bridge"?: { actions?: { Redirect?: { dispatch: (a: unknown, p: string | { url: string; newContext?: boolean }) => void; Action?: { REMOTE: unknown } } } } };
    const appBridge = win["app-bridge"];
    const redirect = appBridge?.actions?.Redirect;
    if (redirect?.dispatch) {
      const action = redirect.Action?.REMOTE ?? "REMOTE";
      redirect.dispatch(action, newContext ? { url, newContext: true } : url);
      return true;
    }
  } catch {
    // ignore
  }

  if (newContext) {
    try {
      w.open(url, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      // ignore
    }
  }

  try {
    if (w.top) {
      w.top.location.href = url;
      return true;
    }
  } catch {
    // ignore
  }

  w.location.href = url;
  return true;
}
