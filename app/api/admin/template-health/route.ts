import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getTemplateHealthIssues } from "@/lib/db/templates";

export const runtime = "nodejs";

/** GET /api/admin/template-health — template governance issues */
export async function GET() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const issues = await getTemplateHealthIssues();

  const stats = {
    total: issues.length,
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };

  return NextResponse.json({ issues, stats });
}
