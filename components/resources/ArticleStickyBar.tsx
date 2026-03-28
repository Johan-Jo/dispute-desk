"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Bookmark, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useSavedArticles } from "@/lib/resources/useSavedArticles";

type Props = { slug: string };

export function ArticleStickyBar({ slug }: Props) {
  const t = useTranslations("resources");
  const { isSaved, toggle } = useSavedArticles();
  const saved = isSaved(slug);

  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  function handleSave() {
    const nowSaved = toggle(slug);
    setToast(nowSaved ? t("articleSaved") : t("articleUnsaved"));
  }

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
      setToast(t("linkCopied"));
    }
  }

  return (
    <>
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
              onClick={handleSave}
              className={`hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                saved
                  ? "text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE]"
                  : "text-[#64748B] hover:text-[#0B1220] hover:bg-[#F1F5F9]"
              }`}
            >
              <Bookmark
                className="w-4 h-4"
                fill={saved ? "currentColor" : "none"}
              />
              {saved ? t("saved") : t("save")}
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

      {/* Toast notification */}
      <div
        aria-live="polite"
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
          toast
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
        {toast && (
          <div className="bg-[#0B1220] text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </>
  );
}
