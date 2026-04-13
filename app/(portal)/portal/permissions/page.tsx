"use client";

import { useTranslations } from "next-intl";
import { InlineError } from "@/components/ui/inline-error";
import { Button } from "@/components/ui/button";

export default function PermissionsPage() {
  const t = useTranslations("permissions");
  const _tc = useTranslations("common");
  return (
    <div className="max-w-md mx-auto py-8">
      <h2 className="text-2xl font-bold text-[#0B1220] mb-2">
        {t("title")}
      </h2>
      <p className="text-sm text-[#667085] mb-6">
        {t("subtitle")}
      </p>

      <InlineError
        title={t("missingPermissions")}
        message={t("missingPermissionsMessage")}
      />

      <div className="bg-[#F7F8FA] rounded-lg p-4 mt-4">
        <h4 className="font-semibold text-[#0B1220] mb-2">
          {t("requiredPermissions")}
        </h4>
        <ul className="space-y-1 text-sm text-[#667085]">
          <li>&bull; {t("readOrders")}</li>
          <li>&bull; {t("readDisputes")}</li>
          <li>&bull; {t("readCustomerData")}</li>
          <li>&bull; {t("readFulfillments")}</li>
        </ul>
      </div>

      <div className="space-y-3 mt-6">
        <a href="/portal/connect-shopify">
          <Button variant="primary" className="w-full">
            {t("retryConnection")}
          </Button>
        </a>
        <a href="mailto:support@disputedesk.com">
          <Button variant="ghost" className="w-full">
            {t("contactSupport")}
          </Button>
        </a>
      </div>
    </div>
  );
}
