/**
 * Single source of truth for app section order and routes.
 * Used by portal nav, embedded app (optional nav), and setup wizard step order.
 */

export interface AppSection {
  id: string;
  /** Portal route (e.g. /portal/dashboard) */
  portalHref: string;
  /** Embedded app route (e.g. /app or /app/disputes) */
  embeddedHref: string;
  /** i18n key under "nav" namespace (e.g. overview, disputes) */
  navKey: string;
}

export const APP_SECTIONS: AppSection[] = [
  { id: "overview", portalHref: "/portal/dashboard", embeddedHref: "/app", navKey: "overview" },
  { id: "disputes", portalHref: "/portal/disputes", embeddedHref: "/app/disputes", navKey: "disputes" },
  { id: "packs", portalHref: "/portal/packs", embeddedHref: "/app/packs", navKey: "packs" },
  { id: "rules", portalHref: "/portal/rules", embeddedHref: "/app/rules", navKey: "rules" },
  { id: "policies", portalHref: "/portal/policies", embeddedHref: "/app/policies", navKey: "policies" },
  { id: "billing", portalHref: "/portal/billing", embeddedHref: "/app/billing", navKey: "billing" },
  { id: "team", portalHref: "/portal/team", embeddedHref: "/app/team", navKey: "team" },
  { id: "settings", portalHref: "/portal/settings", embeddedHref: "/app/settings", navKey: "settings" },
  { id: "help", portalHref: "/portal/help", embeddedHref: "/app/help", navKey: "help" },
];

/** Portal nav items derived from app sections (for sidebar) */
export const PORTAL_NAV_ITEMS = APP_SECTIONS.map((s) => ({
  href: s.portalHref,
  key: s.navKey,
}));

export const APP_SECTION_IDS = APP_SECTIONS.map((s) => s.id);
