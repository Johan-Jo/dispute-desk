/**
 * In-iframe app shell. Nav is in Shopify Admin sidebar via s-app-nav (AppNavSidebar).
 * Brand bar + feedback card (Figma) live in EmbeddedAppChrome; see components/embedded/EmbeddedAppChrome.tsx.
 *
 * `<DemoModeProvider>` wraps the tree so `?demo=true` (or the
 * `NEXT_PUBLIC_DISPUTEDESK_DEMO_MODE` env flag) activates the demo data
 * adapter — it intercepts API calls client-side and shows a toast on
 * simulated mutations. In normal use the provider is a passthrough.
 */
import { AppNavSidebar } from "./AppNavSidebar";
import { EmbeddedAppChrome } from "@/components/embedded/EmbeddedAppChrome";
import { DemoModeProvider } from "@/components/demo/DemoModeProvider";

export default function EmbeddedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <s-page heading="DisputeDesk" />
      <AppNavSidebar />
      <EmbeddedAppChrome>
        <DemoModeProvider>{children}</DemoModeProvider>
      </EmbeddedAppChrome>
    </>
  );
}
