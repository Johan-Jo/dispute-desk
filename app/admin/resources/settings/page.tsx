import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminResourcesSettingsPage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const sb = getServiceClient();
  const { data: row } = await sb.from("cms_settings").select("settings_json").eq("id", "singleton").maybeSingle();

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-4">CMS settings</h1>
      <pre className="text-xs bg-[#0B1220] text-white p-4 rounded-lg overflow-auto">
        {JSON.stringify(row?.settings_json ?? {}, null, 2)}
      </pre>
      <p className="text-sm text-[#64748B] mt-4">
        Edit via Supabase or add a form later. Keys: defaultPublishTimeUtc, weekendsEnabled,
        skipIfTranslationIncomplete, minScheduledDaysWarning.
      </p>
    </div>
  );
}
