/**
 * PUT /api/admin/defence-package/prompt-modules/:key
 *
 * Insert a new version of a prompt module. Previous versions are
 * preserved — never overwritten. The unique (key, version) constraint
 * enforces the version-bump-by-edit semantics.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  displayName: z.string().min(1).max(200),
  reasonCodeKeys: z.array(z.string()).default([]),
  promptBody: z.string().min(1).max(20000),
  guidanceJson: z.record(z.unknown()).default({}),
  model: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  // When the operator saves a manual edit, the row is an intentional
  // override of the file default — set true so the drift guard ignores
  // it. The "Reset to file default" action sends false. Default true
  // preserves the existing behaviour for callers that haven't been
  // updated.
  intentionalOverride: z.boolean().default(true),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = await getAdminSessionUser();
  const { key } = await params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Validation failed", details: err instanceof Error ? err.message : "unknown" },
      { status: 422 },
    );
  }

  const sb = getServiceClient();
  // Get the highest existing version for this key.
  const { data: latest } = await sb
    .from("defence_prompt_modules")
    .select("version")
    .eq("key", key)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await sb
    .from("defence_prompt_modules")
    .insert({
      key,
      display_name: body.displayName,
      reason_code_keys: body.reasonCodeKeys,
      prompt_body: body.promptBody,
      guidance_json: body.guidanceJson,
      model: body.model ?? null,
      is_active: body.isActive,
      version: nextVersion,
      intentional_override: body.intentionalOverride,
      updated_by: admin?.email ?? "admin",
    })
    .select("id, version")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: `Insert failed: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, id: data.id, version: data.version });
}
