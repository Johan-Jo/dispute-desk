"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Microscope } from "lucide-react";
import {
  categoryLabel,
  categoryMeaning,
  reviewStateLabel,
} from "@/lib/postOutcome/labels";

/**
 * Compact post-outcome context for /admin/shops/[id] (plan §14.2) and the
 * internal dispute detail (plan §14.3).
 *
 * Deliberately NOT a second findings table. Plan §14.2 says the shop page must
 * not become another Outcome Analysis surface, and two tables over the same
 * data drift the moment one is edited. This shows counts and links out.
 *
 * "Confirmed" counts REVIEWED findings only. An unreviewed finding is a
 * hypothesis (plan §17), and a card labelled confirmed that counted hypotheses
 * would be the exact failure this feature exists to avoid.
 */

interface Analysis {
  analysisId: string;
  disputeId: string;
  outcome: "won" | "lost";
  finalizedAt: string | null;
  analysisLevel: string;
  analysisStatus: string;
  reasonSpecificStatus: string;
  dataIntegrityLimitation: boolean;
  submissionConfirmationSource: string;
  actionable: boolean;
  analyzerVersion: number;
  reviewState: string;
  category: string | null;
  confidence: string | null;
}

interface SummaryResponse {
  analyses: Analysis[];
  counts: {
    analysed: number;
    won: number;
    lost: number;
    fullAnalysis: number;
    blocked: number;
    actionable: number;
    pendingReview: number;
    confirmed: number;
  };
  confirmedByCategory: Record<string, number>;
}

const FORWARDED = new Set(["SHOPIFY_EVIDENCE_SENT_ON", "PROVIDER_LOG"]);

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[#64748B] uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold text-[#0F172A]">{value}</div>
    </div>
  );
}

export function PostOutcomeInsights({
  shopId,
  disputeId,
}: {
  shopId?: string;
  disputeId?: string;
}) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (disputeId) params.set("dispute_id", disputeId);
    else if (shopId) params.set("shop_id", shopId);
    if (!params.toString()) return;

    let cancelled = false;
    fetch(`/api/admin/outcome-analysis/summary?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, disputeId]);

  if (loading) return null;
  // Nothing analysed is a real and common state — say so rather than rendering
  // an empty shell that looks like a loading failure.
  if (!data || data.counts.analysed === 0) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Microscope className="w-4 h-4 text-[#64748B]" />
          <h2 className="font-semibold text-[#0F172A]">Post-outcome analysis</h2>
        </div>
        <p className="text-sm text-[#64748B]">
          {disputeId
            ? "This dispute has not been analysed. Analysis runs on decided disputes that carry a package we filed."
            : "No decided disputes for this merchant have been analysed yet."}
        </p>
      </div>
    );
  }

  const single = disputeId ? data.analyses[0] : null;

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 mb-6">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <Microscope className="w-4 h-4 text-[#64748B]" />
          <h2 className="font-semibold text-[#0F172A]">Post-outcome analysis</h2>
        </div>
        <Link
          href={
            shopId
              ? `/admin/outcome-analysis?shop_id=${shopId}`
              : "/admin/outcome-analysis"
          }
          className="text-sm text-[#2563EB] hover:underline"
        >
          Open Outcome Analysis →
        </Link>
      </div>

      {single ? (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Metric label="Outcome" value={single.outcome} />
            <Metric
              label="Analysis level"
              value={single.analysisLevel.replace(/_/g, " ").toLowerCase()}
            />
            <Metric label="Observed gap" value={categoryLabel(single.category)} />
            <Metric label="Review" value={reviewStateLabel(single.reviewState)} />
          </div>
          {/* The label alone is a category name. A reviewer needs the sentence
              under it to know what was observed without opening the detail page. */}
          {categoryMeaning(single.category) && (
            <p className="text-xs text-[#64748B]">{categoryMeaning(single.category)}</p>
          )}
          {/* Saved is never shown as sent — the distinction the feature rests on. */}
          {!FORWARDED.has(single.submissionConfirmationSource) && (
            <p className="text-xs text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded px-3 py-2">
              The platform stored this evidence but never reported forwarding it, so
              conclusions about what the issuer saw are withheld.
            </p>
          )}
          <Link
            href={`/admin/outcome-analysis/${single.analysisId}`}
            className="inline-block text-sm text-[#2563EB] hover:underline"
          >
            View full analysis →
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Metric
              label="Decided"
              value={`${data.counts.won}W / ${data.counts.lost}L`}
            />
            <Metric
              label="Full analysis"
              value={`${data.counts.fullAnalysis} of ${data.counts.analysed}`}
            />
            <Metric label="Actionable" value={String(data.counts.actionable)} />
            <Metric label="Awaiting review" value={String(data.counts.pendingReview)} />
            <Metric label="Confirmed" value={String(data.counts.confirmed)} />
          </div>

          {data.counts.blocked > 0 && (
            <p className="text-xs text-[#64748B] mt-3">
              {data.counts.blocked} analysis(es) blocked or carrying a data-integrity
              limitation.
            </p>
          )}

          {Object.keys(data.confirmedByCategory).length > 0 ? (
            <div className="mt-3 text-xs text-[#64748B]">
              Confirmed gaps:{" "}
              {Object.entries(data.confirmedByCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k} (${v})`)
                .join(", ")}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[#64748B]">
              No findings reviewed yet — automated findings remain hypotheses until
              confirmed.
            </p>
          )}
        </>
      )}
    </div>
  );
}
