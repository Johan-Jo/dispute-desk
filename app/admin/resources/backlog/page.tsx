import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { getBacklogItems } from "@/lib/resources/admin-queries";
import { BacklogClient } from "./backlog-client";

export const dynamic = "force-dynamic";

export default async function AdminBacklogPage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const items = await getBacklogItems();

  return <BacklogClient initialItems={items as never[]} />;
}
