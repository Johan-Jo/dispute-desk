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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#0F172A]">Resolution precedence</h2>
        <p className="text-sm text-[#475569]">
          How each surface that shapes a defence-package LLM call resolves
          its value. Higher rows in the table win.
        </p>
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Layer</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Model</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Block 1 (base)</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Block 2 (overlay)</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Guidance JSON</th>
                <th className="text-left px-4 py-2 text-[#64748B] font-medium">Daily cap</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              <tr className="border-b border-[#F1F5F9]">
                <td className="px-4 py-2 text-[#0F172A]">Request override</td>
                <td className="px-4 py-2 text-[#475569]">ctx.modelOverride</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
              </tr>
              <tr className="border-b border-[#F1F5F9]">
                <td className="px-4 py-2 text-[#0F172A]">Env var</td>
                <td className="px-4 py-2 text-[#475569]">DEFENCE_PACKAGE_DEFAULT_MODEL</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#475569]">..._DAILY_GENERATION_CAP / ..._TOKEN_CAP</td>
              </tr>
              <tr className="border-b border-[#F1F5F9]">
                <td className="px-4 py-2 text-[#0F172A]">DB row</td>
                <td className="px-4 py-2 text-[#475569]">defence_prompt_modules.model</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#475569]">defence_prompt_modules.prompt_body</td>
                <td className="px-4 py-2 text-[#475569]">defence_prompt_modules.guidance_json</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
              </tr>
              <tr className="border-b border-[#F1F5F9]">
                <td className="px-4 py-2 text-[#0F172A]">File default</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#475569]">lib/defence/reasonCodes/&lt;key&gt;.ts</td>
                <td className="px-4 py-2 text-[#475569]">lib/defence/reasonCodes/&lt;key&gt;.ts</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-[#0F172A]">Hardcoded</td>
                <td className="px-4 py-2 text-[#475569]">&quot;claude-sonnet-4-6&quot; (narrativeWriter.ts:38)</td>
                <td className="px-4 py-2 text-[#475569]">BASE_SYSTEM_PROMPT (narrativeWriter.ts:51)</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#94A3B8]">—</td>
                <td className="px-4 py-2 text-[#475569]">100 / 50000</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[#64748B]">
          Block 1 has no override path — to change it you must edit the file
          and redeploy. Block 2 and guidance JSON resolve via{" "}
          <code>resolveReasonCodeModule</code> in{" "}
          <code>lib/defence/reasonCodes/registry.ts</code>: the DB row wins
          when present, falling through to the file default otherwise.
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
