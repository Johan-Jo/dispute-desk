/**
 * Manual upload evidence source collector.
 *
 * Reads existing evidence_items with source='manual_upload'
 * for the given pack. These are added via the upload API before
 * or after the build runs.
 *
 * Emits TWO field names so every downstream completeness path
 * actually sees manual uploads as satisfying their catch-all items:
 *
 *   - MANUAL_UPLOAD_FIELD (= "supporting_documents")
 *       matches the NULL-collector-key path in evaluateCompleteness
 *       (added in commit fe0d2ad for admin-defined template items)
 *       AND the "supporting_documents" items in REASON_TEMPLATES.
 *
 *   - "customer_communication"
 *       matches the "customer_communication" items in REASON_TEMPLATES.
 *       Historically this was the only field manualSource emitted,
 *       so keeping it preserves the behavior of existing dispute
 *       packs where customer_communication was satisfied-by-upload.
 *
 * Without both fields, NULL-collector-key template items stayed
 * perpetually unsatisfied because manualSource only emitted
 * customer_communication while MANUAL_UPLOAD_FIELD expects
 * supporting_documents. See the audit in this session for details.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { MANUAL_UPLOAD_FIELD } from "@/lib/automation/completeness";
import type { EvidenceSection, BuildContext } from "../types";

export async function collectManualEvidence(
  ctx: BuildContext
): Promise<EvidenceSection[]> {
  const sb = getServiceClient();

  const { data: items } = await sb
    .from("evidence_items")
    .select("id, type, label, payload, created_at")
    .eq("pack_id", ctx.packId)
    .eq("source", "manual_upload")
    .order("created_at", { ascending: true });

  if (!items?.length) return [];

  return [
    {
      type: "other",
      label: `Manual Uploads (${items.length})`,
      source: "manual_upload",
      fieldsProvided: [MANUAL_UPLOAD_FIELD, "customer_communication"],
      data: {
        uploads: items.map((item) => ({
          id: item.id,
          type: item.type,
          label: item.label,
          payload: item.payload,
          createdAt: item.created_at,
        })),
      },
    },
  ];
}
