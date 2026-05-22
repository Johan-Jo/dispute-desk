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

  // Surface cardholder-acknowledgement discriminators at the top level
  // of section.data so the factClassifier's customer_communication
  // extractor (lib/defence/factClassifier.ts:266-271) finds them where
  // it expects them. Without this, the cardholder-acknowledgement
  // payload sits nested under `data.uploads[i].payload`, the extractor
  // reads `data.customerConfirmsOrder` (which is undefined → false),
  // the fact's strength stays at "supporting", includeInBankNarrative
  // is false, and the LLM omits the communicationArgument entirely —
  // exactly the bug observed in defence_packages v4 for dispute D466
  // (2026-05-22). The acknowledgement was inserted by the API route
  // with `customerConfirmsOrder: true` but never reached the narrative.
  //
  // We aggregate across all manual uploads:
  //   - customerConfirmsOrder: true if ANY upload carries it (e.g. the
  //     dedicated cardholder_acknowledgement entry).
  //   - messageCount: total count of upload entries that look like
  //     communication artefacts (cardholder_acknowledgement +
  //     customer_communication uploads). Falls back to the total count
  //     when no kind discriminator is set, since legacy uploads were
  //     all customer-communication file dumps.
  //   - lastMessageAt: the most recent `confirmedAt` or `createdAt` of
  //     a communication upload — gives the chronology builder a real
  //     anchor when the merchant adds an acknowledgement.
  const COMMUNICATION_KINDS = new Set([
    "cardholder_acknowledgement",
    "customer_communication",
  ]);

  let customerConfirmsOrder = false;
  let messageCount = 0;
  let lastMessageAtMs: number | null = null;

  for (const item of items) {
    const payload = (item.payload ?? null) as Record<string, unknown> | null;
    const kind = typeof payload?.kind === "string" ? payload.kind : null;
    const isCommunication = kind === null || COMMUNICATION_KINDS.has(kind);

    if (payload?.customerConfirmsOrder === true) {
      customerConfirmsOrder = true;
    }
    if (isCommunication) {
      messageCount += 1;
      const confirmedAt =
        typeof payload?.confirmedAt === "string" ? payload.confirmedAt : null;
      const ts = confirmedAt ?? item.created_at;
      const tsMs = ts ? Date.parse(ts) : NaN;
      if (!Number.isNaN(tsMs) && (lastMessageAtMs === null || tsMs > lastMessageAtMs)) {
        lastMessageAtMs = tsMs;
      }
    }
  }

  const lastMessageAt =
    lastMessageAtMs !== null ? new Date(lastMessageAtMs).toISOString() : null;

  return [
    {
      type: "other",
      label: `Manual Uploads (${items.length})`,
      source: "manual_upload",
      fieldsProvided: [MANUAL_UPLOAD_FIELD, "customer_communication"],
      data: {
        // Flattened communication signals — read directly by
        // factClassifier.extractValue("customer_communication", …).
        customerConfirmsOrder,
        messageCount: messageCount > 0 ? messageCount : null,
        lastMessageAt,
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
