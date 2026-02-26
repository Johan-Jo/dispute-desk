"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { HELP_CATEGORIES } from "@/lib/help/categories";
import { HELP_ARTICLES, getArticlesByCategory } from "@/lib/help/articles";
import { Rocket, Scale, Package, Zap, CreditCard, Upload, Search } from "lucide-react";

const ICON_MAP = {
  rocket: Rocket,
  scale: Scale,
  package: Package,
  zap: Zap,
  creditCard: CreditCard,
  upload: Upload,
} as const;

export default function PortalHelpPage() {
  const t = useTranslations();
  const [query, setQuery] = useState("");

  const filteredArticles = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return HELP_ARTICLES.filter((a) => {
      const title = t(a.titleKey).toLowerCase();
      const tags = a.tags?.join(" ").toLowerCase() ?? "";
      return title.includes(q) || tags.includes(q);
    });
  }, [query, t]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#0B1220] mb-1">{t("help.title")}</h1>
        <p className="text-[#667085]">{t("help.subtitle")}</p>
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94A3B8]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("help.search")}
          className="w-full h-12 pl-11 pr-4 border border-[#E5E7EB] rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
        />
      </div>

      {filteredArticles ? (
        <div>
          {filteredArticles.length === 0 ? (
            <p className="text-center text-[#667085] py-12">{t("help.noResults")}</p>
          ) : (
            <div className="bg-white rounded-xl border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
              {filteredArticles.map((a) => (
                <Link
                  key={a.slug}
                  href={`/portal/help/${a.slug}`}
                  className="block px-5 py-4 hover:bg-[#F7F8FA] transition-colors"
                >
                  <p className="font-medium text-[#0B1220]">{t(a.titleKey)}</p>
                  <p className="text-xs text-[#94A3B8] mt-0.5 capitalize">
                    {t(HELP_CATEGORIES.find((c) => c.slug === a.category)?.labelKey ?? "")}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {HELP_CATEGORIES.map((cat) => {
              const Icon = ICON_MAP[cat.icon];
              const count = getArticlesByCategory(cat.slug).length;
              return (
                <a
                  key={cat.slug}
                  href={`#${cat.slug}`}
                  className="bg-white rounded-xl border border-[#E5E7EB] p-5 hover:border-[#1D4ED8] hover:shadow-sm transition-all group"
                >
                  <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] flex items-center justify-center mb-3 group-hover:bg-[#1D4ED8] transition-colors">
                    <Icon className="w-5 h-5 text-[#1D4ED8] group-hover:text-white transition-colors" />
                  </div>
                  <h3 className="font-semibold text-[#0B1220] text-sm">{t(cat.labelKey)}</h3>
                  <p className="text-xs text-[#94A3B8] mt-1">{t("help.articleCount", { count })}</p>
                </a>
              );
            })}
          </div>

          {HELP_CATEGORIES.map((cat) => {
            const articles = getArticlesByCategory(cat.slug);
            return (
              <div key={cat.slug} id={cat.slug} className="mb-8">
                <h2 className="text-lg font-bold text-[#0B1220] mb-1">{t(cat.labelKey)}</h2>
                <p className="text-sm text-[#667085] mb-3">{t(cat.descriptionKey)}</p>
                <div className="bg-white rounded-xl border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
                  {articles.map((a) => (
                    <Link
                      key={a.slug}
                      href={`/portal/help/${a.slug}`}
                      className="block px-5 py-4 hover:bg-[#F7F8FA] transition-colors"
                    >
                      <p className="font-medium text-[#0B1220] text-sm">{t(a.titleKey)}</p>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="text-center py-8 text-sm text-[#667085]">
        {t("help.contactSupport")}
      </div>
    </div>
  );
}
