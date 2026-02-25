"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Shield, ChevronDown, Store, Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { OnboardingProvider, useOnboarding } from "@/components/onboarding/onboarding-provider";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { onboardingSteps } from "@/lib/onboarding-config";
import { DemoModeProvider } from "@/lib/demo-mode";

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

const NAV_KEYS = [
  { href: "/portal/dashboard", key: "overview" },
  { href: "/portal/disputes", key: "disputes" },
  { href: "/portal/packs", key: "packs" },
  { href: "/portal/rules", key: "rules" },
  { href: "/portal/policies", key: "policies" },
  { href: "/portal/billing", key: "billing" },
  { href: "/portal/team", key: "team" },
  { href: "/portal/settings", key: "settings" },
  { href: "/portal/help", key: "help" },
] as const;

export function PortalShell({
  userEmail,
  shops,
  activeShopId,
  activeShopDomain,
  children,
}: PortalShellProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isDemo = shops.length === 0;

  return (
    <DemoModeProvider isDemo={isDemo}>
    <OnboardingProvider>
    <div className="h-screen flex bg-[#F6F8FB]">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E5E7EB] flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        {/* Logo + close on mobile */}
        <div className="h-16 px-6 flex items-center justify-between border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-[#0B1220]">DisputeDesk</h1>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
          >
            <X className="w-5 h-5" />
          </button>
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
            <div className="space-y-2">
              <div className="w-full p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg flex items-center gap-3">
                <Store className="w-4 h-4 text-[#D97706]" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#0B1220]">{t("demoStore")}</p>
                  <p className="text-xs text-[#92400E]">demo.myshopify.com</p>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-[#F59E0B] text-white px-1.5 py-0.5 rounded">
                  Demo
                </span>
              </div>
              <a
                href="/portal/connect-shopify"
                className="block text-center text-xs text-[#1D4ED8] hover:underline"
              >
                {t("connectStore")}
              </a>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {NAV_KEYS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/portal/dashboard" &&
                pathname.startsWith(item.href));
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`w-full block px-3 h-10 leading-10 rounded-lg text-sm font-medium transition-colors mb-1 ${
                  isActive
                    ? "bg-[#E0F2FE] text-[#0EA5E9]"
                    : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                }`}
              >
                {t(item.key)}
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
              {t("signOut")}
            </button>
          </form>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-[#E5E7EB] px-4 lg:px-6 flex items-center justify-between gap-3">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F1F5F9] text-[#64748B] transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="hidden lg:block flex-1" />

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <a
              href="/portal/settings"
              className="flex items-center gap-2 px-3 h-10 rounded-lg hover:bg-[#F1F5F9] transition-colors"
            >
              <div className="w-8 h-8 bg-[#1D4ED8] rounded-full flex items-center justify-center text-white text-sm font-medium">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <ChevronDown className="w-4 h-4 text-[#64748B] hidden sm:block" />
            </a>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-[1120px] mx-auto p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
    <OnboardingTourOverlay />
    </OnboardingProvider>
    </DemoModeProvider>
  );
}

function OnboardingTourOverlay() {
  const { showTour, completeTour, skipTour } = useOnboarding();
  const router = useRouter();

  if (!showTour) return null;

  return (
    <OnboardingTour
      steps={onboardingSteps}
      onComplete={completeTour}
      onSkip={skipTour}
      onNavigate={(path) => router.push(path)}
    />
  );
}
