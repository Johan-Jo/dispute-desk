/**
 * Policy snapshot evidence source collector.
 *
 * Reads policy_snapshots from the database for the shop.
 * Contributes shipping_policy, refund_policy, cancellation_policy.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { EvidenceSection, BuildContext } from "../types";

const POLICY_FIELD_MAP: Record<string, string> = {
  shipping: "shipping_policy",
  refunds: "refund_policy",
  terms: "cancellation_policy",
};

export async function collectPolicyEvidence(
  ctx: BuildContext
): Promise<EvidenceSection[]> {
  const sb = getServiceClient();

  const { data: policies } = await sb
    .from("policy_snapshots")
    .select("id, policy_type, url, content_hash, extracted_text, captured_at")
    .eq("shop_id", ctx.shopId)
    .order("captured_at", { ascending: false });

  if (!policies?.length) return [];

  // Deduplicate: keep only the most recent per policy_type
  const latest = new Map<string, (typeof policies)[0]>();
  for (const p of policies) {
    if (!latest.has(p.policy_type)) {
      latest.set(p.policy_type, p);
    }
  }

  const fieldsProvided: string[] = [];
  const policyEntries: Record<string, unknown>[] = [];

  for (const [type, policy] of latest) {
    const field = POLICY_FIELD_MAP[type];
    if (field) fieldsProvided.push(field);

    policyEntries.push({
      policySnapshotId: policy.id,
      policyType: type,
      url: policy.url,
      capturedAt: policy.captured_at,
      contentHash: policy.content_hash,
      textPreview: policy.extracted_text?.slice(0, 500) ?? null,
      textLength: policy.extracted_text?.length ?? 0,
    });
  }

  return [
    {
      type: "policy",
      label: `Store Policies (${policyEntries.length})`,
      source: "policy_snapshots",
      fieldsProvided,
      data: { policies: policyEntries },
    },
  ];
}
