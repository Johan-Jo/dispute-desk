/**
 * Admin — Gorgias evidence core.
 *
 * The admin reflection of the Gorgias enrichment + relevance-analysis
 * pipeline (admin-is-source-of-truth for LLM features): per-shop
 * integration status, recent enrichment runs (state machine, tier
 * counts, analyzer telemetry), and merchant bad-match reports.
 *
 * Deliberately metadata-only: raw ticket/message content is NEVER shown
 * here (PRD §21 — access to message content is permission-controlled;
 * admin sees counts, statuses and telemetry).
 */

import { redirect } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const runtime = "nodejs";
export const revalidate = 60;

interface IntegrationRow {
  id: string;
  status: string;
  meta: Record<string, unknown> | null;
  updated_at: string;
  shops: { shop_domain: string | null } | null;
}

interface RunRow {
  id: string;
  run_number: number;
  status: string;
  trigger_source: string;
  attempt_count: number;
  tickets_scanned: number;
  tickets_high: number;
  tickets_medium: number;
  tickets_low: number;
  messages_stored: number;
  proposal_count: number;
  approved_count: number;
  analyzer_model: string | null;
  analyzer_version: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  duration_ms: number;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
  shops: { shop_domain: string | null } | null;
  disputes: { order_name: string | null } | null;
}

interface ReportRow {
  id: string;
  scope: string;
  merchant_reason: string | null;
  match_score_at_report: number;
  matching_algorithm_version: number;
  created_at: string;
  shops: { shop_domain: string | null } | null;
}

const STATUS_COLORS: Record<string, string> = {
  ready_for_review: "text-emerald-600",
  completed: "text-emerald-600",
  no_matches: "text-slate-500",
  analysis_deferred: "text-amber-600",
  failed_retryable: "text-amber-600",
  failed_terminal: "text-red-600",
  cancelled: "text-slate-400",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
}

