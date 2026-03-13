/**
 * Embedded app shell — Figma Make: shopify-shell.tsx
 * Top bar #1A1A1A, left sidebar nav, active #E0F2FE/#1D4ED8.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  Settings2,
  CreditCard,
  HelpCircle,
  Cog,
} from "lucide-react";

const NAV_ITEMS: { path: string; labelKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { path: "/app", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { path: "/app/disputes", labelKey: "nav.disputes", icon: FileText },
  { path: "/app/packs", labelKey: "nav.packs", icon: FolderOpen },
  { path: "/app/rules", labelKey: "nav.rules", icon: Settings2 },
  { path: "/app/billing", labelKey: "nav.billing", icon: CreditCard },
  { path: "/app/settings", labelKey: "nav.settings", icon: Cog },
];

export function EmbeddedAppNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <div className="flex min-h-screen flex-col bg-[#F1F2F4]">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-[#2D2D2D] bg-[#1A1A1A] px-6 py-3">
        <Link href="/app" className="flex items-center gap-2 text-white no-underline">
          <span className="text-lg font-semibold tracking-tight">DisputeDesk</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/app/help"
            className="flex items-center gap-2 text-sm font-medium text-[#E5E7EB] no-underline hover:text-white"
          >
            <HelpCircle className="h-4 w-4" />
            {t("nav.help")}
          </Link>
          <Link
            href="/app/settings#automation"
            className="flex items-center gap-2 rounded-md bg-[#2D2D2D] px-4 py-2 text-sm font-medium text-white no-underline hover:bg-[#3D3D3D]"
          >
            {t("dashboard.automationSettings")}
          </Link>
        </div>
      </header>

      {/* Sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar nav — dark pane per Figma */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-[#2D2D2D] bg-[#1A1A1A]">
          <nav className="flex flex-col gap-0.5 p-3">
            {NAV_ITEMS.map(({ path, labelKey, icon: Icon }) => {
              const isActive =
                path === "/app"
                  ? pathname === "/app" || pathname === "/app/"
                  : pathname.startsWith(path);
              return (
                <Link
                  key={path}
                  href={path}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-[#E0F2FE] text-[#1D4ED8]"
                      : "text-[#E5E7EB] hover:bg-[#2D2D2D] hover:text-white"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {t(labelKey)}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto px-6 pb-6 pt-6">{children}</main>
      </div>
    </div>
  );
}
