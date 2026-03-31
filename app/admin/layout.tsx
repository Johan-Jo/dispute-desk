"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Shield,
  Menu,
  Bell,
  ArrowLeft,
  LayoutDashboard,
  List,
  Calendar,
  Clock,
  ListTodo,
  Settings,
  HelpCircle,
  X,
} from "lucide-react";
import { ToastProvider } from "@/components/admin/Toast";

/* ── Resources Hub sub-navigation ───────────────────────────────────── */

const RESOURCES_NAV = [
  { label: "Dashboard", href: "/admin/resources", icon: LayoutDashboard },
  { label: "Content List", href: "/admin/resources/list", icon: List },
  { label: "Calendar", href: "/admin/resources/calendar", icon: Calendar },
  { label: "Queue", href: "/admin/resources/queue", icon: Clock },
  { label: "Backlog", href: "/admin/resources/backlog", icon: ListTodo },
  { label: "Settings", href: "/admin/resources/settings", icon: Settings },
  { label: "Help", href: "/admin/help", icon: HelpCircle },
];

/* ── Top-level admin navigation ─────────────────────────────────────── */

const ADMIN_NAV = [
  { label: "Resources", href: "/admin/resources" },
  { label: "Shops", href: "/admin/shops" },
  { label: "Jobs", href: "/admin/jobs" },
  { label: "Audit Log", href: "/admin/audit" },
  { label: "Billing", href: "/admin/billing" },
  { label: "Team", href: "/admin/team" },
  { label: "Help", href: "/admin/help" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  /** Resources Hub sub-nav only under /admin/resources — Help uses top-level Admin nav to avoid duplicate “Dashboard” etc. */
  const isResourcesSection = pathname.startsWith("/admin/resources");

  function isActive(href: string) {
    if (href === "/admin/resources" && isResourcesSection) {
      return pathname === "/admin/resources";
    }
    return href !== "/admin" && pathname.startsWith(href);
  }

  return (
    <ToastProvider>
    <div className="h-screen flex bg-[#F6F8FB]">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Left sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E5E7EB] flex flex-col transform transition-transform duration-200 ease-in-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="h-16 px-6 flex items-center gap-2 border-b border-[#E5E7EB]">
          <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#0B1220] leading-tight">DisputeDesk</h1>
            <p className="text-xs text-[#64748B]">Admin Portal</p>
          </div>
        </div>

        {/* Back to portal */}
        <div className="px-4 py-3 border-b border-[#E5E7EB]">
          <Link
            href="/admin"
            className="w-full px-3 py-2 bg-[#F1F5F9] hover:bg-[#E5E7EB] rounded-lg flex items-center gap-2 transition-colors text-sm font-medium text-[#0B1220]"
          >
            <ArrowLeft className="w-4 h-4 text-[#64748B]" />
            Back to Admin Home
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {isResourcesSection ? (
            <>
              <p className="mb-2 px-3 text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                Resources Hub
              </p>
              {RESOURCES_NAV.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`w-full px-3 h-10 rounded-lg text-sm font-medium transition-colors mb-1 flex items-center gap-2 ${
                      active
                        ? "bg-[#E0F2FE] text-[#0EA5E9]"
                        : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${active ? "text-[#0EA5E9]" : "text-[#64748B]"}`} />
                    {item.label}
                  </Link>
                );
              })}
            </>
          ) : (
            <>
              <p className="mb-2 px-3 text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                Admin
              </p>
              {ADMIN_NAV.map((item) => {
                const active =
                  item.href === "/admin/resources"
                    ? isResourcesSection
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1 ${
                      active
                        ? "bg-[#E0F2FE] text-[#0EA5E9]"
                        : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#E5E7EB]">
          <div className="flex items-center gap-2 px-3 py-2 bg-[#FEF3C7] border border-[#FDE68A] rounded-lg">
            <Shield className="w-4 h-4 text-[#D97706]" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#92400E]">Admin Access</p>
              <p className="text-xs text-[#B45309] truncate">Content Management</p>
            </div>
          </div>
          <a
            href="/api/admin/logout"
            className="mt-2 block text-center text-xs text-[#64748B] hover:text-[#0B1220] transition-colors"
          >
            Sign Out
          </a>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-[#E5E7EB] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 hover:bg-[#F1F5F9] rounded-lg transition-colors"
            >
              <Menu className="w-5 h-5 text-[#64748B]" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button className="relative p-2 hover:bg-[#F1F5F9] rounded-lg transition-colors">
              <Bell className="w-5 h-5 text-[#64748B]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#EF4444] rounded-full border-2 border-white" />
            </button>
            <div className="h-8 w-8 bg-gradient-to-br from-[#3B82F6] to-[#1D4ED8] rounded-lg flex items-center justify-center">
              <span className="text-sm font-bold text-white">A</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
    </ToastProvider>
  );
}