export default async function AdminGorgiasPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const sb = getServiceClient();
  const [integrationsRes, runsRes, reportsRes] = await Promise.all([
    sb
      .from("integrations")
      .select("id, status, meta, updated_at, shops(shop_domain)")
      .eq("type", "gorgias")
      .order("updated_at", { ascending: false })
      .limit(100),
    sb
      .from("gorgias_enrichment_runs")
      .select(
        "id, run_number, status, trigger_source, attempt_count, tickets_scanned, tickets_high, tickets_medium, tickets_low, messages_stored, proposal_count, approved_count, analyzer_model, analyzer_version, prompt_tokens, completion_tokens, duration_ms, error_code, started_at, completed_at, shops(shop_domain), disputes(order_name)",
      )
      .order("started_at", { ascending: false })
      .limit(50),
    sb
      .from("gorgias_match_reports")
      .select(
        "id, scope, merchant_reason, match_score_at_report, matching_algorithm_version, created_at, shops(shop_domain)",
      )
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const integrations = (integrationsRes.data ?? []) as unknown as IntegrationRow[];
  const runs = (runsRes.data ?? []) as unknown as RunRow[];
  const reports = (reportsRes.data ?? []) as unknown as ReportRow[];

  return (
    <div className="p-8 space-y-8">
      <AdminPageHeader
        title="Gorgias evidence"
        subtitle="Helpdesk-conversation enrichment — connections, runs, analyzer telemetry, bad-match feedback"
        icon={MessagesSquare}
        iconGradient="from-[#10B981] to-[#0D9488]"
      />

      {/* Connections */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-800">
          Connections ({integrations.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-5 py-2 font-medium">Shop</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Evidence mode</th>
                <th className="px-5 py-2 font-medium">Subdomain</th>
                <th className="px-5 py-2 font-medium">Error</th>
                <th className="px-5 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {integrations.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-slate-400">
                    No Gorgias connections yet.
                  </td>
                </tr>
              )}
              {integrations.map((row) => (
                <tr key={row.id} className="border-b border-slate-50">
                  <td className="px-5 py-2">{row.shops?.shop_domain ?? "—"}</td>
                  <td className="px-5 py-2">
                    <span
                      className={
                        row.status === "connected"
                          ? "text-emerald-600"
                          : row.status === "needs_attention"
                            ? "text-red-600"
                            : "text-slate-500"
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-5 py-2">
                    {(row.meta?.evidence_mode as string) ?? "legacy_auto_include"}
                  </td>
                  <td className="px-5 py-2">{(row.meta?.subdomain as string) ?? "—"}</td>
                  <td className="px-5 py-2 text-red-600">
                    {(row.meta?.error_code as string) ?? ""}
                  </td>
                  <td className="px-5 py-2 text-slate-500">{fmtDate(row.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Enrichment runs */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-800">
          Enrichment runs (latest {runs.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-5 py-2 font-medium">Started</th>
                <th className="px-5 py-2 font-medium">Shop</th>
                <th className="px-5 py-2 font-medium">Order</th>
                <th className="px-5 py-2 font-medium">#</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Trigger</th>
                <th className="px-5 py-2 font-medium">H/M/L</th>
                <th className="px-5 py-2 font-medium">Msgs</th>
                <th className="px-5 py-2 font-medium">Proposed</th>
                <th className="px-5 py-2 font-medium">Model</th>
                <th className="px-5 py-2 font-medium">Tokens in/out</th>
                <th className="px-5 py-2 font-medium">ms</th>
                <th className="px-5 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-5 py-6 text-slate-400">
                    No enrichment runs yet.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-5 py-2 text-slate-500 whitespace-nowrap">
                    {fmtDate(r.started_at)}
                  </td>
                  <td className="px-5 py-2">{r.shops?.shop_domain ?? "—"}</td>
                  <td className="px-5 py-2">{r.disputes?.order_name ?? "—"}</td>
                  <td className="px-5 py-2">{r.run_number}</td>
                  <td className={`px-5 py-2 ${STATUS_COLORS[r.status] ?? "text-slate-700"}`}>
                    {r.status}
                    {r.attempt_count > 1 ? ` (×${r.attempt_count})` : ""}
                  </td>
                  <td className="px-5 py-2">{r.trigger_source}</td>
                  <td className="px-5 py-2 whitespace-nowrap">
                    {r.tickets_high}/{r.tickets_medium}/{r.tickets_low}
                  </td>
                  <td className="px-5 py-2">{r.messages_stored}</td>
                  <td className="px-5 py-2">{r.proposal_count}</td>
                  <td className="px-5 py-2 whitespace-nowrap">
                    {r.analyzer_model
                      ? `${r.analyzer_model}@v${r.analyzer_version ?? "?"}`
                      : "—"}
                  </td>
                  <td className="px-5 py-2 whitespace-nowrap">
                    {r.prompt_tokens || r.completion_tokens
                      ? `${r.prompt_tokens}/${r.completion_tokens}`
                      : "—"}
                  </td>
                  <td className="px-5 py-2">{r.duration_ms || "—"}</td>
                  <td className="px-5 py-2 text-red-600">{r.error_code ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bad-match reports */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-800">
          Bad-match reports (latest {reports.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-5 py-2 font-medium">Reported</th>
                <th className="px-5 py-2 font-medium">Shop</th>
                <th className="px-5 py-2 font-medium">Scope</th>
                <th className="px-5 py-2 font-medium">Score at report</th>
                <th className="px-5 py-2 font-medium">Algo ver</th>
                <th className="px-5 py-2 font-medium">Merchant reason</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-slate-400">
                    No bad-match reports.
                  </td>
                </tr>
              )}
              {reports.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-5 py-2 text-slate-500 whitespace-nowrap">
                    {fmtDate(r.created_at)}
                  </td>
                  <td className="px-5 py-2">{r.shops?.shop_domain ?? "—"}</td>
                  <td className="px-5 py-2">{r.scope}</td>
                  <td className="px-5 py-2">{r.match_score_at_report}</td>
                  <td className="px-5 py-2">v{r.matching_algorithm_version}</td>
                  <td className="px-5 py-2">{r.merchant_reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
