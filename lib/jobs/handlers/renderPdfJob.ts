import { getServiceClient } from "../../supabase/server";
import { logAuditEvent } from "../../audit/logEvent";
import { renderPackPdf } from "../../packs/renderPdf";
import { emitDisputeEvent } from "../../disputeEvents/emitEvent";
import { PDF_RENDERED } from "../../disputeEvents/eventTypes";
import type { PackPdfData } from "../../packs/pdf/EvidencePackDocument";
import type { ClaimedJob } from "../claimJobs";
import { normalizeChecklistV2Shape } from "../../packs/checklistReconcile";
import { loadEffectivePackView, toDisplayChecklistRows } from "../../packs/effectivePackView";

/**
 * Job handler: render_pdf
 *
 * Loads pack + audit events, renders PDF via @react-pdf/renderer
 * (dynamic imports via reactPdfRuntime), uploads to Supabase Storage,
 * updates pdf_path on the pack row.
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
      .select(
        "id, shop_id, dispute_id, pack_json, completeness_score, checklist, checklist_v2, response_cycle, blockers, recommended_actions, pdf_path, created_at"
      )
      .eq("id", packId)
      .single();

    if (fetchErr || !pack) throw new Error("Pack not found");

    const { data: dispute } = await db
      .from("disputes")
      .select("dispute_gid, reason")
      .eq("id", pack.dispute_id)
      .single();

    const { data: shop } = await db
      .from("shops")
      .select("shop_domain")
      .eq("id", pack.shop_id)
      .single();

    const { data: auditEvents } = await db
      .from("audit_events")
      .select("id, event_type, actor_type, created_at")
      .eq("pack_id", packId)
      .order("created_at", { ascending: true })
      .limit(50);

    const packJson = pack.pack_json as Record<string, unknown> | null;
    const sections = (packJson?.sections as PackPdfData["sections"]) ?? [];

    // PR 5: the printed percentage and rows are the embedded app's effective
    // ones (same assembler + merchantCompleteness), so the PDF cannot show a
    // stored percentage or a row the record makes impossible. Print-time only:
    // nothing is written back to the pack. Stored fallback when no stored v2.
    const storedV2 = (pack as { checklist_v2?: unknown }).checklist_v2 ?? null;
    const hasStoredV2 = (normalizeChecklistV2Shape(storedV2)?.length ?? 0) > 0;
    const effective =
      hasStoredV2 && pack.dispute_id
        ? await loadEffectivePackView(db, {
            shopId: pack.shop_id,
            disputeId: pack.dispute_id,
            packCycle: (pack as { response_cycle?: number | null }).response_cycle ?? 1,
            checklistV2: storedV2,
            packSections: sections,
            evidenceItems:
              (await db.from("evidence_items").select("source, payload").eq("pack_id", packId))
                .data ?? [],
          })
        : null;

    const pdfData: PackPdfData = {
      packId: pack.id,
      shopName: shop?.shop_domain ?? "Unknown Shop",
      disputeGid: dispute?.dispute_gid ?? "Unknown",
      disputeReason: dispute?.reason ?? null,
      generatedAt: new Date().toISOString(),
      completenessScore: effective ? effective.merchantCompleteness : (pack.completeness_score ?? 0),
      checklist: effective
        ? toDisplayChecklistRows(effective.checklist)
        : ((pack.checklist as PackPdfData["checklist"]) ?? []),
      blockers: (pack.blockers as string[]) ?? [],
      recommendedActions: (pack.recommended_actions as string[]) ?? [],
      sections,
      auditEvents: auditEvents ?? [],
    };

    console.info("render-pdf-job", {
      renderer: "react-pdf",
      packId,
      shopId: job.shopId,
      jobId: job.id,
    });

    const result = await renderPackPdf(pdfData);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const storagePath = `${pack.shop_id}/${packId}/${timestamp}.pdf`;
    const previousPath = pack.pdf_path;

    const { error: uploadErr } = await db.storage
      .from("evidence-packs")
      .upload(storagePath, result.buffer, {
        contentType: result.contentType,
        upsert: false,
      });

    if (uploadErr) {
      throw new Error(`Storage upload failed: ${uploadErr.message}`);
    }

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
        fileSizeBytes: result.buffer.length,
      },
    });

    if (pack.dispute_id) {
      void emitDisputeEvent({
        disputeId: pack.dispute_id,
        shopId: job.shopId,
        eventType: PDF_RENDERED,
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        metadataJson: { pack_id: packId },
        dedupeKey: `${pack.dispute_id}:${PDF_RENDERED}:${packId}`,
      });
    }
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
