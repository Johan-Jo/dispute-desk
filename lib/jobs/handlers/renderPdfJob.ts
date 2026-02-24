import { getServiceClient } from "../../supabase/server";
import { logAuditEvent } from "../../audit/logEvent";
import type { ClaimedJob } from "../claimJobs";

/**
 * Job handler: render_pdf
 *
 * Loads pack JSON, renders PDF via @react-pdf/renderer,
 * uploads to Supabase Storage, updates pdf_path.
 *
 * entity_id = evidence_packs.id
 */
export async function handleRenderPdf(job: ClaimedJob): Promise<void> {
  const db = getServiceClient();
  const packId = job.entityId;
  if (!packId) throw new Error("render_pdf job missing entity_id (pack ID)");

  await logAuditEvent({
    shopId: job.shopId,
    packId,
    actorType: "system",
    eventType: "job_started",
    eventPayload: { jobId: job.id, jobType: "render_pdf" },
  });

  try {
    const { data: pack, error: fetchErr } = await db
      .from("evidence_packs")
      .select("pack_json, shop_id, pdf_path")
      .eq("id", packId)
      .single();

    if (fetchErr || !pack) throw new Error("Pack not found");

    // TODO: wire in actual @react-pdf/renderer call
    // const pdfBuffer = await renderPdf(pack.pack_json);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const storagePath = `${pack.shop_id}/${packId}/${timestamp}.pdf`;
    const previousPath = pack.pdf_path;

    // TODO: upload pdfBuffer to Supabase Storage bucket "evidence-packs"
    // const { error: uploadErr } = await db.storage
    //   .from("evidence-packs")
    //   .upload(storagePath, pdfBuffer, { contentType: "application/pdf" });

    await db
      .from("evidence_packs")
      .update({ pdf_path: storagePath, updated_at: new Date().toISOString() })
      .eq("id", packId);

    await logAuditEvent({
      shopId: job.shopId,
      packId,
      actorType: "system",
      eventType: "pdf_rendered",
      eventPayload: {
        jobId: job.id,
        storagePath,
        previousPath: previousPath ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await logAuditEvent({
      shopId: job.shopId,
      packId,
      actorType: "system",
      eventType: "job_failed",
      eventPayload: { jobId: job.id, error: message },
    });

    throw err;
  }
}
