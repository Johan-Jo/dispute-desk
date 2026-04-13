"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Shield,
  Menu,
  Bell,
  Search,
  ChevronDown,
  LayoutDashboard,
  Store,
  Cog,
  FileText,
  GitBranch,
  Activity,
  ScrollText,
  DollarSign,
  Users,
  BookOpen,
  HelpCircle,
  List,
  Calendar,
  Clock,
  ListTodo,
  Settings,
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

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
}

const ADMIN_NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Disputes", href: "/admin/disputes", icon: Shield },
  { label: "Shops", href: "/admin/shops", icon: Store },
  { label: "Jobs", href: "/admin/jobs", icon: Cog },
  { label: "Templates", href: "/admin/templates", icon: FileText, group: "Template Ops" },
  { label: "Reason Mapping", href: "/admin/reason-mapping", icon: GitBranch, group: "Template Ops" },
  { label: "Template Health", href: "/admin/template-health", icon: Activity, group: "Template Ops" },
  { label: "Audit Log", href: "/admin/audit", icon: ScrollText },
  { label: "Billing", href: "/admin/billing", icon: DollarSign },
  { label: "Team", href: "/admin/team", icon: Users },
  { label: "Resources", href: "/admin/resources", icon: BookOpen },
  { label: "Help", href: "/admin/help", icon: HelpCircle },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminUser, setAdminUser] = useState<{ email: string; name: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/admin/team/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setAdminUser(data);
      })
      .catch(() => {});
  }, []);

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  /** Resources Hub sub-nav only under /admin/resources — Help uses top-level Admin nav */
  const isResourcesSection = pathname.startsWith("/admin/resources");

  function isActive(href: string) {
    if (href === "/admin" && !isResourcesSection) {
      return pathname === "/admin";
    }
    if (href === "/admin/resources" && isResourcesSection) {
      return pathname === "/admin/resources";
    }
    return href !== "/admin" && pathname.startsWith(href);
  }

  const initials = adminUser?.name
    ? adminUser.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : adminUser?.email
      ? adminUser.email[0].toUpperCase()
      : "A";

  const displayName = adminUser?.name || adminUser?.email || "Admin User";

  /** Group nav items, inserting section labels before new groups */
  let lastGroup: string | undefined;

  return (
    <ToastProvider>
      <div className="h-screen flex bg-[#F8FAFC]">
        {/* Mobile overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Left sidebar */}
        <aside
          className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E2E8F0] flex flex-col transform transition-transform duration-200 ease-in-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          {/* Logo */}
          <div className="h-16 px-6 flex items-center justify-between border-b border-[#E2E8F0]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-[#0F172A]">DisputeDesk</h1>
                <p className="text-xs text-[#64748B]">Internal Admin</p>
              </div>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden text-[#64748B] hover:text-[#0F172A]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Back to Admin Home — only in Resources sub-nav */}
          {isResourcesSection && (
            <div className="px-4 py-3 border-b border-[#E2E8F0]">
              <Link
                href="/admin"
                className="w-full px-3 py-2 bg-[#F1F5F9] hover:bg-[#E2E8F0] rounded-lg flex items-center gap-2 transition-colors text-sm font-medium text-[#0F172A]"
              >
                <LayoutDashboard className="w-4 h-4 text-[#64748B]" />
                Back to Admin
              </Link>
            </div>
          )}

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
                      className={`w-full px-3 h-10 rounded-lg text-sm font-medium transition-colors mb-0.5 flex items-center gap-3 ${
                        active
                          ? "bg-[#EFF6FF] text-[#1D4ED8]"
                          : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${active ? "text-[#1D4ED8]" : "text-[#64748B]"}`} />
                      {item.label}
                    </Link>
                  );
                })}
              </>
            ) : (
              <>
                {ADMIN_NAV.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/admin"
                      ? pathname === "/admin"
                      : item.href === "/admin/resources"
                        ? isResourcesSection
                        : pathname.startsWith(item.href);

                  // Render group label before first item in a new group
                  const showGroupLabel = item.group && item.group !== lastGroup;
                  if (item.group) lastGroup = item.group;
                  else lastGroup = undefined;

                  return (
                    <div key={item.href}>
                      {showGroupLabel && (
                        <p className="mt-4 mb-2 px-3 text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                          {item.group}
                        </p>
                      )}
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`w-full px-3 h-10 rounded-lg text-sm font-medium transition-colors mb-0.5 flex items-center gap-3 ${
                          active
                            ? "bg-[#EFF6FF] text-[#1D4ED8]"
                            : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                        }`}
                      >
                        <Icon className={`w-4 h-4 ${active ? "text-[#1D4ED8]" : "text-[#64748B]"}`} />
                        {item.label}
                      </Link>
                    </div>
                  );
                })}
              </>
            )}
          </nav>

          {/* Footer — user identity */}
          <div className="px-4 py-4 border-t border-[#E2E8F0]">
            <div className="flex items-center gap-3 px-3 py-2.5 bg-[#FEF3C7] border border-[#FDE68A] rounded-lg">
              <div className="w-8 h-8 bg-[#FBBF24] rounded-full flex items-center justify-center text-xs font-bold text-[#78350F]">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#92400E]">{displayName}</p>
                {adminUser?.email && adminUser.name && (
                  <p className="text-xs text-[#B45309] truncate">{adminUser.email}</p>
                )}
              </div>
            </div>
            <a
              href="/api/admin/logout"
              className="mt-2 block text-center text-xs text-[#64748B] hover:text-[#0F172A] transition-colors"
            >
              Sign Out
            </a>
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="h-16 bg-white border-b border-[#E2E8F0] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-2 hover:bg-[#F1F5F9] rounded-lg transition-colors"
              >
                <Menu className="w-5 h-5 text-[#64748B]" />
              </button>

              {/* Global search placeholder */}
              <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg w-80">
                <Search className="w-4 h-4 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="Search shops, templates, jobs..."
                  className="flex-1 bg-transparent text-sm text-[#0F172A] placeholder:text-[#94A3B8] outline-none"
                  readOnly
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button className="relative p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-lg transition-colors">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#EF4444] rounded-full" />
              </button>

              <div className="w-px h-6 bg-[#E2E8F0]" />

              <div className="flex items-center gap-2 px-3 py-2 hover:bg-[#F1F5F9] rounded-lg transition-colors">
                <div className="w-8 h-8 bg-gradient-to-br from-[#8B5CF6] to-[#EC4899] rounded-full flex items-center justify-center text-xs font-bold text-white">
                  {initials}
                </div>
                <span className="text-sm font-medium text-[#0F172A] hidden sm:block">
                  {displayName}
                </span>
                <ChevronDown className="w-4 h-4 text-[#64748B]" />
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
