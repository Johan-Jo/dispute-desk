import Link from "next/link";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminResourcesPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const sb = getServiceClient();
  const { data: items, error } = await sb
    .from("content_items")
    .select("id, content_type, primary_pillar, workflow_status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Resources Hub</h1>
        <div className="flex gap-3">
          <Link
            href="/admin/resources/archive"
            className="text-sm px-3 py-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F8FAFC]"
          >
            Archive
          </Link>
          <Link
            href="/admin/resources/calendar"
            className="text-sm px-3 py-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F8FAFC]"
          >
            Calendar
          </Link>
          <Link
            href="/admin/resources/settings"
            className="text-sm px-3 py-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F8FAFC]"
          >
            Settings
          </Link>
        </div>
      </div>
      {error && <p className="text-red-600">{error.message}</p>}
      {!items?.length && !error && (
        <p className="text-[#64748B]">
          No content yet. Load demo content with{" "}
          <code className="bg-[#F1F5F9] px-1 rounded">npm run seed:resources</code> (or{" "}
          <code className="bg-[#F1F5F9] px-1 rounded">seed:resources:force</code> to replace).
        </p>
      )}
      <table className="w-full text-sm border border-[#E5E7EB] rounded-lg overflow-hidden">
        <thead className="bg-[#F8FAFC]">
          <tr>
            <th className="text-left p-3">Type</th>
            <th className="text-left p-3">Pillar</th>
            <th className="text-left p-3">Status</th>
            <th className="text-left p-3">Updated</th>
            <th className="text-left p-3"></th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((row) => (
            <tr key={row.id} className="border-t border-[#E5E7EB]">
              <td className="p-3">{row.content_type}</td>
              <td className="p-3">{row.primary_pillar}</td>
              <td className="p-3">{row.workflow_status}</td>
              <td className="p-3 text-[#64748B]">
                {row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}
              </td>
              <td className="p-3">
                <Link href={`/admin/resources/content/${row.id}`} className="text-[#1D4ED8] hover:underline">
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
