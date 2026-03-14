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

export async function AppNavSidebar() {
  const t = await getTranslations();

  return (
    <s-app-nav>
      <s-link href="/app" rel="home">{t("nav.dashboard")}</s-link>
      <s-link href="/app/disputes">{t("nav.disputes")}</s-link>
      <s-link href="/app/packs">{t("nav.packs")}</s-link>
      <s-link href="/app/rules">{t("nav.rules")}</s-link>
      <s-link href="/app/billing">{t("nav.billing")}</s-link>
      <s-link href="/app/settings">{t("nav.settings")}</s-link>
      <s-link href="/app/help">{t("nav.help")}</s-link>
    </s-app-nav>
  );
}
