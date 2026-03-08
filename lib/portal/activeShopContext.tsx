"use client";

import { createContext, useContext } from "react";

interface ActiveShopValue {
  activeShopId: string | null;
  activeShopDomain: string | null;
}

const ActiveShopContext = createContext<ActiveShopValue>({
  activeShopId: null,
  activeShopDomain: null,
});

export function ActiveShopProvider({
  activeShopId,
  activeShopDomain,
  children,
}: {
  activeShopId: string | null;
  activeShopDomain?: string | null;
  children: React.ReactNode;
}) {
  return (
    <ActiveShopContext.Provider
      value={{
        activeShopId,
        activeShopDomain: activeShopDomain ?? null,
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
