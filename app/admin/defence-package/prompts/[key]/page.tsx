import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getPromptModule } from "@/lib/defence/admin-queries";
import { ALL_REASON_CODE_MODULES, familyKeyForModule } from "@/lib/defence/reasonCodes/registry";
import { getFamily } from "@/lib/defence/reasonCodes/familyRegistry";
import { PromptEditor, type FileDefaultSnapshot } from "./editor";

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

  // File-default snapshot powers the "Reset to file default" button.
  // null when the key is not a known file module (defensive — every key
  // in ALL_REASON_CODE_MODULES has a corresponding admin row via
  // listPromptModules).
  const fileMod = ALL_REASON_CODE_MODULES.find((m) => m.key === promptModule.key);
  const fileDefault: FileDefaultSnapshot | null = fileMod
    ? {
        promptBody: fileMod.promptBody,
        guidanceJson: {
          prioritize: fileMod.prioritize,
          avoid: fileMod.avoid,
          mustNotClaim: fileMod.mustNotClaim,
          criticalCategories: fileMod.criticalCategories,
          allowedFactCategories: fileMod.allowedFactCategories,
        },
        reasonCodeKeys: fileMod.reasonCodeKeys,
      }
    : null;

  // Serialise the family's hard-prohibited bank-framing phrases so the
  // client-side editor can run the same check the PUT route enforces
  // (and disable Save when the current promptBody contains one). v2.2+.
  const family = fileMod ? getFamily(familyKeyForModule(fileMod.key)) : null;
  const prohibitedBankPhrasePatterns: string[] = family
    ? family.prohibitedBankPhrases.map((re) => re.source)
    : [];

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
      <PromptEditor
        initial={promptModule}
        fileDefault={fileDefault}
        prohibitedBankPhrasePatterns={prohibitedBankPhrasePatterns}
      />
    </div>
  );
}
