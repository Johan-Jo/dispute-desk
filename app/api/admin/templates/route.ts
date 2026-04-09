import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { listTemplatesAdmin } from "@/lib/db/templates";

export const runtime = "nodejs";

/** GET /api/admin/templates — list all templates with admin metadata */
export async function GET(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const search = sp.get("search") ?? "";

  let templates = await listTemplatesAdmin();

  if (status) {
    templates = templates.filter((t) => t.status === status);
  }
  if (search) {
    const q = search.toLowerCase();
    templates = templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q)
    );
  }

  return NextResponse.json(templates);
}
