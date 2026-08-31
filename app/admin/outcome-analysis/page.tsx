import { redirect } from "next/navigation";
import Link from "next/link";
import { Microscope } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  defaultSince,
  listOutcomeAnalyses,
  orderForReview,
  summarise,
  type OutcomeAnalysisFilters,
} from "@/lib/postOutcome/adminQueries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Outcome Analysis — internal admin only (plan §14.1, §15).
 *
 * This is a product-learning surface, NOT a merchant case queue. It sits apart
 * from Operations/Exceptions on purpose: the question here is "what should we
 * change", never "what should someone do about this dispute today".
 *
 * Every automated finding on this page is a HYPOTHESIS until a reviewer
 * confirms it (plan §17), and the page says so rather than presenting counts as
 * settled defects.
 */

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

const LEVEL_LABEL: Record<string, string> = {
  FULL_POST_OUTCOME: "Full",
  PACKAGE_INTEGRITY_ONLY: "Package only",
  OUTCOME_METADATA_ONLY: "Metadata only",
  NOT_ANALYZABLE: "Not analyzable",
};

const CONFIRMATION_LABEL: Record<string, string> = {
  SHOPIFY_EVIDENCE_SENT_ON: "Forwarded",
  PROVIDER_LOG: "Forwarded",
  PLATFORM_SAVE_ONLY: "Saved only",
  MANUAL_MERCHANT_REPORT: "Merchant report",
  NONE: "Not confirmed",
};

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
      <div className="text-[#64748B] text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-[#0F172A] mt-1">{value}</div>
      {/* Every metric states its denominator (plan §15.2). */}
      <div className="text-[#64748B] text-xs mt-1">{detail}</div>
    </div>
  );
}

export default async function OutcomeAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const filters: OutcomeAnalysisFilters = {
    since: params.since || defaultSince(),
    shopId: params.shop_id || null,
    outcome: params.outcome === "won" || params.outcome === "lost" ? params.outcome : null,
    reason: params.reason || null,
    // Chargebacks unless explicitly widened — inquiries and chargebacks are
    // never silently combined (plan §15.2).
    phase: params.phase === "all" ? null : params.phase || "chargeback",
    actionable: params.actionable === "1" ? true : null,
    limit: 100,
  };

  const { rows } = await listOutcomeAnalyses(filters);
  const ordered = orderForReview(rows);
  const summary = summarise(rows);

  return (
    <div className="p-8 space-y-6">
      <AdminPageHeader
        title="Outcome Analysis"
        subtitle="What the packages we filed actually contained, on disputes that have been decided. Internal product learning — not a case queue."
        icon={Microscope}
      />

      <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]">
        Automated findings are <strong>hypotheses until reviewed</strong>. Nothing here
        changes rules, templates or scoring on its own.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Decided & analysed"
          value={String(summary.decidedAnalysed)}
          detail={`${summary.won} won · ${summary.lost} lost`}
        />
        <Stat
          label="Full analysis"
          value={pct(summary.fullPostOutcome, summary.decidedAnalysed)}
          detail={`${summary.fullPostOutcome} of ${summary.decidedAnalysed} analysed`}
        />
        <Stat
          label="Actionable"
          value={String(summary.actionable)}
          detail={`of ${summary.eligibleAnalysed} completed analyses`}
        />
        <Stat
          label="Awaiting review"
          value={String(summary.pendingReview)}
          detail={`of ${summary.decidedAnalysed} analysed`}
        />
      </div>

      {summary.dataIntegrityLimitations > 0 && (
        <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-sm text-[#0F172A]">
          {summary.dataIntegrityLimitations} analysis(es) carry a data-integrity
          limitation — the filed package could not be identified, so package-level
          conclusions are withheld.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
            <tr>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Dispute</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Merchant</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Outcome</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Reason</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Submitted</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Level</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Observed gap</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Confidence</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Review</th>
              <th className="text-right px-4 py-2 text-[#64748B] font-medium">Ver</th>
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[#64748B]">
                  No decided disputes have been analysed in this window.
                </td>
              </tr>
            ) : (
              ordered.map((r) => (
                <tr key={r.id} className="border-b border-[#F1F5F9] last:border-0">
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/outcome-analysis/${r.id}`}
                      className="text-[#2563EB] hover:underline"
                    >
                      {r.orderName ?? r.disputeId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[#0F172A]">{r.shopDomain ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        r.outcome === "won" ? "text-[#047857]" : "text-[#B91C1C]"
                      }
                    >
                      {r.outcome}
                    </span>
                    <span className="text-[#94A3B8] ml-2">
                      {r.finalizedAt?.slice(0, 10) ?? ""}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#0F172A]">
                    {r.reason ?? "—"}
                    {r.networkReasonCode ? (
                      <span className="text-[#94A3B8] ml-1">{r.networkReasonCode}</span>
                    ) : null}
                  </td>
                  {/* "Saved only" is never rendered as submitted — the distinction
                      this whole feature rests on (plan §6.2). */}
                  <td className="px-4 py-2 text-[#0F172A]">
                    {CONFIRMATION_LABEL[r.submissionConfirmationSource] ??
                      r.submissionConfirmationSource}
                  </td>
                  <td className="px-4 py-2 text-[#64748B]">
                    {LEVEL_LABEL[r.analysisLevel] ?? r.analysisLevel}
                    {r.dataIntegrityLimitation ? " ⚠" : ""}
                  </td>
                  <td className="px-4 py-2 text-[#0F172A]">
                    {r.effectiveCategory ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-[#64748B]">{r.primaryConfidence ?? "—"}</td>
                  <td className="px-4 py-2 text-[#64748B]">
                    {r.reviewState === "PENDING_REVIEW" ? "Pending" : r.reviewState}
                    {r.reviewCount > 1 ? ` (${r.reviewCount})` : ""}
                  </td>
                  <td className="px-4 py-2 text-right text-[#94A3B8]">
                    v{r.analyzerVersion}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[#94A3B8]">
        Merchant benchmarking is not shown: it requires at least three peer merchants in
        a matched cohort, and the current population cannot form one. Cohort refusals are
        recorded rather than replaced with a broader average.
      </p>
    </div>
  );
}
