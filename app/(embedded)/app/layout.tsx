/**
 * In-iframe app shell. Nav is in Shopify Admin sidebar via s-app-nav (AppNavSidebar).
 * Brand bar + feedback card (Figma) live in EmbeddedAppChrome; see components/embedded/EmbeddedAppChrome.tsx.
 */
import { headers } from "next/headers";
import { AppNavSidebar } from "./AppNavSidebar";
import { EmbeddedAppChrome } from "@/components/embedded/EmbeddedAppChrome";
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
    if (idToken) {
      const verified = verifySessionToken(idToken);
      if (verified) {
        recordLastLogin(verified.shopDomain, verified.userId);
        if (path)
          recordPageView({
            shopDomain: verified.shopDomain,
            actorType: "merchant",
            actorId: verified.userId,
            path,
          });
      }
    }
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
      <s-page heading="DisputeDesk" />
      {impersonating ? null : <AppNavSidebar />}
      <EmbeddedAppChrome>{children}</EmbeddedAppChrome>
    </>
  );
}
