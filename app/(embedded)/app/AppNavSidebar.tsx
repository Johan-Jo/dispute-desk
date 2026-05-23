/**
 * Registers app navigation with Shopify Admin sidebar via s-app-nav.
 *
 * Server component — rendered in SSR HTML so App Bridge finds it immediately
 * on init (before client hydration).
 *
 * Uses <s-link> children per the App Bridge web component spec:
 * https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav
 *
 * The home route (rel="home") is not shown as a nav link — it identifies
 * the app root for App Bridge routing.
 */
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";

export async function AppNavSidebar() {
  const t = await getTranslations();
  const headerStore = await headers();
  const locale = headerStore.get("x-shopify-locale") ?? "";

  // TEMP (demo mode — App Store screenshots): hardcoded `demo=true` on
  // every <s-link> below so navigation reliably stays in demo regardless
  // of sessionStorage / cookies / middleware behavior. Remove the
  // `demo=true` from each href to revert.
  const qs = new URLSearchParams();
  if (locale) qs.set("locale", locale);
  qs.set("demo", "true");
  const lq = `?${qs.toString()}`;

  // Shopify Admin's <s-app-nav> only renders the link label — child elements
  // like <s-icon> are stripped, so we cannot add per-item icons today
  // (verified live 2026-04-30). Leaving the nav as plain <s-link> until
  // Shopify ships an icon attribute or named slot.
  return (
    <s-app-nav>
      <s-link href={`/app${lq}`} rel="home">{t("nav.dashboard")}</s-link>
      <s-link href={`/app/disputes${lq}`}>{t("nav.disputes")}</s-link>
      <s-link href={`/app/coverage${lq}`}>{t("nav.coverage")}</s-link>
      <s-link href={`/app/rules${lq}`}>{t("nav.automation")}</s-link>
      <s-link href={`/app/packs${lq}`}>{t("nav.playbooks")}</s-link>
      <s-link href={`/app/insights/initial-analysis${lq}`}>{t("nav.insights")}</s-link>
      <s-link href={`/app/policies${lq}`}>{t("nav.policies")}</s-link>
      <s-link href={`/app/billing${lq}`}>{t("nav.billing")}</s-link>
      <s-link href={`/app/settings${lq}`}>{t("nav.settings")}</s-link>
      <s-link href={`/app/help${lq}`}>{t("nav.help")}</s-link>
    </s-app-nav>
  );
}
