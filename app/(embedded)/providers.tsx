"use client";

import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
import { NextIntlClientProvider } from "next-intl";

interface ProvidersProps {
  children: React.ReactNode;
  locale?: string;
  messages?: Record<string, unknown>;
  polarisTranslations?: typeof enTranslations;
}

export function Providers({
  children,
  locale = "en",
  messages,
  polarisTranslations,
}: ProvidersProps) {
  const i18n = polarisTranslations ?? enTranslations;
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AppProvider i18n={i18n}>{children}</AppProvider>
    </NextIntlClientProvider>
  );
}
