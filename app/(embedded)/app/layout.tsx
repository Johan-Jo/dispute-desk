/**
 * In-iframe app shell: app nav (Dashboard, Disputes, Evidence Packs, Rules, Plan, Settings).
 * Figma: shopify-shell.tsx — only in-iframe content; Shopify provides outer chrome.
 */
import { EmbeddedAppNav } from "./EmbeddedAppNav";

export default function EmbeddedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <EmbeddedAppNav />
      <main style={{ padding: "0 24px 24px" }}>{children}</main>
    </>
  );
}
