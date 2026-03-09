"use client";

import { createContext, useContext } from "react";

/** Language of policy template content. User chooses explicitly (e.g. English even when UI is German). */
export type PolicyTemplateLang = "en" | "de" | "fr" | "es" | "pt" | "sv";

export interface ActiveShopData {
  shop_domain: string | null;
  locale: string | null;
  plan: string | null;
  /** Language of policy template text (en, de, fr, es, pt, sv). */
  policy_template_lang: PolicyTemplateLang;
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
  policy_template_lang: "en",
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
  activeShopPolicyTemplateLang,
  children,
}: {
  activeShopId: string | null;
  activeShopDomain?: string | null;
  activeShopLocale?: string | null;
  activeShopPlan?: string | null;
  activeShopPolicyTemplateLang?: PolicyTemplateLang | null;
  children: React.ReactNode;
}) {
  const activeShopData: ActiveShopData = {
    shop_domain: activeShopDomain ?? null,
    locale: activeShopLocale ?? null,
    plan: activeShopPlan ?? null,
    policy_template_lang: activeShopPolicyTemplateLang ?? "en",
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
