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

  // Note: the s-link / s-app-nav docs don't promise child-icon support, but
  // s-icon is part of the same Polaris web-component set. We render an
  // <s-icon> alongside the label and let Shopify Admin ignore it gracefully
  // if the nav slot doesn't render children other than the label.
  return (
    <s-app-nav>
      <s-link href={`/app${lq}`} rel="home">
        <s-icon type="home" />
        {t("nav.dashboard")}
      </s-link>
      <s-link href={`/app/disputes${lq}`}>
        <s-icon type="alert-circle" />
        {t("nav.disputes")}
      </s-link>
      <s-link href={`/app/coverage${lq}`}>
        <s-icon type="shield" />
        {t("nav.coverage")}
      </s-link>
      <s-link href={`/app/rules${lq}`}>
        <s-icon type="flash" />
        {t("nav.automation")}
      </s-link>
      <s-link href={`/app/packs${lq}`}>
        <s-icon type="page" />
        {t("nav.playbooks")}
      </s-link>
      <s-link href={`/app/policies${lq}`}>
        <s-icon type="database" />
        {t("nav.policies")}
      </s-link>
      <s-link href={`/app/billing${lq}`}>
        <s-icon type="credit-card" />
        {t("nav.billing")}
      </s-link>
      <s-link href={`/app/settings${lq}`}>
        <s-icon type="settings" />
        {t("nav.settings")}
      </s-link>
      <s-link href={`/app/help${lq}`}>
        <s-icon type="question-circle" />
        {t("nav.help")}
      </s-link>
    </s-app-nav>
  );
}
