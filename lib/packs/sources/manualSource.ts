/**
 * Manual upload evidence source collector.
 *
 * Reads existing evidence_items with source='manual_upload'
 * for the given pack. These are added via the upload API before
 * or after the build runs.
 */

import { getServiceClient } from "@/lib/supabase/server";
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
      fieldsProvided: ["customer_communication"],
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
