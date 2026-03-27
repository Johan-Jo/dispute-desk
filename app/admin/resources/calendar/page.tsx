import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { getUpcomingScheduled } from "@/lib/resources/admin-queries";
import { CalendarClient } from "./calendar-client";

export const dynamic = "force-dynamic";

export default async function AdminResourcesCalendarPage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const scheduled = await getUpcomingScheduled(100);

  return <CalendarClient initialItems={scheduled as never[]} />;
}
