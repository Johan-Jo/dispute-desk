"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  ShoppingBag,
  Package,
  Users,
  Megaphone,
  Tag,
  FileText,
  BarChart3,
  Blocks,
  Settings as SettingsIcon,
  Shield,
  ChevronRight,
} from "lucide-react";
import { useDemoToast } from "./DemoToast";
import { cn } from "@/components/ui/utils";

interface InertItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SHOPIFY_INERT_ITEMS: InertItem[] = [
  { label: "Home", icon: Home },
  { label: "Orders", icon: ShoppingBag },
  { label: "Products", icon: Package },
  { label: "Customers", icon: Users },
  { label: "Marketing", icon: Megaphone },
  { label: "Discounts", icon: Tag },
  { label: "Content", icon: FileText },
  { label: "Analytics", icon: BarChart3 },
];

interface DisputeDeskNavItem {
  label: string;
  href: string;
  /** Match if the current pathname starts with this prefix. */
  matchPrefix: string;
}

// Demo-focused subset of the real embedded nav (defined in
// app/(embedded)/app/AppNavSidebar.tsx). Policies, Billing, Settings,
// and Help are hidden in the demo — they're either merchant-config
// pages (Settings, Policies) that don't tell the value story, or
// orthogonal flows (Billing, Help) that distract from the tour path.
// The pages themselves still exist under /demo/* for direct linking,
// just not surfaced in the sidebar.
const DISPUTEDESK_ITEMS: DisputeDeskNavItem[] = [
  { label: "Dashboard", href: "/demo", matchPrefix: "/demo" },
  { label: "Disputes", href: "/demo/disputes", matchPrefix: "/demo/disputes" },
  { label: "Coverage", href: "/demo/coverage", matchPrefix: "/demo/coverage" },
  { label: "Automation", href: "/demo/rules", matchPrefix: "/demo/rules" },
  { label: "Playbooks", href: "/demo/packs", matchPrefix: "/demo/packs" },
  { label: "Insights", href: "/demo/insights/initial-analysis", matchPrefix: "/demo/insights" },
];

export function InertSidebar() {
  const pathname = usePathname() ?? "/demo";
  const { show } = useDemoToast();

  const handleInert = (label: string) => () => {
    show(`This is a demo — ${label} is not interactive. Install DisputeDesk on your Shopify store to use it.`);
  };

  return (
    <aside className="w-[240px] flex-shrink-0 bg-[#FAFBFB] border-r border-[#E1E3E5] flex flex-col overflow-y-auto">
      {/* Shopify standard items — inert */}
      <nav className="py-2">
        {SHOPIFY_INERT_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              onClick={handleInert(item.label)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-[#303030] hover:bg-[#F1F2F4] transition-colors text-left"
            >
              <Icon className="w-4 h-4 text-[#616161]" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Apps section */}
      <div className="mt-3 px-3 pb-1">
        <div className="text-[11px] uppercase tracking-wider text-[#616161] font-semibold">Apps</div>
      </div>

      {/* DisputeDesk — active app, with sub-nav */}
      <div className="px-1">
        <div className="flex items-center gap-2.5 px-2 py-1.5 text-[13px] font-semibold text-[#0B1220] bg-[#F1F2F4] rounded-md mx-1">
          <Shield className="w-4 h-4 text-[#7C3AED]" />
          <span>DisputeDesk</span>
        </div>
        <nav className="mt-1 mb-3">
          {DISPUTEDESK_ITEMS.map((item) => {
            const isExactMatch = pathname === item.href;
            const isPrefixMatch =
              item.matchPrefix !== "/demo"
                ? pathname.startsWith(item.matchPrefix)
                : pathname === "/demo";
            const active = isExactMatch || isPrefixMatch;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 pl-9 pr-3 py-1.5 text-[13px] transition-colors",
                  active
                    ? "text-[#0B1220] font-medium bg-[#E5E7EB]/40 border-l-2 border-[#7C3AED] -ml-px"
                    : "text-[#303030] hover:bg-[#F1F2F4] border-l-2 border-transparent -ml-px",
                )}
              >
                <span>{item.label}</span>
                {active && <ChevronRight className="w-3 h-3 ml-auto text-[#7C3AED]" />}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Other inert apps */}
      <nav className="px-1 pb-2">
        {["Loox Reviews", "AfterShip", "Klaviyo"].map((label) => (
          <button
            key={label}
            type="button"
            onClick={handleInert(label)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-[#303030] hover:bg-[#F1F2F4] transition-colors text-left"
          >
            <Blocks className="w-4 h-4 text-[#616161]" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto border-t border-[#E1E3E5] py-2">
        <button
          type="button"
          onClick={handleInert("Settings")}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-[#303030] hover:bg-[#F1F2F4] transition-colors text-left"
        >
          <SettingsIcon className="w-4 h-4 text-[#616161]" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
