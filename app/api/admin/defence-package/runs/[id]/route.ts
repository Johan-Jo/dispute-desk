/**
 * GET /api/admin/defence-package/runs/:id
 *
 * Detailed view of a single LLM run:
 *   - the run row (model, tokens, validation status)
 *   - the package row (status, narrative_json, facts_json, validation_errors, pdf_path)
 *   - signed PDF URL (if available)
 *
 * SANITIZATION: raw Shopify JSON never enters this response. The
 * narrative_json + facts_json on the package row are already normalised
 * EvidenceFact records by the time the job persists them — there is no
 * raw `pack_json` or order JSON forwarded here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_TTL_SECONDS = 600;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sb = getServiceClient();

  const { data: run, error: runErr } = await sb
    .from("defence_package_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (runErr || !run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let pkg: Record<string, unknown> | null = null;
  let signedUrl: string | null = null;
  if (run.package_id) {
    const { data } = await sb
      .from("defence_packages")
      .select(
        "id, dispute_id, shop_id, source_pack_id, version, status, package_mode, evidence_hash, llm_model, prompt_family, prompt_version, reason_code_module, validation_status, validation_errors, narrative_json, facts_json, pdf_path, pdf_storage_bucket, failure_code, failure_reason, generated_at, generated_by",
      )
      .eq("id", run.package_id)
      .single();
    if (data) {
      pkg = data as Record<string, unknown>;
      if (data.pdf_path) {
        const { data: signed } = await sb.storage
          .from((data.pdf_storage_bucket as string) ?? "evidence-packs")
          .createSignedUrl(data.pdf_path as string, PREVIEW_TTL_SECONDS);
        signedUrl = signed?.signedUrl ?? null;
      }
    }
  }

  return NextResponse.json({ run, package: pkg, pdfUrl: signedUrl });
}
