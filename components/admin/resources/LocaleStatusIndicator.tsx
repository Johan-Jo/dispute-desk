"use client";

import { getLocaleFlag } from "@/lib/resources/workflow";

interface LocaleStatusIndicatorProps {
  /** Map of locale code (e.g. "en-US") → "complete" | "in-progress" | "missing" */
  locales: Record<string, string>;
  className?: string;
}

const STATUS_SYMBOL: Record<string, string> = {
  complete: "✓",
  "in-progress": "○",
  missing: "—",
};

const STATUS_COLOR: Record<string, string> = {
  complete: "text-[#22C55E]",
  "in-progress": "text-[#F59E0B]",
  missing: "text-[#E1E3E5]",
};

export function LocaleStatusIndicator({ locales, className = "" }: LocaleStatusIndicatorProps) {
  return (
    <div className={`flex items-center justify-center gap-1.5 ${className}`}>
      {Object.entries(locales).map(([code, status]) => (
        <span
          key={code}
          className={`text-xs font-mono ${STATUS_COLOR[status] ?? STATUS_COLOR.missing}`}
          title={`${code.toUpperCase()}: ${status}`}
        >
          {STATUS_SYMBOL[status] ?? STATUS_SYMBOL.missing}
        </span>
      ))}
    </div>
  );
}

interface LocaleFlagsProps {
  localeCodes: string[];
  className?: string;
}

export function LocaleFlags({ localeCodes, className = "" }: LocaleFlagsProps) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {localeCodes.map((code) => (
        <span key={code} className="text-xs" title={code}>
          {getLocaleFlag(code)}
        </span>
      ))}
    </div>
  );
}
