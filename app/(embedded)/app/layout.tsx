/**
 * In-iframe app shell. Nav is in Shopify Admin sidebar via s-app-nav (AppNavSidebar).
 * No in-iframe nav bar—we render only AppNavSidebar (server-rendered) + main.
 * If the host or App Bridge shows a horizontal nav bar and it is inside this document,
 * add a CSS override here (or in a linked stylesheet) and document the selector source;
 * see docs/embedded-app-redesign-implementation-plan.md § E1 — Shell and nav (homework).
 */
import { AppNavSidebar } from "./AppNavSidebar";

export default function EmbeddedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AppNavSidebar />
      <main style={{ padding: "0 24px 24px" }}>{children}</main>
    </>
  );
}
