import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminResourcesCalendarPage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const sb = getServiceClient();
  const { data: rows } = await sb
    .from("content_publish_queue")
    .select("id, scheduled_for, status, last_error, attempts")
    .order("scheduled_for", { ascending: true })
    .limit(100);

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">Publish queue</h1>
      <p className="text-sm text-[#64748B] mb-4">
        Upcoming jobs from <code>content_publish_queue</code>. Cron:{" "}
        <code>POST /api/cron/publish-content</code>
      </p>
      <table className="w-full text-sm border border-[#E5E7EB] rounded-lg overflow-hidden">
        <thead className="bg-[#F8FAFC]">
          <tr>
            <th className="text-left p-3">Scheduled</th>
            <th className="text-left p-3">Status</th>
            <th className="text-left p-3">Error</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r: Record<string, unknown>) => (
            <tr key={String(r.id)} className="border-t border-[#E5E7EB]">
              <td className="p-3">{String(r.scheduled_for)}</td>
              <td className="p-3">{String(r.status)}</td>
              <td className="p-3 text-red-600">{r.last_error ? String(r.last_error) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
