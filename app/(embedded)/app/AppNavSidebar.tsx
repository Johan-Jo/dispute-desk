/**
 * Registers app navigation with Shopify Admin sidebar via s-app-nav.
 *
 * Server component — rendered in SSR HTML so App Bridge finds it in the DOM
 * immediately on init (before client hydration). A client component using
 * useSearchParams() would only render after hydration, causing App Bridge to
 * miss the nav on first load.
 *
 * hrefs are app-relative paths. App Bridge preserves shop/host params when
 * routing within the embedded app, so we don't need to append them here.
 */
import { getTranslations } from "next-intl/server";

const NAV_ITEMS: { path: string; labelKey: string }[] = [
  { path: "/app", labelKey: "nav.dashboard" },
  { path: "/app/disputes", labelKey: "nav.disputes" },
  { path: "/app/packs", labelKey: "nav.packs" },
  { path: "/app/rules", labelKey: "nav.rules" },
  { path: "/app/billing", labelKey: "nav.billing" },
  { path: "/app/settings", labelKey: "nav.settings" },
  { path: "/app/help", labelKey: "nav.help" },
];

export async function AppNavSidebar() {
  const t = await getTranslations();

  return (
    <s-app-nav>
      {NAV_ITEMS.map(({ path, labelKey }, i) => (
        <a key={path} href={path} {...(i === 0 ? { rel: "home" } : {})}>
          {t(labelKey)}
        </a>
      ))}
    </s-app-nav>
  );
}
