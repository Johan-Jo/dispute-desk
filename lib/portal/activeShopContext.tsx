"use client";

import { createContext, useContext } from "react";

export interface ActiveShopData {
  shop_domain: string | null;
  locale: string | null;
  plan: string | null;
}

interface ActiveShopValue {
  activeShopId: string | null;
  activeShopDomain: string | null;
  activeShopData: ActiveShopData;
}

const defaultShopData: ActiveShopData = {
  shop_domain: null,
  locale: null,
  plan: null,
};

const ActiveShopContext = createContext<ActiveShopValue>({
  activeShopId: null,
  activeShopDomain: null,
  activeShopData: defaultShopData,
});

export function ActiveShopProvider({
  activeShopId,
  activeShopDomain,
  activeShopLocale,
  activeShopPlan,
  children,
}: {
  activeShopId: string | null;
  activeShopDomain?: string | null;
  activeShopLocale?: string | null;
  activeShopPlan?: string | null;
  children: React.ReactNode;
}) {
  const activeShopData: ActiveShopData = {
    shop_domain: activeShopDomain ?? null,
    locale: activeShopLocale ?? null,
    plan: activeShopPlan ?? null,
  };
  return (
    <ActiveShopContext.Provider
      value={{
        activeShopId,
        activeShopDomain: activeShopDomain ?? null,
        activeShopData,
      }}
    >
      {children}
    </ActiveShopContext.Provider>
  );
}

export function useActiveShopId(): string | null {
  return useContext(ActiveShopContext).activeShopId;
}

export function useActiveShopDomain(): string | null {
  return useContext(ActiveShopContext).activeShopDomain;
}

export function useActiveShopData(): ActiveShopData {
  return useContext(ActiveShopContext).activeShopData;
}
