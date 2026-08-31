import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Microscope } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getServiceClient } from "@/lib/supabase/server";
import { getReviewState } from "@/lib/postOutcome/reviews";
import { ReviewControls } from "./ReviewControls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One analysis in full (plan §15.5).
 *
 * Ordering follows the plan: lifecycle first, then the findings, then the
 * audit trail. Lifecycle leads because whether the package was FORWARDED
 * decides how much the rest of the page is allowed to mean — a reader who sees
 * the findings first will weigh them before learning the issuer may never have
 * seen the package.
 */

interface AnalysisRow {
  id: string;
  dispute_id: string;
  shop_id: string;
  final_outcome_snapshot: "won" | "lost";
  finalized_at_snapshot: string | null;
  submitted_at_snapshot: string | null;
  submission_state_snapshot: string | null;
  platform_save_confirmation: boolean;
  submission_confirmation_source: string;
  package_evidence_tie: string;
  payment_provider_snapshot: string;
  provider_access_level_snapshot: string;
  reason_snapshot: string | null;
  network_reason_code_snapshot: string | null;
  analysis_level: string;
  analysis_status: string;
  reason_specific_status: string;
  data_integrity_limitation: boolean;
  primary_category: string | null;
  primary_confidence: string | null;
  actionable: boolean;
  analyzer_version: number;
  source_snapshot_sha256: string;
  submitted_package_id: string | null;
  completed_at: string | null;
  summary: Record<string, unknown> | null;
}

interface FindingRow {
  id: string;
  is_primary: boolean;
  category: string;
  confidence: string;
  severity: string;
  title: string;
  description: string;
  observed_fact: string;
  counterfactual_improvement: string | null;
  action_class: string;
  evidence_refs: unknown;
  rule_refs: unknown;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 py-1.5 border-b border-[#F1F5F9] last:border-0">
      <span className="text-[#64748B]">{label}</span>
      <span className="text-[#0F172A] text-right">{value}</span>
    </div>
  );
}

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const { id } = await params;
  const sb = getServiceClient();

  const { data: analysis } = await sb
    .from("post_outcome_analyses")
    .select("*")
    .eq("id", id)
    .maybeSingle<AnalysisRow>();

  if (!analysis) notFound();

  const { data: findings } = await sb
    .from("post_outcome_findings")
    .select(
      "id, is_primary, category, confidence, severity, title, description, observed_fact, counterfactual_improvement, action_class, evidence_refs, rule_refs",
    )
    .eq("analysis_id", id)
    .order("is_primary", { ascending: false })
    .returns<FindingRow[]>();

  const review = await getReviewState(
    id,
    analysis.primary_category as never,
    analysis.primary_confidence as never,
  );

  const forwarded =
    analysis.submission_confirmation_source === "SHOPIFY_EVIDENCE_SENT_ON" ||
    analysis.submission_confirmation_source === "PROVIDER_LOG";

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/outcome-analysis" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Analysis detail"
          subtitle={`${analysis.reason_snapshot ?? "Unknown reason"} · ${analysis.final_outcome_snapshot}`}
          icon={Microscope}
        />
      </div>

      {/* Lifecycle first: it bounds what everything below is allowed to mean. */}
      <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <h2 className="font-semibold text-[#0F172A] mb-3">Outcome and lifecycle</h2>
        <div className="text-sm">
          <Row label="Final outcome" value={`${analysis.final_outcome_snapshot} · ${analysis.finalized_at_snapshot?.slice(0, 10) ?? "—"}`} />
          <Row label="Payment provider" value={`${analysis.payment_provider_snapshot} · ${analysis.provider_access_level_snapshot}`} />
          <Row
            label="Platform save confirmed"
            value={analysis.platform_save_confirmation ? "yes — storage only" : "no"}
          />
          <Row
            label="Forwarded to issuer"
            value={
              forwarded
                ? `yes · ${analysis.submitted_at_snapshot?.slice(0, 19).replace("T", " ") ?? "time unknown"}`
                : `no — ${analysis.submission_confirmation_source}`
            }
          />
          <Row label="Package identified" value={analysis.package_evidence_tie} />
          <Row label="Analysis level" value={analysis.analysis_level} />
          <Row label="Reason module" value={analysis.reason_specific_status} />
        </div>
        {!forwarded && (
          <p className="mt-3 text-sm text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded px-3 py-2">
            The platform confirmed it stored this evidence but never reported forwarding
            it. Conclusions about what the issuer saw are withheld.
          </p>
        )}
        {analysis.data_integrity_limitation && (
          <p className="mt-3 text-sm text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded px-3 py-2">
            The filed package could not be identified, so package-level conclusions are
            withheld.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <h2 className="font-semibold text-[#0F172A] mb-1">
          Findings ({findings?.length ?? 0})
        </h2>
        <p className="text-xs text-[#64748B] mb-3">
          Observed gaps and potential improvements. None of these states why the issuer
          decided as it did — that reasoning is not disclosed to us.
        </p>
        {(findings ?? []).length === 0 ? (
          <p className="text-sm text-[#64748B]">
            No material gap identified from the retained records.
          </p>
        ) : (
          <div className="space-y-3">
            {(findings ?? []).map((f) => (
              <div key={f.id} className="border border-[#E5E7EB] rounded p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="font-medium text-[#0F172A]">
                    {f.is_primary ? "★ " : ""}
                    {f.title}
                  </div>
                  <div className="text-xs text-[#64748B] whitespace-nowrap">
                    {f.confidence} · {f.severity} · {f.action_class}
                  </div>
                </div>
                <p className="text-sm text-[#334155] mt-2">{f.description}</p>
                <p className="text-xs text-[#64748B] mt-2">
                  <strong>Observed:</strong> {f.observed_fact}
                </p>
                {f.counterfactual_improvement && (
                  <p className="text-xs text-[#64748B] mt-1">
                    <strong>Potential improvement:</strong> {f.counterfactual_improvement}
                  </p>
                )}
                <div className="text-xs text-[#94A3B8] mt-2">
                  {Array.isArray(f.evidence_refs) ? f.evidence_refs.length : 0} evidence ref(s) ·{" "}
                  {Array.isArray(f.rule_refs) ? f.rule_refs.length : 0} rule ref(s)
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ReviewControls
        analysisId={id}
        currentState={review.state}
        reviewCount={review.reviewCount}
      />

      <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <h2 className="font-semibold text-[#0F172A] mb-3">Audit</h2>
        <div className="text-sm">
          <Row label="Analyzer version" value={`v${analysis.analyzer_version}`} />
          <Row label="Snapshot hash" value={analysis.source_snapshot_sha256.slice(0, 24) + "…"} />
          <Row label="Completed" value={analysis.completed_at?.slice(0, 19).replace("T", " ") ?? "—"} />
          <Row label="Reviews recorded" value={String(review.reviewCount)} />
        </div>
      </section>
    </div>
  );
}
