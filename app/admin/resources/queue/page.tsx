import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { getQueueItems } from "@/lib/resources/admin-queries";
import { QueueClient } from "./queue-client";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const items = await getQueueItems();

  return <QueueClient initialItems={items as never[]} />;
}
