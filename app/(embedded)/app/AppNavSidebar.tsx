"use client";

/**
 * Registers app navigation with Shopify Admin sidebar via s-app-nav.
 * Renders nothing visible—Shopify reads this to populate the sidebar under "DisputeDesk".
 * Removes the need for in-iframe horizontal nav (EmbeddedAppNav).
 */
import { createElement } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

const NAV_ITEMS: { path: string; labelKey: string }[] = [
  { path: "/app", labelKey: "nav.dashboard" },
  { path: "/app/disputes", labelKey: "nav.disputes" },
  { path: "/app/packs", labelKey: "nav.packs" },
  { path: "/app/rules", labelKey: "nav.rules" },
  { path: "/app/billing", labelKey: "nav.billing" },
  { path: "/app/settings", labelKey: "nav.settings" },
  { path: "/app/help", labelKey: "nav.help" },
];

export function AppNavSidebar() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const shop = searchParams.get("shop");
  const host = searchParams.get("host");
  const qs = new URLSearchParams();
  if (shop) qs.set("shop", shop);
  if (host) qs.set("host", host);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  const children = NAV_ITEMS.map(({ path, labelKey }, i) =>
    createElement(
      "a",
      {
        key: path,
        href: `${path}${suffix}`,
        ...(i === 0 ? { rel: "home" } : {}),
      },
      t(labelKey)
    )
  );

  return createElement("s-app-nav", { style: { display: "none" } }, children);
}
