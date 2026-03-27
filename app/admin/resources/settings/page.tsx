import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { getCmsSettings } from "@/lib/resources/admin-queries";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function AdminResourcesSettingsPage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  const settings = await getCmsSettings();

  return <SettingsClient initial={settings} />;
}
