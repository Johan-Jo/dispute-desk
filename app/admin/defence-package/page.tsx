import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, FileText, Activity, Settings } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getDashboardStats } from "@/lib/defence/admin-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DefencePackageAdminPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
  const stats = await getDashboardStats();
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Runs (7d)" value={String(stats.totalRuns7d)} />
        <Stat label="OK rate (7d)" value={`${stats.okRate7d}%`} />
        <Stat label="Failed (7d)" value={String(stats.failedCount7d)} />
        <Stat label="Modules" value={String(stats.modulesActive)} />
        <Stat label="Avg prompt tokens" value={String(stats.avgPromptTokens)} />
        <Stat label="Avg completion tokens" value={String(stats.avgCompletionTokens)} />
        <Stat label="Avg duration" value={`${stats.avgDurationMs} ms`} />
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
