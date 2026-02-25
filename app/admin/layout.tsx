"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/admin" },
  { label: "Shops", href: "/admin/shops" },
  { label: "Jobs", href: "/admin/jobs" },
  { label: "Audit Log", href: "/admin/audit" },
  { label: "Billing", href: "/admin/billing" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex bg-[#F7F8FA]">
      <aside className="w-56 bg-[#0B1220] text-white flex flex-col shrink-0">
        <div className="p-4 border-b border-white/10">
          <h2 className="font-bold text-sm tracking-wide">DisputeDesk</h2>
          <p className="text-xs text-white/50">Admin Panel</p>
        </div>
        <nav className="flex-1 py-2">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-4 py-2 text-sm transition-colors ${
                  active ? "bg-white/10 text-white font-medium" : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10">
          <a href="/api/admin/logout" className="text-xs text-white/40 hover:text-white/70">
            Sign Out
          </a>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
