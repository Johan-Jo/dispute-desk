"use client";

import { CheckCircle, AlertTriangle, AlertCircle } from "lucide-react";
import { ADMIN_LOCALES } from "@/lib/resources/workflow";

interface LocaleCompletenessBadgeProps {
  locale: string;
  percent: number;
  isActive: boolean;
  onClick: () => void;
}

export function LocaleCompletenessBadge({
  locale,
  percent,
  isActive,
  onClick,
}: LocaleCompletenessBadgeProps) {
  const info = ADMIN_LOCALES.find((l) => l.code === locale || l.dbLocale === locale);
  const flag = info?.flag ?? "🌐";
  const nativeName = info?.nativeName ?? locale;
  const code = info?.code?.toUpperCase() ?? locale;

  const statusBorder =
    percent === 100
      ? "border-[#22C55E] bg-[#F0FDF4]"
      : percent >= 30
        ? "border-[#F59E0B] bg-[#FEF3C7]"
        : "border-[#E1E3E5] bg-white";

  const textColor =
    percent === 100
      ? "text-[#15803D]"
      : percent >= 30
        ? "text-[#92400E]"
        : "text-[#667085]";

  const barColor =
    percent === 100 ? "bg-[#22C55E]" : percent >= 30 ? "bg-[#F59E0B]" : "bg-[#E1E3E5]";

  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all ${
        isActive ? "border-[#1D4ED8] bg-[#EFF6FF] shadow-sm" : `${statusBorder} hover:shadow-sm`
      }`}
    >
      <div className="flex items-center gap-2.5 flex-1">
        <span className="text-lg">{flag}</span>
        <div className="text-left">
          <div
            className={`text-sm font-semibold ${isActive ? "text-[#1D4ED8]" : "text-[#0B1220]"}`}
          >
            {nativeName}
          </div>
          <div className={`text-xs ${isActive ? "text-[#1D4ED8]/70" : "text-[#667085]"}`}>
            {code}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          {percent === 100 ? (
            <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />
          ) : percent >= 30 ? (
            <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-[#E1E3E5]" />
          )}
          <span className={`text-xs font-bold ${textColor}`}>{percent}%</span>
        </div>
        <div className="w-12 h-1 bg-[#E1E3E5] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${barColor}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </button>
  );
}
