import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { updateReasonMapping } from "@/lib/db/reasonMappings";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** PATCH /api/admin/reason-mapping/[id] — update a mapping */
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

  // Validate: if template_id is provided, check it's active
  if (body.template_id) {
    const sb = getServiceClient();
    const { data: tpl } = await sb
      .from("pack_templates")
      .select("status")
      .eq("id", body.template_id)
      .single();

    if (!tpl) {
      return NextResponse.json({ error: "Template not found" }, { status: 400 });
    }
    if (tpl.status !== "active") {
      return NextResponse.json(
        { error: `Cannot assign a ${tpl.status} template as default. Only active templates are allowed.` },
        { status: 400 }
      );
    }
  }

  const { before, after } = await updateReasonMapping(id, {
    template_id: body.template_id,
    is_active: body.is_active,
    notes: body.notes,
    updated_by: user.id,
  });

  if (!after) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Audit log
  const sb = getServiceClient();
  await sb.from("audit_events").insert({
    event_type: "reason_mapping.updated",
    actor_type: "admin",
    event_payload: {
      actor_email: user.email,
      mapping_id: id,
      reason_code: before?.reason_code,
      dispute_phase: before?.dispute_phase,
      before_template_id: before?.template_id,
      after_template_id: after.template_id,
      before_is_active: before?.is_active,
      after_is_active: after.is_active,
      before_notes: before?.notes,
      after_notes: after.notes,
    },
  });

  return NextResponse.json(after);
}
