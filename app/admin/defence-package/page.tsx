import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, FileText, Activity, Settings, Workflow } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getDashboardStats, detectPromptModuleDrift } from "@/lib/defence/admin-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DefencePackageAdminPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
  const [stats, driftRows] = await Promise.all([
    getDashboardStats(),
    detectPromptModuleDrift(),
  ]);
  const undeclaredDrift = driftRows.filter(
    (r) => r.drifted && !r.intentionalOverride,
  );
  const flagOn = process.env.ENABLE_DEFENCE_PACKAGE_BUILDER === "true";

  return (
    <div className="p-8 space-y-6">
      <AdminPageHeader
        title="Defence Package"
        subtitle="Grounded representment PDF builder — prompt modules, run telemetry, settings."
        icon={ShieldCheck}
        iconGradient="from-[#1D4ED8] to-[#3B82F6]"
      />

      <div className={`rounded-lg border p-4 ${flagOn ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <p className="text-sm text-[#0F172A]">
          <span className="font-semibold">Feature flag</span>:{" "}
          <code className="text-xs">ENABLE_DEFENCE_PACKAGE_BUILDER</code> is{" "}
          <span className={flagOn ? "text-emerald-700" : "text-amber-700"}>
            {flagOn ? "ON" : "OFF"}
          </span>
          . {flagOn
            ? "Auto-build triggers after each successful pack build."
            : "Set the env var to \"true\" to enable auto-build."}
        </p>
      </div>

      {undeclaredDrift.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <span className="font-semibold">✓ All {driftRows.length} prompts in sync</span>
          {" "}with file defaults. DB rows match{" "}
          <code>lib/defence/reasonCodes/</code> byte-for-byte.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="text-sm text-amber-900">
            <span className="font-semibold">
              ⚠ {undeclaredDrift.length} prompt module
              {undeclaredDrift.length === 1 ? "" : "s"} drifted from file
              defaults
            </span>{" "}
            and not marked <code>intentional_override=true</code>. The DB row
            ships to Claude; file changes have not taken effect.
          </div>
          <div className="flex flex-wrap gap-2">
            {undeclaredDrift.map((r) => (
              <Link
                key={r.key}
                href={`/admin/defence-package/prompts/${r.key}`}
                className="inline-block px-2 py-0.5 rounded text-xs bg-white border border-amber-300 text-amber-900 hover:border-amber-500 font-mono"
              >
                {r.key}
              </Link>
            ))}
          </div>
          <p className="text-xs text-amber-800">
            Remediation: open the affected module and click &quot;Reset to file default&quot;,
            or run <code>npx tsx scripts/reconcile-defence-prompt-modules.mts</code>{" "}
            to promote every file default into a new active DB version.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Runs (7d)" value={String(stats.totalRuns7d)} />
        <Stat label="OK rate (7d)" value={`${stats.okRate7d}%`} />
        <Stat label="Failed (7d)" value={String(stats.failedCount7d)} />
        <Stat label="Modules" value={String(stats.modulesActive)} />
        <Stat label="Avg prompt tokens" value={String(stats.avgPromptTokens)} />
        <Stat label="Avg completion tokens" value={String(stats.avgCompletionTokens)} />
        <Stat label="Avg duration" value={`${stats.avgDurationMs} ms`} />
      </div>

      <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <Workflow className="w-4 h-4 text-[#1D4ED8]" />
          <h2 className="text-sm font-semibold text-[#0F172A]">
            Pipeline (what shapes every defence-package LLM call)
          </h2>
        </div>
        <ol className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {[
            ["1", "Trigger", "stage-1"],
            ["2", "Classify", "stage-2"],
            ["3", "Base prompt", "stage-3"],
            ["4", "Reason overlay", "stage-4"],
            ["5", "Payload", "stage-5"],
            ["6", "LLM call", "stage-6"],
            ["7", "Validators", "stage-7"],
            ["8", "Render", "stage-8"],
          ].map(([n, label, anchor]) => (
            <li key={anchor}>
              <Link
                href={`/admin/defence-package/pipeline#${anchor}`}
                className="block rounded border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 hover:border-[#1D4ED8] hover:bg-white"
              >
                <span className="font-mono text-[#1D4ED8] mr-2">{n}</span>
                <span className="text-[#0F172A]">{label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <NavCard href="/admin/defence-package/prompts" icon={FileText} title="Prompt modules" subtitle="Edit reason-code prompts and guidance." />
        <NavCard href="/admin/defence-package/runs" icon={Activity} title="Run telemetry" subtitle="Recent LLM calls with tokens, duration, validation." />
        <NavCard href="/admin/defence-package/settings" icon={Settings} title="Settings" subtitle="Default model, per-shop cap, flag mirror." />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
      <div className="text-xs text-[#64748B] mb-1">{label}</div>
      <div className="text-2xl font-bold text-[#0F172A]">{value}</div>
    </div>
  );
}

function NavCard({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} className="block rounded-lg border border-[#E5E7EB] bg-white p-4 hover:border-[#3B82F6] transition">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="w-5 h-5 text-[#1D4ED8]" />
        <span className="font-semibold text-[#0F172A]">{title}</span>
      </div>
      <p className="text-sm text-[#64748B]">{subtitle}</p>
    </Link>
  );
}
