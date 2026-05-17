/**
 * GET /api/admin/defence-package/prompt-modules
 *
 * List all reason-code prompt modules (file defaults union DB overrides).
 * Admin-only.
 */

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { ALL_REASON_CODE_MODULES } from "@/lib/defence/reasonCodes/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  const { data: dbRows } = await sb
    .from("defence_prompt_modules")
    .select("id, key, display_name, reason_code_keys, prompt_body, guidance_json, model, is_active, version, updated_by, updated_at")
    .eq("is_active", true)
    .order("version", { ascending: false });

  // Group by key, keep only the latest active version per key.
  type DbModuleRow = {
    id: string;
    key: string;
    display_name: string;
    reason_code_keys: string[];
    prompt_body: string;
    guidance_json: Record<string, unknown>;
    model: string | null;
    is_active: boolean;
    version: number;
    updated_by: string | null;
    updated_at: string;
  };
  const latestByKey = new Map<string, DbModuleRow>();
  for (const row of (dbRows ?? []) as DbModuleRow[]) {
    if (!latestByKey.has(row.key)) latestByKey.set(row.key, row);
  }

  // Merge file defaults with DB rows so unmodified modules still appear.
  const merged = ALL_REASON_CODE_MODULES.map((mod) => {
    const dbRow = latestByKey.get(mod.key);
    return {
      key: mod.key,
      displayName: dbRow?.display_name ?? mod.displayName,
      claimType: mod.claimType,
      reasonCodeKeys: mod.reasonCodeKeys,
      promptBody: dbRow?.prompt_body ?? mod.promptBody,
      guidanceJson: dbRow?.guidance_json ?? {
        prioritize: mod.prioritize,
        avoid: mod.avoid,
        mustNotClaim: mod.mustNotClaim,
        criticalCategories: mod.criticalCategories,
        allowedFactCategories: mod.allowedFactCategories,
      },
      model: dbRow?.model ?? null,
      isActive: dbRow?.is_active ?? true,
      version: dbRow?.version ?? mod.version,
      source: dbRow ? "db" : "file_default",
      updatedAt: dbRow?.updated_at ?? null,
      updatedBy: dbRow?.updated_by ?? null,
    };
  });

  return NextResponse.json({ modules: merged });
}
