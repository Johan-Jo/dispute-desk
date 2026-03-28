"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  CheckSquare,
  ChevronDown,
  FileText,
  Filter,
  Globe,
  Scale,
  TrendingUp,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type FilterDef = {
  param: string;
  labelKey: string;
  icon: LucideIcon;
};

const PRIMARY_FILTERS: FilterDef[] = [
  { param: "", labelKey: "typeAll", icon: BookOpen },
  { param: "cluster_article", labelKey: "types.cluster_article", icon: FileText },
  { param: "template", labelKey: "types.template", icon: FileText },
  { param: "case_study", labelKey: "types.case_study", icon: TrendingUp },
];

const SECONDARY_FILTERS: FilterDef[] = [
  { param: "legal_update", labelKey: "types.legal_update", icon: Scale },
  { param: "pillar_page", labelKey: "types.pillar_page", icon: BookOpen },
  { param: "checklist", labelKey: "types.checklist", icon: CheckSquare },
  { param: "glossary_entry", labelKey: "types.glossary_entry", icon: BookOpen },
  { param: "faq_entry", labelKey: "types.faq_entry", icon: BookOpen },
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "sv", label: "Svenska" },
] as const;

function buildHref(
  base: string,
  next: { q?: string; pillar?: string; type?: string },
) {
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.pillar) p.set("pillar", next.pillar);
  if (next.type) p.set("type", next.type);
  const qs = p.toString();
  return `${base}/resources${qs ? `?${qs}` : ""}`;
}

type Props = {
  base: string;
  pathLocale: string;
  pillar?: string;
  contentType?: string;
  search?: string;
  isFiltered: boolean;
  labels: Record<string, string>;
};

export function ResourcesFilterBar({
  base,
  pathLocale,
  pillar,
  contentType,
  search,
  isFiltered,
  labels,
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const currentLang = LANGUAGES.find((l) => l.code === pathLocale) ?? LANGUAGES[0];

  function renderFilterLink(f: FilterDef, small = false) {
    const active = f.param === "" ? !contentType : contentType === f.param;
    const Icon = f.icon;
    const href = buildHref(base, {
      q: search,
      pillar,
      type: f.param === "" ? undefined : f.param,
    });
    const label = labels[f.labelKey] ?? f.labelKey;

    return (
      <Link
        key={f.param || "all"}
        href={href}
        className={`inline-flex items-center gap-2 rounded-lg font-medium transition-all ${
          small ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm"
        } ${
          active
            ? "bg-[#0B1220] text-white"
            : small
              ? "bg-[#F6F8FB] text-[#0B1220] hover:bg-[#E1E3E5] border border-[#E1E3E5]"
              : "bg-[#F6F8FB] text-[#0B1220] hover:bg-[#E1E3E5]"
        }`}
      >
        <Icon className={small ? "w-3.5 h-3.5" : "w-4 h-4"} aria-hidden />
        {label}
      </Link>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-[#E1E3E5] p-4 mb-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {PRIMARY_FILTERS.map((f) => renderFilterLink(f))}

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              showMore
                ? "bg-[#0B1220] text-white"
                : "bg-[#F6F8FB] text-[#0B1220] hover:bg-[#E1E3E5]"
            }`}
          >
            <Filter className="w-4 h-4" aria-hidden />
            {labels.moreFilters ?? "More Filters"}
          </button>

          {isFiltered && (
            <Link
              href={`${base}/resources`}
              className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B1220] font-medium ml-1"
            >
              <X className="w-4 h-4" aria-hidden />
              {labels.clearFilters ?? "Clear filters"}
            </Link>
          )}
        </div>

        {/* Language selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowLangMenu((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#F6F8FB] text-[#0B1220] hover:bg-[#E1E3E5] transition-all"
          >
            <Globe className="w-4 h-4" aria-hidden />
            {currentLang.label}
            <ChevronDown className="w-4 h-4" aria-hidden />
          </button>

          {showLangMenu && (
            <div className="absolute right-0 top-full mt-2 bg-white rounded-lg border border-[#E1E3E5] shadow-lg py-2 z-10 min-w-[160px]">
              {LANGUAGES.map((lang) => {
                const langBase = lang.code === "en" ? "" : `/${lang.code}`;
                const href = `${langBase}/resources`;
                return (
                  <Link
                    key={lang.code}
                    href={href}
                    onClick={() => setShowLangMenu(false)}
                    className={`block w-full px-4 py-2 text-left text-sm hover:bg-[#F6F8FB] transition-colors ${
                      pathLocale === lang.code
                        ? "text-[#1D4ED8] font-medium"
                        : "text-[#0B1220]"
                    }`}
                  >
                    {lang.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Extended filters */}
      {showMore && (
        <div className="mt-4 pt-4 border-t border-[#E1E3E5]">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm font-medium text-[#667085] py-1.5">
              {labels.additionalTypes ?? "Additional types:"}
            </span>
            {SECONDARY_FILTERS.map((f) => renderFilterLink(f, true))}
          </div>
        </div>
      )}
    </div>
  );
}
