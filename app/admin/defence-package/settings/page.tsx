import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings as SettingsIcon, ArrowLeft } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DefencePackageSettingsPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
  const flagOn = process.env.ENABLE_DEFENCE_PACKAGE_BUILDER === "true";
  const defaultModel = process.env.DEFENCE_PACKAGE_DEFAULT_MODEL ?? "claude-sonnet-4-6";
  const dailyGenCap = process.env.DEFENCE_PACKAGE_DAILY_GENERATION_CAP ?? "100";
  const dailyTokenCap = process.env.DEFENCE_PACKAGE_DAILY_TOKEN_CAP ?? "50000";
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/defence-package" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Settings"
          subtitle="Feature-flag mirror, default model, daily cap. Configured via env vars and re-deploy."
          icon={SettingsIcon}
        />
      </div>

      <section className="rounded-lg border border-[#E5E7EB] bg-white p-6 space-y-4">
        <Row
          label="ENABLE_DEFENCE_PACKAGE_BUILDER"
          value={flagOn ? "true" : "false"}
          tone={flagOn ? "emerald" : "amber"}
        />
        <Row label="DEFENCE_PACKAGE_DEFAULT_MODEL" value={defaultModel} />
        <Row label="DEFENCE_PACKAGE_DAILY_GENERATION_CAP" value={dailyGenCap} />
        <Row label="DEFENCE_PACKAGE_DAILY_TOKEN_CAP" value={dailyTokenCap} />
        <p className="text-xs text-[#64748B]">
          To change these, edit the env vars in Vercel (or your local <code>.env.local</code>)
          and re-deploy. There is no DB-backed override — the env var is the source of truth.
        </p>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber";
}) {
  const valueClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-[#0F172A]";
  return (
    <div className="flex justify-between items-center text-sm border-b border-[#F1F5F9] pb-3 last:border-b-0 last:pb-0">
      <code className="text-xs text-[#475569]">{label}</code>
      <span className={`font-mono font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
