import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { listPromptModules } from "@/lib/defence/admin-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DefencePackagePromptsPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
  const modules = await listPromptModules();
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/defence-package" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Prompt modules"
          subtitle="Reason-code modules drive the Anthropic system prompt. Saves are versioned — prior versions are preserved."
          icon={FileText}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
            <tr>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Module</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Reason codes</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Source</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Version</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Model</th>
              <th className="text-left px-4 py-2 text-[#64748B] font-medium">Updated</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.key} className="border-b border-[#F1F5F9]">
                <td className="px-4 py-2">
                  <div className="font-medium text-[#0F172A]">{m.displayName}</div>
                  <div className="text-xs text-[#64748B]">{m.key}</div>
                </td>
                <td className="px-4 py-2 text-[#475569]">
                  {m.reasonCodeKeys.length === 0 ? "—" : m.reasonCodeKeys.join(", ")}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs ${m.source === "db" ? "bg-blue-50 text-blue-700" : "bg-slate-50 text-slate-600"}`}
                  >
                    {m.source === "db" ? "DB override" : "File default"}
                  </span>
                </td>
                <td className="px-4 py-2 text-[#475569]">v{m.version}</td>
                <td className="px-4 py-2 text-[#475569]">{m.model ?? "(default)"}</td>
                <td className="px-4 py-2 text-[#475569]">
                  {m.updatedAt ? new Date(m.updatedAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/defence-package/prompts/${m.key}`}
                    className="text-[#1D4ED8] hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
