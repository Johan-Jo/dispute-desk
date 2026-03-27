"use client";

import { ArrowLeft, Bookmark, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function ArticleStickyBar() {
  const t = useTranslations("resources");

  async function handleShare() {
    const url = window.location.href;
    const title = document.title;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        /* user cancelled */
      }
    } else {
      await navigator.clipboard.writeText(url);
    }
  }

  return (
    <header className="bg-white border-b border-[#E5E7EB] sticky top-16 z-40">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link
          href="/resources"
          className="flex items-center gap-2 text-[#64748B] hover:text-[#0B1220] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium hidden sm:inline">
            {t("backToResources")}
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-[#64748B] hover:text-[#0B1220] hover:bg-[#F1F5F9] transition-colors"
          >
            <Bookmark className="w-4 h-4" />
            {t("save")}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-[#64748B] hover:text-[#0B1220] hover:bg-[#F1F5F9] transition-colors"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">{t("share")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
