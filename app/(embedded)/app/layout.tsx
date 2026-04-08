/**
 * In-iframe app shell. Nav is in Shopify Admin sidebar via s-app-nav (AppNavSidebar).
 * Brand bar + feedback card (Figma) live in EmbeddedAppChrome; see components/embedded/EmbeddedAppChrome.tsx.
 */
import { Suspense } from "react";
import { AppNavSidebar } from "./AppNavSidebar";
import { EmbeddedAppChrome } from "@/components/embedded/EmbeddedAppChrome";

export default function EmbeddedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AppNavSidebar />
      <Suspense fallback={<main style={{ padding: "24px 32px", background: "#f1f2f4" }}>{children}</main>}>
        <EmbeddedAppChrome>{children}</EmbeddedAppChrome>
      </Suspense>
    </>
  );
}
