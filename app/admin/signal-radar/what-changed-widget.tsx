import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, Sparkles, ChevronRight } from "lucide-react";
import type { CategoryDelta } from "@/lib/signal-radar/trends";

interface WidgetDelta extends CategoryDelta {
  /** Raw classifier enum value, used to deep-link to the filtered list. */
  rawCategory?: string;
}

export function WhatChangedWidget({ deltas }: { deltas: WidgetDelta[] }) {
  const safeDeltas = deltas ?? [];
  return (
    <div className="rounded-lg bg-white border border-[#E2E8F0] p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-[#2563EB]" />
        <h2 className="font-semibold text-[#0F172A]">What Changed This Week?</h2>
      </div>
      {safeDeltas.length === 0 ? (
        <p className="text-sm text-[#64748B]">
          No data yet — week-over-week comparison needs at least 14 days of signal.
        </p>
      ) : (
        <ul className="divide-y divide-[#E2E8F0] -my-2">
          {safeDeltas.slice(0, 8).map((d) => {
            const raw = d.rawCategory ?? d.category;
            const href = `/admin/signal-radar/all?category=${encodeURIComponent(raw)}`;
            return (
              <li key={raw}>
                <Link
                  href={href}
                  className="flex items-center justify-between gap-3 text-sm py-2 hover:bg-[#F8FAFC] -mx-2 px-2 rounded transition-colors group"
                >
                  <span className="text-[#0F172A] flex items-center gap-1">
                    {d.category}
                    <ChevronRight className="w-3.5 h-3.5 text-[#94A3B8] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[#64748B] text-xs">
                      {d.prior_7d} → {d.current_7d}
                    </span>
                    <DeltaBadge delta={d} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DeltaBadge({ delta }: { delta: CategoryDelta }) {
  const direction = delta.direction;
  if (direction === "new") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#FEF3C7] text-[#92400E]">
        <Sparkles className="w-3 h-3" />
        new
      </span>
    );
  }
  if (direction === "up") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#FEE2E2] text-[#991B1B]">
        <TrendingUp className="w-3 h-3" />
        {delta.delta_pct}%
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#DCFCE7] text-[#166534]">
        <TrendingDown className="w-3 h-3" />
        {delta.delta_pct}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#F1F5F9] text-[#64748B]">
      <Minus className="w-3 h-3" />
      flat
    </span>
  );
}
