"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { FileText, Eye, Download, Info } from "lucide-react";
import { useCompleteSetupStep } from "@/lib/setup/useCompleteSetupStep";
import { useActiveShopId } from "@/lib/portal/activeShopContext";
import { useDemoMode } from "@/lib/demo-mode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DemoNotice } from "@/components/ui/demo-notice";

const STATIC_POLICIES = [
  { nameKey: "termsOfService", typeKey: "legalAgreement", format: "PDF", size: "245 KB", lastUpdated: "2026-01-15", policyType: "terms" as const, url: null as string | null },
  { nameKey: "refundPolicy", typeKey: "customerPolicy", format: "PDF", size: "128 KB", lastUpdated: "2026-02-01", policyType: "refunds" as const, url: null as string | null },
  { nameKey: "privacyPolicy", typeKey: "legalAgreement", format: "PDF", size: "312 KB", lastUpdated: "2026-01-20", policyType: null as string | null, url: null as string | null },
  { nameKey: "shippingPolicy", typeKey: "customerPolicy", format: "PDF", size: "98 KB", lastUpdated: "2026-02-10", policyType: "shipping" as const, url: null as string | null },
];

export default function PoliciesPage() {
  useCompleteSetupStep("business_policies");
  const t = useTranslations("policies");
  const tc = useTranslations("common");
  const locale = useLocale();
  const isDemo = useDemoMode();
  const shopId = useActiveShopId() ?? "";

  const [policyByType, setPolicyByType] = useState<Record<string, { url: string | null; captured_at: string }>>({});

  const fetchPolicies = useCallback(async () => {
    if (isDemo || !shopId) return;
    try {
      const res = await fetch(`/api/policies?shop_id=${encodeURIComponent(shopId)}`);
      const data = await res.json();
      const list = data.policies ?? [];
      const byType: Record<string, { url: string | null; captured_at: string }> = {};
      for (const p of list) {
        byType[p.policy_type] = { url: p.url ?? null, captured_at: p.captured_at ?? "" };
      }
      setPolicyByType(byType);
    } catch {
      setPolicyByType({});
    }
  }, [shopId, isDemo]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const policies = STATIC_POLICIES.map((staticRow) => {
    const api = staticRow.policyType ? policyByType[staticRow.policyType] : null;
    return {
      ...staticRow,
      url: api?.url ?? null,
      lastUpdated: api?.captured_at ? new Date(api.captured_at).toISOString().slice(0, 10) : staticRow.lastUpdated,
    };
  });

  const handlePreview = (url: string | null) => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      alert(t("previewNotAvailable"));
    }
  };

  const handleDownload = (url: string | null) => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      alert(t("previewNotAvailable"));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220] mb-2">{t("title")}</h1>
          <p className="text-sm text-[#667085]">
            {t("subtitle")}
          </p>
        </div>
        <Button variant="primary" size="sm" title={tc("demoOnly")} onClick={demoClick} data-onboarding="add-policy-button">
          <FileText className="w-4 h-4 mr-2" />
          {t("addPolicy")}
        </Button>
      </div>

      <DemoNotice />

      {/* Info card */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4 mb-6 flex items-start gap-3">
        <Info className="w-5 h-5 text-[#3B82F6] flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-semibold text-[#1E40AF] mb-1">{t("aboutPolicyDocs")}</h4>
          <p className="text-sm text-[#1E40AF]/80">
            {t("aboutPolicyDocsDesc")}
          </p>
        </div>
      </div>

      <div className="space-y-3" data-onboarding="policy-documents">
        {policies.map((policy) => (
          <div
            key={policy.nameKey}
            className="bg-white rounded-lg border border-[#E5E7EB] p-4 sm:p-5 hover:border-[#CBD5E1] transition-colors"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-[#3B82F6]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#0B1220]">{t(policy.nameKey)}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <Badge variant={policy.typeKey === "legalAgreement" ? "info" : "default"}>
                      {t(policy.typeKey)}
                    </Badge>
                    <span className="text-xs text-[#667085]">{policy.format}</span>
                    <span className="text-xs text-[#667085]">{policy.size}</span>
                    {policy.lastUpdated && (
                      <span className="text-xs text-[#667085]">{t("updated")} {new Date(policy.lastUpdated).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  title={policy.url ? undefined : tc("demoOnly")}
                  onClick={() => handlePreview(isDemo ? null : policy.url)}
                >
                  <Eye className="w-4 h-4 mr-1" />
                  {t("preview")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title={policy.url ? undefined : tc("demoOnly")}
                  onClick={() => handleDownload(isDemo ? null : policy.url)}
                >
                  <Download className="w-4 h-4 mr-1" />
                  {t("download")}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
