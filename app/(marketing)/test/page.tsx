import type { Metadata } from "next";
import { WinnabilityTest } from "@/components/marketing/WinnabilityTest";
import { PRODUCTION_ORIGIN } from "@/lib/resources/url";

// Absolute OG image URL (the (marketing) route group has no metadataBase, so a
// relative path wouldn't resolve for crawlers). The card asset lives at
// public/og/test-og-card.png. See design DP-OG-01.
const OG_IMAGE = `${PRODUCTION_ORIGIN}/og/test-og-card.png`;
const OG_TITLE = "Was that chargeback actually winnable?";
const OG_DESCRIPTION =
  "Free 5-minute test for Shopify merchants. Answer 6 questions about one dispute and get an instant verdict — plus how close your store is to being flagged high-risk.";

export const metadata: Metadata = {
  title: "Is Your Chargeback Winnable? — Free 5-Minute Test | DisputeDesk",
  description:
    "Answer 6 quick questions about one recent dispute. See whether it was winnable under Visa's Compelling Evidence 3.0 — and where your chargeback ratio really sits. Free, no account.",
  openGraph: {
    type: "website",
    url: `${PRODUCTION_ORIGIN}/test`,
    siteName: "DisputeDesk",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_IMAGE],
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
