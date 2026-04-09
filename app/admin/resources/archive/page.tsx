import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminResourcesArchivePage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const sb = getServiceClient();
  const { data: rows } = await sb
    .from("content_archive_items")
    .select("*")
    .order("priority_score", { ascending: false })
    .limit(200);

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">Content archive / backlog</h1>
      <table className="w-full text-sm border border-[#E2E8F0] rounded-lg overflow-hidden">
        <thead className="bg-[#F8FAFC]">
          <tr>
            <th className="text-left p-3">Title</th>
            <th className="text-left p-3">Pillar</th>
            <th className="text-left p-3">Priority</th>
            <th className="text-left p-3">Keyword</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id} className="border-t border-[#E2E8F0]">
              <td className="p-3">{r.proposed_title}</td>
              <td className="p-3">{r.primary_pillar}</td>
              <td className="p-3">{r.priority_score}</td>
              <td className="p-3 text-[#64748B]">{r.target_keyword ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
