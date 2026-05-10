import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Settings } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { getSignalRadarSettings } from "@/lib/signal-radar/settings";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SettingsForm } from "./settings-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SignalRadarSettingsPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
  const settings = await getSignalRadarSettings();
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/signal-radar"
          className="text-[#64748B] hover:text-[#0F172A]"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Signal Radar settings"
          subtitle="Toggle ingest sources and cron schedules. Changes take effect on the next cron tick."
          icon={Settings}
          iconGradient="from-[#475569] to-[#64748B]"
        />
      </div>
      <SettingsForm initial={settings} />
    </div>
  );
}
