/**
 * In-iframe app shell. Nav is in Shopify Admin sidebar via s-app-nav (AppNavSidebar).
 * Feedback card (Figma) lives in EmbeddedAppChrome; see components/embedded/EmbeddedAppChrome.tsx.
 */
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
      <EmbeddedAppChrome>{children}</EmbeddedAppChrome>
    </>
  );
}
