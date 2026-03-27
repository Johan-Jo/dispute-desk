import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { getContentList, getContentStats } from "@/lib/resources/admin-queries";
import { ContentListClient } from "./list-client";

export const dynamic = "force-dynamic";

export default async function AdminContentListPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const [stats, initialData] = await Promise.all([
    getContentStats(),
    getContentList({ page: 1, pageSize: 20 }),
  ]);

  return (
    <ContentListClient
      initialItems={initialData.items as never[]}
      initialTotal={initialData.total}
      stats={stats}
    />
  );
}
