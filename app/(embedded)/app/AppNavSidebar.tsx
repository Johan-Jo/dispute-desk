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
  const lq = locale ? `?locale=${encodeURIComponent(locale)}` : "";

  return (
    <s-app-nav>
      <s-link href={`/app${lq}`} rel="home">{t("nav.dashboard")}</s-link>
      <s-link href={`/app/disputes${lq}`}>{t("nav.disputes")}</s-link>
      <s-link href={`/app/coverage${lq}`}>{t("nav.coverage")}</s-link>
      <s-link href={`/app/rules${lq}`}>{t("nav.automation")}</s-link>
      <s-link href={`/app/packs${lq}`}>{t("nav.playbooks")}</s-link>
      <s-link href={`/app/billing${lq}`}>{t("nav.billing")}</s-link>
      <s-link href={`/app/settings${lq}`}>{t("nav.settings")}</s-link>
      <s-link href={`/app/help${lq}`}>{t("nav.help")}</s-link>
    </s-app-nav>
  );
}
