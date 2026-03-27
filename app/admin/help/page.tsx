import { hasAdminSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { HelpClient } from "./help-client";

export const dynamic = "force-dynamic";

export default async function AdminHelpPage() {
  if (!(await hasAdminSession())) redirect("/admin/login");
  return <HelpClient />;
}
