"use client";

import { ExternalLink, X, TrendingUp } from "lucide-react";
import type { FeedRow } from "./feed-client";
import { categoryLabel } from "@/lib/signal-radar/category-labels";

export function DetailPanel({
  row,
  onClose,
}: {
  row: FeedRow | null;
  onClose: () => void;
}) {
  if (!row) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-white z-50 shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-[#E2E8F0] p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-[#64748B] mb-1">
              {row.platform}
              {row.subreddit ? ` · ${row.subreddit}` : ""} · {row.content_type}
            </div>
            <h3 className="font-semibold text-[#0F172A]">
              {row.title ?? row.content_excerpt.slice(0, 100)}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#0F172A] flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          <section className="rounded-lg bg-[#EFF6FF] border border-[#DBEAFE] p-4">
            <div className="text-xs uppercase tracking-wide text-[#1D4ED8] font-semibold mb-1">
              Why this matters
            </div>
            <p className="text-sm text-[#0F172A] leading-relaxed">
              {row.why_this_matters}
            </p>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wide text-[#64748B] font-semibold mb-2">
              Scores
            </div>
            <div className="grid grid-cols-4 gap-2">
              <ScoreCell label="Signal" value={row.signal_score} hint="DisputeDesk-strategic value" />
              <ScoreCell
                label="Emotion"
                value={row.emotional_intensity_score}
                hint="Psychological urgency / panic"
              />
              <ScoreCell
                label="Frustration"
                value={row.frustration_score}
                hint="Operational / financial pain"
              />
              <ScoreCell
                label="Confidence"
                value={row.source_confidence_score}
                hint="Source quality / specificity"
              />
            </div>
          </section>

          {(row.merchant_scale_signals ?? []).length > 0 && (
            <section>
              <div className="text-xs uppercase tracking-wide text-[#64748B] font-semibold mb-2">
                Merchant scale signals
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(row.merchant_scale_signals ?? []).map((s, i) => (
                  <span
                    key={i}
                    className="text-xs px-2 py-1 rounded bg-[#F1F5F9] text-[#0F172A]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {row.cluster_size_24h != null && row.cluster_size_24h > 0 && (
            <section className="flex items-center gap-2 text-sm text-[#475569]">
              <TrendingUp className="w-4 h-4 text-[#2563EB]" />
              <span>
                cluster: {row.cluster_size_24h} similar in last 24h
                {row.cluster_growth_rate != null && row.cluster_growth_rate >= 1.5 && (
                  <span className="ml-2 px-2 py-0.5 rounded bg-[#FEE2E2] text-[#991B1B] text-xs font-medium">
                    ↑ {row.cluster_growth_rate}× over prior 24h
                  </span>
                )}
              </span>
            </section>
          )}

          <section>
            <div className="text-xs uppercase tracking-wide text-[#64748B] font-semibold mb-2">
              Summary
            </div>
            <p className="text-sm text-[#475569] leading-relaxed">{row.summary}</p>
          </section>

          {row.suggested_angle && (
            <section>
              <div className="text-xs uppercase tracking-wide text-[#64748B] font-semibold mb-2">
                Suggested angle
              </div>
              <p className="text-sm text-[#475569] leading-relaxed">
                {row.suggested_angle}
              </p>
            </section>
          )}

          <section>
            <div className="text-xs uppercase tracking-wide text-[#64748B] font-semibold mb-2">
              Excerpt
            </div>
            <p className="text-sm text-[#475569] whitespace-pre-wrap leading-relaxed">
              {row.content_excerpt}
            </p>
          </section>

          <section className="flex flex-wrap gap-2 pt-2 border-t border-[#E2E8F0]">
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
            >
              <ExternalLink className="w-4 h-4" />
              Open original
            </a>
            <span className="ml-auto text-xs text-[#94A3B8] self-center">
              author: {row.author ?? "unknown"} · {categoryLabel(row.category)}
              {row.competitor ? ` · competitor: ${row.competitor}` : ""}
            </span>
          </section>
        </div>
      </aside>
    </>
  );
}

function ScoreCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded border border-[#E2E8F0] p-2 text-center" title={hint}>
      <div className="text-[10px] uppercase text-[#64748B] tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-[#0F172A] leading-tight">{value}</div>
    </div>
  );
}
