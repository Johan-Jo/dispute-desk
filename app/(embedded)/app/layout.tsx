/**
 * In-iframe app shell. Nav is in Shopify Admin sidebar via s-app-nav (AppNavSidebar).
 * Brand bar + feedback card (Figma) live in EmbeddedAppChrome; see components/embedded/EmbeddedAppChrome.tsx.
 */
import { headers } from "next/headers";
import { AppNavSidebar } from "./AppNavSidebar";
import { EmbeddedAppChrome } from "@/components/embedded/EmbeddedAppChrome";
import { IMPERSONATION_MODE_HEADER } from "@/lib/admin/impersonation";

export default async function EmbeddedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Under SuperAdmin impersonation there's no Shopify Admin host, so <s-app-nav>
  // can't upgrade and would render as raw unstyled text. The (embedded) layout
  // renders a real fallback nav in the impersonation banner instead — so skip
  // s-app-nav here to avoid the duplicate raw-text nav.
  const impersonating = (await headers()).get(IMPERSONATION_MODE_HEADER) != null;

  return (
    <>
      <s-page heading="DisputeDesk" />
      {impersonating ? null : <AppNavSidebar />}
      <EmbeddedAppChrome>{children}</EmbeddedAppChrome>
    </>
  );
}
