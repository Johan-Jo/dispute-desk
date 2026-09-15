/**
 * In-iframe app shell. Nav is in Shopify Admin sidebar via s-app-nav (AppNavSidebar).
 * Brand bar + feedback card (Figma) live in EmbeddedAppChrome; see components/embedded/EmbeddedAppChrome.tsx.
 */
import { headers } from "next/headers";
import { AppNavSidebar } from "./AppNavSidebar";
import { EmbeddedAppChrome } from "@/components/embedded/EmbeddedAppChrome";
import { PageViewBeacon } from "@/components/embedded/PageViewBeacon";
import { IMPERSONATION_MODE_HEADER } from "@/lib/admin/impersonation";
import { verifySessionToken } from "@/lib/shopify/sessionToken";
import { recordLastLogin } from "@/lib/shopify/recordLastLogin";
import { recordPageView } from "@/lib/shopify/recordPageView";

export default async function EmbeddedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();

  // Under SuperAdmin impersonation there's no Shopify Admin host, so <s-app-nav>
  // can't upgrade and would render as raw unstyled text. The (embedded) layout
  // renders a real fallback nav in the impersonation banner instead — so skip
  // s-app-nav here to avoid the duplicate raw-text nav.
  const impersonating = headerStore.get(IMPERSONATION_MODE_HEADER) != null;

  // Best-effort "last login" tracking for the internal admin Shops table.
  // middleware.ts forwards the raw id_token (edge runtime can't verify it —
  // no Node crypto); verify it here and record fire-and-forget so it never
  // adds latency to the merchant's page load. Not run under impersonation
  // (no real Shopify session/id_token exists there). Uses the token's own
  // verified shopDomain rather than an `x-shop-id` header — middleware's
  // /app/* branch doesn't resolve one on the normal cookie-authenticated
  // path (only /api/* and impersonation do).
  // Page-view logging. Unlike `recordLastLogin` above, this runs for BOTH
  // merchants and impersonating admins: a view log with our sessions missing
  // would read as "the merchant never opened this page" wherever we had been
  // looking instead. See lib/shopify/recordPageView.ts.
  const path = headerStore.get("x-dd-path");

  if (!impersonating) {
    const idToken = headerStore.get("x-dd-id-token");
    const verified = idToken ? verifySessionToken(idToken) : null;
    if (verified) recordLastLogin(verified.shopDomain, verified.userId);

    // Deliberately NOT gated on the token. Shopify supplies `id_token` when the
    // app is opened from Admin, not on in-app navigation, so gating here meant
    // a merchant clicking into a dispute recorded nothing (dev, 2026-09-15: 34
    // server-side hits on /app/disputes/[id], zero rows). Middleware forwards
    // `x-dd-shop-id` from the cookie precisely so this does not depend on it.
    //
    // `actorId` is therefore only present on entry loads, where the verified
    // token carries the staff id. Knowing WHICH pages were visited matters more
    // than knowing which staff member on every hop -- and a missing row would
    // read as "never visited", which is the failure this table exists to avoid.
    const shopId = headerStore.get("x-dd-shop-id");
    if (path && (shopId || verified))
      recordPageView({
        shopId: shopId ?? null,
        shopDomain: verified?.shopDomain ?? null,
        actorType: "merchant",
        actorId: verified?.userId ?? null,
        path,
      });
  } else if (path) {
    // Middleware verified the impersonation cookie and injected these.
    const shopId = headerStore.get("x-shop-id");
    const adminUserId = headerStore.get("x-dd-admin-user-id");
    if (shopId)
      recordPageView({
        shopId,
        actorType: "admin",
        actorId: adminUserId || null,
        path,
      });
  }

  return (
    <>
      {/* Client-side page-view reporting. The server recorder above misses
          router transitions served from Next's cache without a round-trip --
          which is every click into a dispute in a warm session. */}
      <PageViewBeacon />
      <s-page heading="DisputeDesk" />
      {impersonating ? null : <AppNavSidebar />}
      <EmbeddedAppChrome>{children}</EmbeddedAppChrome>
    </>
  );
}
