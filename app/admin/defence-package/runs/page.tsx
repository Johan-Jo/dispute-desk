import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, ArrowLeft } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { listRecentRuns } from "@/lib/defence/admin-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DefencePackageRunsPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
  const runs = await listRecentRuns(100);
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/defence-package" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Run telemetry"
          subtitle="Recent Anthropic Messages API calls for the Defence Package builder."
          icon={Activity}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
            <tr>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">When</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Model</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Mode</th>
              <th className="text-right px-4 py-2 text-[#64748B] font-medium">Prompt</th>
              <th className="text-right px-4 py-2 text-[#64748B] font-medium">Completion</th>
              <th className="text-right px-4 py-2 text-[#64748B] font-medium">Duration</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Result</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[#64748B]">
                  No runs yet.
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id} className="border-b border-[#F1F5F9]">
                  <td className="px-4 py-2 text-[#475569]">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.model ?? "—"}</td>
                  <td className="px-4 py-2">{r.packageMode ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{r.promptTokens ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{r.completionTokens ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    {r.durationMs != null ? `${r.durationMs} ms` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <ResultBadge status={r.validationStatus} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/admin/defence-package/runs/${r.id}`}
                      className="text-[#1D4ED8] hover:underline"
                    >
                      Detail
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultBadge({ status }: { status: string | null }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    ok: { bg: "bg-emerald-50", fg: "text-emerald-700", label: "OK" },
    failed: { bg: "bg-rose-50", fg: "text-rose-700", label: "Failed" },
    error: { bg: "bg-amber-50", fg: "text-amber-700", label: "Error" },
    skipped: { bg: "bg-slate-50", fg: "text-slate-600", label: "Skipped" },
  };
  const cfg = (status ? map[status] : null) ?? { bg: "bg-slate-50", fg: "text-slate-600", label: status ?? "—" };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}
