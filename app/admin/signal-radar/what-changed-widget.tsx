import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import type { CategoryDelta } from "@/lib/signal-radar/trends";

const CATEGORY_LABELS: Record<string, string> = {
  migration_intent: "Migration intent",
  transparency_frustration: "Transparency complaints",
  operational_overload: "Operational overload",
  reserve_fear: "Reserve fear",
  evidence_confusion: "Evidence confusion",
  support_failure: "Support failure",
  competitor_frustration: "Competitor frustration",
  general_discussion: "General discussion",
  spam: "Spam",
  trolling: "Trolling",
};

export function WhatChangedWidget({ deltas }: { deltas: CategoryDelta[] }) {
  return (
    <div className="rounded-lg bg-white border border-[#E2E8F0] p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-[#2563EB]" />
        <h2 className="font-semibold text-[#0F172A]">What Changed This Week?</h2>
      </div>
      {deltas.length === 0 ? (
        <p className="text-sm text-[#64748B]">No data yet — week-over-week comparison needs at least 14 days of signal.</p>
      ) : (
        <ul className="space-y-2">
          {deltas.slice(0, 8).map((d) => (
            <li
              key={d.category}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-[#0F172A]">
                {CATEGORY_LABELS[d.category] ?? d.category}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[#64748B] text-xs">
                  {d.prior_7d} → {d.current_7d}
                </span>
                <DeltaBadge delta={d} />
              </span>
            </li>
          ))}
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
