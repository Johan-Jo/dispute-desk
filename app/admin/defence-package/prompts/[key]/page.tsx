import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getPromptModule } from "@/lib/defence/admin-queries";
import { PromptEditor } from "./editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PromptModuleEditorPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
  const { key } = await params;
  const promptModule = await getPromptModule(key);
  if (!promptModule) notFound();
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/defence-package/prompts" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title={promptModule.displayName}
          subtitle={`Module key: ${promptModule.key} • current version v${promptModule.version} (${promptModule.source === "db" ? "DB override" : "file default"})`}
          icon={FileText}
        />
      </div>
      <PromptEditor initial={promptModule} />
    </div>
  );
}
