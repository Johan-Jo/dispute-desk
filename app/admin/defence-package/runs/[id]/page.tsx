import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Activity, ArrowLeft } from "lucide-react";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_TTL_SECONDS = 600;

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
  const { id } = await params;
  const sb = getServiceClient();
  const { data: run } = await sb
    .from("defence_package_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (!run) notFound();

  let pkg: Record<string, unknown> | null = null;
  let pdfUrl: string | null = null;
  if (run.package_id) {
    const { data } = await sb
      .from("defence_packages")
      .select(
        "id, version, status, package_mode, evidence_hash, llm_model, prompt_family, prompt_version, reason_code_module, validation_status, validation_errors, narrative_json, facts_json, pdf_path, pdf_storage_bucket, failure_code, failure_reason, generated_at, generated_by",
      )
      .eq("id", run.package_id)
      .single();
    if (data) {
      pkg = data as Record<string, unknown>;
      if (data.pdf_path) {
        const { data: signed } = await sb.storage
          .from((data.pdf_storage_bucket as string) ?? "evidence-packs")
          .createSignedUrl(data.pdf_path as string, PREVIEW_TTL_SECONDS);
        pdfUrl = signed?.signedUrl ?? null;
      }
    }
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/defence-package/runs" className="text-[#64748B] hover:text-[#0F172A]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Run detail"
          subtitle={`Created ${new Date(run.created_at).toLocaleString()}`}
          icon={Activity}
        />
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <KV label="Model" value={run.model ?? "—"} />
        <KV label="Mode" value={run.package_mode ?? "—"} />
        <KV label="Prompt tokens" value={String(run.prompt_tokens ?? "—")} />
        <KV label="Completion tokens" value={String(run.completion_tokens ?? "—")} />
        <KV label="Duration" value={run.duration_ms != null ? `${run.duration_ms} ms` : "—"} />
        <KV label="Validation" value={run.validation_status ?? "—"} />
        <KV label="Prompt version" value={String(run.prompt_version ?? "—")} />
        <KV label="Daily bucket" value={String(run.daily_bucket ?? "—")} />
      </section>

      {pkg && (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-[#0F172A]">Package</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <KV label="Version" value={`v${pkg.version}`} />
              <KV label="Status" value={String(pkg.status)} />
              <KV label="Evidence hash" value={String(pkg.evidence_hash).slice(0, 16) + "…"} />
              <KV label="Reason module" value={String(pkg.reason_code_module ?? "—")} />
            </div>
            {pdfUrl && (
              <p>
                <a href={pdfUrl} target="_blank" rel="noopener" className="text-[#1D4ED8] hover:underline">
                  Download / preview signed PDF
                </a>
              </p>
            )}
          </section>

          <section>
            <h3 className="font-semibold text-[#0F172A] mb-2">Approved facts</h3>
            <pre className="bg-[#0F172A] text-[#F1F5F9] text-xs p-4 rounded overflow-auto max-h-72">
              {JSON.stringify(pkg.facts_json ?? [], null, 2)}
            </pre>
          </section>

          <section>
            <h3 className="font-semibold text-[#0F172A] mb-2">Narrative (LLM output)</h3>
            <pre className="bg-[#0F172A] text-[#F1F5F9] text-xs p-4 rounded overflow-auto max-h-96">
              {JSON.stringify(pkg.narrative_json ?? {}, null, 2)}
            </pre>
          </section>

          {Array.isArray(pkg.validation_errors) && pkg.validation_errors.length > 0 && (
            <section>
              <h3 className="font-semibold text-[#0F172A] mb-2">Validation errors</h3>
              <pre className="bg-rose-50 text-rose-900 text-xs p-4 rounded overflow-auto max-h-72">
                {JSON.stringify(pkg.validation_errors, null, 2)}
              </pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[#E5E7EB] bg-white p-3">
      <div className="text-xs text-[#64748B]">{label}</div>
      <div className="font-medium text-[#0F172A] break-all">{value}</div>
    </div>
  );
}
