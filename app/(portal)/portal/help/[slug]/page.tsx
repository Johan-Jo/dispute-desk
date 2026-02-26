"use client";

import { use } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getArticleBySlug, HELP_ARTICLES } from "@/lib/help/articles";
import { getCategoryBySlug } from "@/lib/help/categories";
import { ChevronRight } from "lucide-react";

export default function PortalHelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const t = useTranslations();
  const article = getArticleBySlug(slug);

  if (!article) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <p className="text-[#667085]">{t("help.articleNotFound")}</p>
        <Link href="/portal/help" className="text-[#1D4ED8] text-sm hover:underline mt-2 inline-block">
          {t("help.backToHelp")}
        </Link>
      </div>
    );
  }

  const category = getCategoryBySlug(article.category);
  const body = t(article.bodyKey);
  const paragraphs = body.split("\n\n");

  const related = (article.relatedSlugs ?? [])
    .map((s) => HELP_ARTICLES.find((a) => a.slug === s))
    .filter(Boolean);

  return (
    <div className="max-w-3xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-[#94A3B8] mb-6">
        <Link href="/portal/help" className="hover:text-[#1D4ED8]">{t("help.title")}</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        {category && (
          <>
            <Link href={`/portal/help#${category.slug}`} className="hover:text-[#1D4ED8]">
              {t(category.labelKey)}
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
          </>
        )}
        <span className="text-[#667085]">{t(article.titleKey)}</span>
      </nav>

      <h1 className="text-2xl font-bold text-[#0B1220] mb-6">{t(article.titleKey)}</h1>

      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-8">
        <div className="prose prose-sm max-w-none text-[#374151]">
          {paragraphs.map((p, i) => {
            const lines = p.split("\n");
            const isList = lines.every((l) => /^[-•\d]+[.)]\s/.test(l.trim()) || l.trim() === "");
            if (isList) {
              return (
                <ul key={i} className="list-disc pl-5 space-y-1 my-3">
                  {lines.filter((l) => l.trim()).map((l, j) => (
                    <li key={j}>{l.replace(/^[-•\d]+[.)]\s*/, "")}</li>
                  ))}
                </ul>
              );
            }
            return <p key={i} className="my-3 leading-relaxed">{p}</p>;
          })}
        </div>
      </div>

      {related.length > 0 && (
        <div className="mb-8">
          <h3 className="font-semibold text-[#0B1220] mb-3">{t("help.relatedArticles")}</h3>
          <div className="bg-white rounded-xl border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
            {related.map((r) => r && (
              <Link
                key={r.slug}
                href={`/portal/help/${r.slug}`}
                className="block px-5 py-3 hover:bg-[#F7F8FA] transition-colors text-sm font-medium text-[#1D4ED8]"
              >
                {t(r.titleKey)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="text-center py-4">
        <Link href="/portal/help" className="text-sm text-[#1D4ED8] hover:underline">
          ← {t("help.backToHelp")}
        </Link>
      </div>
    </div>
  );
}
