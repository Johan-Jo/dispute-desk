import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import {
  getContentStats,
  getUpcomingScheduled,
  getTranslationGaps,
  getRecentlyEdited,
  getQueueItems,
} from "@/lib/resources/admin-queries";
import { ResourcesDashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function AdminResourcesDashboard() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const [stats, upcoming, gaps, recent, queue] = await Promise.allSettled([
    getContentStats(),
    getUpcomingScheduled(4),
    getTranslationGaps(5),
    getRecentlyEdited(6),
    getQueueItems("pending"),
  ]);

  return (
    <ResourcesDashboardClient
      stats={stats.status === "fulfilled" ? stats.value : null}
      upcoming={upcoming.status === "fulfilled" ? (upcoming.value as never[]) : []}
      gaps={gaps.status === "fulfilled" ? gaps.value : []}
      recent={recent.status === "fulfilled" ? (recent.value as never[]) : []}
      queueSize={queue.status === "fulfilled" ? queue.value.length : 0}
    />
  );
}
