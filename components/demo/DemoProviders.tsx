"use client";

import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
import { NextIntlClientProvider } from "next-intl";

interface DemoProvidersProps {
  children: React.ReactNode;
  messages: Record<string, unknown>;
}

/**
 * Polaris + next-intl providers for the public demo route group.
 *
 * Mirrors `app/(embedded)/providers.tsx` so the real embedded components
 * (DashboardKpis, DisputesTable, etc.) render identically here — they
 * depend on the same Polaris AppProvider context and next-intl translator.
 *
 * Differences from the real Providers:
 *   - No HelpGuideProvider/EmbeddedTourOverlay — those need a Shopify
 *     session and would call /api/help/* that the fetch shim doesn't mock.
 *   - English-only (the demo is a single-language sales surface).
 */
export function DemoProviders({ children, messages }: DemoProvidersProps) {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <AppProvider i18n={enTranslations}>
        {/* Demo override: Polaris-Page caps at ~998px (built for narrow
            Shopify Admin iframes). The public demo runs at full
            viewport width, so lift the cap. The previous attempt at
            this broke inner Card layouts because of a stray `<div>`
            wrapping a Layout.Section in page.tsx — that's now fixed,
            so cap removal is safe. */}
        <style>{`
          .Polaris-Page { max-width: none !important; }
        `}</style>
        {children}
      </AppProvider>
    </NextIntlClientProvider>
  );
}
