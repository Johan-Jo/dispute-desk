import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { CompetitorPainRow } from "@/lib/signal-radar/queries";
import { SignalCard, StreamShell } from "./stream-shared";

export function CompetitorPainStream({ rows }: { rows: CompetitorPainRow[] }) {
  return (
    <StreamShell
      icon="⚠"
      title="Competitor pain spikes"
      description="Merchants venting about specific dispute / fraud tools. Sorted by mentions in the last 7 days; the delta compares to the prior 7."
      isEmpty={rows.length === 0}
      emptyMessage="No competitor mentions in the last 14 days."
    >
      {rows.map((row) => (
        <CompetitorBlock key={row.competitor} row={row} />
      ))}
    </StreamShell>
  );
}

function CompetitorBlock({ row }: { row: CompetitorPainRow }) {
  return (
    <div className="rounded-md border border-[#E2E8F0] bg-white p-4">
      <header className="flex items-center gap-3 mb-3">
        <h3 className="font-semibold text-[#0F172A] capitalize">{row.competitor}</h3>
        <span className="text-xs text-[#64748B]">
          {row.count_prior_7d} → {row.count_7d} mentions
        </span>
        <DeltaBadge delta={row.delta_pct} cur={row.count_7d} prior={row.count_prior_7d} />
      </header>
      <div className="space-y-2">
        {row.recent_signals.map((s) => (
          <SignalCard key={s.source_id} signal={s} />
        ))}
      </div>
    </div>
  );
}

function DeltaBadge({
  delta,
  cur,
  prior,
}: {
  delta: number;
  cur: number;
  prior: number;
}) {
  if (cur === 0 && prior === 0) {
    return null;
  }
  if (prior === 0 && cur > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#FEF3C7] text-[#92400E]">
        new
      </span>
    );
  }
  if (delta > 5) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#FEE2E2] text-[#991B1B]">
        <TrendingUp className="w-3 h-3" />
        {delta}%
      </span>
    );
  }
  if (delta < -5) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#DCFCE7] text-[#166534]">
        <TrendingDown className="w-3 h-3" />
        {delta}%
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
