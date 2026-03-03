"use client";

import { createContext, useContext } from "react";

const DemoModeContext = createContext(false);
const ShopCountContext = createContext(0);

export function DemoModeProvider({
  isDemo,
  children,
  shopCount = 0,
}: {
  isDemo: boolean;
  children: React.ReactNode;
  shopCount?: number;
}) {
  return (
    <DemoModeContext.Provider value={isDemo}>
      <ShopCountContext.Provider value={shopCount}>
        {children}
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
