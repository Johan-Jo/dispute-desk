"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { useActiveShopId } from "@/lib/portal/activeShopContext";
import { TemplateLibraryContent } from "@/components/packs/TemplateLibraryContent";

export default function TemplateLibraryPage() {
  const t = useTranslations("templateLibrary");
  const router = useRouter();
  const shopId = useActiveShopId() ?? "";
  const locale = useLocale();

  const handleBack = () => router.push("/portal/packs");
  const handleInstalled = (packId: string) => router.push(`/portal/packs/${packId}`);

  return (
    <div className="min-h-full bg-[#F6F8FB]">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* Back + header (Figma Make: Back to Evidence Packs, then title + subtitle) */}
        <div className="mb-6">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-2 text-[#667085] hover:text-[#0B1220] transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("backToPacks")}
          </button>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-[#0B1220] mb-2">
                {t("title")}
              </h1>
              <p className="text-[#667085]">
                {t("subtitle")}
              </p>
            </div>
          </div>
        </div>

        <TemplateLibraryContent
          shopId={shopId}
          locale={locale}
          onInstalled={handleInstalled}
          onGoToPacks={handleBack}
          onBack={handleBack}
          isActive={true}
          layoutMode="page"
        />
      </div>
    </div>
  );
}
