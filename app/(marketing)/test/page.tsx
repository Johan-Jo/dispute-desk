import type { Metadata } from "next";
import { WinnabilityTest } from "@/components/marketing/WinnabilityTest";

export const metadata: Metadata = {
  title: "Is Your Chargeback Winnable? — Free 5-Minute Test | DisputeDesk",
  description:
    "Answer 6 quick questions about one recent dispute. See whether it was winnable under Visa's Compelling Evidence 3.0 — and where your chargeback ratio really sits. Free, no account.",
  openGraph: {
    title: "Was that chargeback actually winnable?",
    description:
      "A free 5-minute test for Shopify merchants. Get an instant winnability verdict plus your chargeback-ratio risk gauge.",
  },
  robots: { index: true, follow: true },
  icons: { icon: [{ url: "/winnability-shield.svg", type: "image/svg+xml" }] },
};

/**
 * /test — the 5-Minute Winnability Test (DP-TEST-01).
 *
 * English-only GTM lead magnet served standalone (like the legal pages under
 * app/(marketing)/), not through next-intl. See middleware.ts for the routing
 * entry. The interactive tool + lead capture live in <WinnabilityTest />.
 */
export default function WinnabilityTestPage() {
  return <WinnabilityTest />;
}
