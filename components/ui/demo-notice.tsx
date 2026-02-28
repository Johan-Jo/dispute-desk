"use client";

import { useTranslations } from "next-intl";
import { InfoBanner } from "@/components/ui/info-banner";

export function DemoNotice() {
  const tc = useTranslations("common");

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
