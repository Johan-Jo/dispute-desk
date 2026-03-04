"use client";

import { createContext, useContext } from "react";

const DemoModeContext = createContext(false);
const ShopCountContext = createContext(0);
const UseDemoDataContext = createContext(false);

/** Store domains that should show seeded demo data (e.g. dispute list) when connected. */
const TEST_STORE_DOMAINS = [
  "demo.myshopify.com",
];

function isTestStoreDomain(domain: string | null): boolean {
  if (!domain) return false;
  const normalized = domain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return TEST_STORE_DOMAINS.some(
    (d) => normalized === d || normalized.endsWith("." + d)
  );
}

export function DemoModeProvider({
  isDemo,
  children,
  shopCount = 0,
  activeShopDomain = null,
}: {
  isDemo: boolean;
  children: React.ReactNode;
  shopCount?: number;
  activeShopDomain?: string | null;
}) {
  const useDemoData = isDemo || isTestStoreDomain(activeShopDomain ?? null);
  return (
    <DemoModeContext.Provider value={isDemo}>
      <ShopCountContext.Provider value={shopCount}>
        <UseDemoDataContext.Provider value={useDemoData}>
          {children}
        </UseDemoDataContext.Provider>
      </ShopCountContext.Provider>
    </DemoModeContext.Provider>
  );
}

export function useDemoMode(): boolean {
  return useContext(DemoModeContext);
}

export function useShopCount(): number {
  return useContext(ShopCountContext);
}

/** True when we should show demo/seed data (no real shop selected, or connected store is a test store). */
export function useDemoData(): boolean {
  return useContext(UseDemoDataContext);
}
