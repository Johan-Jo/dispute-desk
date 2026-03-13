/**
 * In-iframe app shell: top bar, left sidebar nav, main content.
 * Figma: shopify-shell.tsx — nav in left pane.
 */
import { EmbeddedAppNav } from "./EmbeddedAppNav";

export default function EmbeddedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <EmbeddedAppNav>{children}</EmbeddedAppNav>;
}
