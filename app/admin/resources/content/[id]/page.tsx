import Link from "next/link";
import { hasAdminSession } from "@/lib/admin/auth";
import { redirect, notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AdminResourceContentDetailPage({ params }: Props) {
  if (!(await hasAdminSession())) redirect("/admin/login");
  const { id } = await params;
  const sb = getServiceClient();
  const { data: item } = await sb.from("content_items").select("*").eq("id", id).maybeSingle();
  if (!item) notFound();

  const { data: locs } = await sb.from("content_localizations").select("*").eq("content_item_id", id);

  return (
    <div className="p-8 max-w-4xl">
      <Link href="/admin/resources" className="text-sm text-[#1D4ED8] mb-4 inline-block">
        ← Back
      </Link>
      <h1 className="text-2xl font-bold mb-2">Content item</h1>
      <p className="text-sm text-[#64748B] mb-6">ID: {id}</p>
      <pre className="text-xs bg-[#F8FAFC] p-4 rounded-lg border border-[#E5E7EB] overflow-auto mb-8">
        {JSON.stringify(item, null, 2)}
      </pre>
      <h2 className="text-lg font-semibold mb-2">Localizations</h2>
      <pre className="text-xs bg-[#F8FAFC] p-4 rounded-lg border border-[#E5E7EB] overflow-auto">
        {JSON.stringify(locs ?? [], null, 2)}
      </pre>
      <p className="text-sm text-[#64748B] mt-6">
        Full editor UI can replace this JSON view. Use Supabase to bulk-edit until then.
      </p>
    </div>
  );
}
