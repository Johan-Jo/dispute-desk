"use client";

import { useTranslations } from "next-intl";
import { InfoBanner } from "@/components/ui/info-banner";
import { useDemoMode } from "@/lib/demo-mode";

export function DemoNotice() {
  const isDemo = useDemoMode();
  const tc = useTranslations("common");

  if (!isDemo) return null;

  return (
    <div className="mb-6">
      <InfoBanner variant="warning">
        {tc("demoNotice")}{" "}
        <a
          href="/portal/connect-shopify"
          className="font-semibold underline hover:no-underline"
        >
          {tc("connectStoreCTA")} →
        </a>
      </InfoBanner>
    </div>
  );
}
