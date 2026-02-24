"use client";

import { usePathname } from "next/navigation";
import { Shield, Bell, ChevronDown, Store } from "lucide-react";

interface Shop {
  shop_id: string;
  role: string;
  shops: unknown;
}

interface PortalShellProps {
  userEmail: string;
  shops: Shop[];
  activeShopId: string | null;
  activeShopDomain: string | null;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/portal/dashboard", label: "Overview" },
  { href: "/portal/disputes", label: "Disputes" },
  { href: "/portal/packs", label: "Packs" },
  { href: "/portal/rules", label: "Rules" },
  { href: "/portal/policies", label: "Policies" },
  { href: "/portal/billing", label: "Billing" },
  { href: "/portal/team", label: "Team" },
  { href: "/portal/settings", label: "Settings" },
];

export function PortalShell({
  userEmail,
  shops,
  activeShopId,
  activeShopDomain,
  children,
}: PortalShellProps) {
  const pathname = usePathname();

  return (
    <div className="h-screen flex bg-[#F6F8FB]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-[#E5E7EB] flex flex-col">
        {/* Logo */}
        <div className="h-16 px-6 flex items-center border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-[#0B1220]">DisputeDesk</h1>
          </div>
        </div>

        {/* Store selector */}
        <div className="px-4 py-4 border-b border-[#E5E7EB]">
          {shops.length > 0 ? (
            <a
              href="/portal/select-store"
              className="w-full p-3 bg-[#F1F5F9] hover:bg-[#E5E7EB] rounded-lg flex items-center gap-3 transition-colors"
            >
              <Store className="w-4 h-4 text-[#64748B]" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#0B1220] truncate">
                  {activeShopDomain ?? "Select store"}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-[#64748B]" />
            </a>
          ) : (
            <a
              href="/portal/connect-shopify"
              className="block rounded-lg bg-[#1D4ED8] px-3 py-2.5 text-center text-sm font-medium text-white hover:bg-[#1E40AF] transition-colors"
            >
              Connect a store
            </a>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/portal/dashboard" &&
                pathname.startsWith(item.href));
            return (
              <a
                key={item.href}
                href={item.href}
                className={`w-full block px-3 h-10 leading-10 rounded-lg text-sm font-medium transition-colors mb-1 ${
                  isActive
                    ? "bg-[#E0F2FE] text-[#0EA5E9]"
                    : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* User */}
        <div className="border-t border-[#E5E7EB] px-4 py-3">
          <p className="truncate text-xs text-[#64748B]">{userEmail}</p>
          <form action="/api/auth/portal/sign-out" method="POST">
            <button
              type="submit"
              className="mt-1 text-xs text-[#64748B] underline hover:text-[#0B1220]"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-[#E5E7EB] px-6 flex items-center justify-end gap-3">
          <button className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F1F5F9] text-[#64748B] transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-[#EF4444] rounded-full" />
          </button>
          <a
            href="/portal/settings"
            className="flex items-center gap-2 px-3 h-10 rounded-lg hover:bg-[#F1F5F9] transition-colors"
          >
            <div className="w-8 h-8 bg-[#1D4ED8] rounded-full flex items-center justify-center text-white text-sm font-medium">
              {userEmail.charAt(0).toUpperCase()}
            </div>
            <ChevronDown className="w-4 h-4 text-[#64748B]" />
          </a>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-[1120px] mx-auto p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
