"use client";

import { createContext, useContext } from "react";

const ActiveShopContext = createContext<string | null>(null);

export function ActiveShopProvider({
  activeShopId,
  children,
}: {
  activeShopId: string | null;
  children: React.ReactNode;
}) {
  return (
    <ActiveShopContext.Provider value={activeShopId}>
      {children}
    </ActiveShopContext.Provider>
  );
}

export function useActiveShopId(): string | null {
  return useContext(ActiveShopContext);
}
