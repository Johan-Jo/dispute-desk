import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import { getTemplatePreview, updateTemplateStatus } from "@/lib/db/templates";
import { getServiceClient } from "@/lib/supabase/server";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";

export const runtime = "nodejs";

/** GET /api/admin/templates/[id] — template detail */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const preview = await getTemplatePreview(id, DEFAULT_LOCALE);
  if (!preview) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Get status and mapping count
  const sb = getServiceClient();
  const { data: tplRow } = await sb
    .from("pack_templates")
    .select("status")
    .eq("id", id)
    .single();

  const { data: mappings } = await sb
    .from("reason_template_mappings")
    .select("reason_code, dispute_phase")
    .eq("template_id", id);

  return NextResponse.json({
    ...preview,
    status: tplRow?.status ?? "active",
    mappings: mappings ?? [],
  });
}

/** PATCH /api/admin/templates/[id] — update template status */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAdminSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  if (!status || !["active", "draft", "archived"].includes(status)) {
    return NextResponse.json(
      { error: "Invalid status. Must be: active, draft, or archived" },
      { status: 400 }
    );
  }

  const { before, after } = await updateTemplateStatus(id, status);
  if (!after) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Audit log
  const sb = getServiceClient();
  await sb.from("audit_events").insert({
    event_type: "template.status_changed",
    actor_type: "admin",
    event_payload: {
      actor_email: user.email,
      template_id: id,
      before_status: before?.status,
      after_status: after.status,
    },
  });

  return NextResponse.json(after);
}
