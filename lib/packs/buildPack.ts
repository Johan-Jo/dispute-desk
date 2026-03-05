/**
 * Evidence pack build orchestrator.
 *
 * 1. Loads dispute + shop session data
 * 2. Runs each source collector in parallel
 * 3. Inserts evidence_items rows + audit events
 * 4. Computes completeness score
 * 5. Assembles pack_json and updates the pack row
 */

import { getServiceClient } from "@/lib/supabase/server";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { evaluateCompleteness } from "@/lib/automation/completeness";
import { collectOrderEvidence } from "./sources/orderSource";
import { collectFulfillmentEvidence } from "./sources/fulfillmentSource";
import { collectPolicyEvidence } from "./sources/policySource";
import { collectManualEvidence } from "./sources/manualSource";
import type { EvidenceSection, BuildContext } from "./types";

function decryptAccessToken(encrypted: string): string {
  try {
    return decrypt(deserializeEncrypted(encrypted));
  } catch {
    return encrypted;
  }
}

export interface BuildResult {
  packId: string;
  status: "ready" | "blocked" | "failed";
  completenessScore: number;
  blockers: string[];
  sectionsCollected: number;
  itemsCreated: number;
}

export async function buildPack(
  packId: string,
  opts?: { correlationId?: string }
): Promise<BuildResult> {
  const sb = getServiceClient();

  // Load pack → dispute → shop + session
  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id")
    .eq("id", packId)
    .single();
  if (packErr || !pack) throw new Error(`Pack not found: ${packId}`);

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, reason, order_gid, dispute_gid")
    .eq("id", pack.dispute_id)
    .single();
  if (!dispute) throw new Error(`Dispute not found: ${pack.dispute_id}`);

  const { data: shop } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("id", pack.shop_id)
    .single();
  if (!shop) throw new Error(`Shop not found: ${pack.shop_id}`);

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted")
    .eq("shop_id", pack.shop_id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) throw new Error(`No offline session for shop ${pack.shop_id}`);

  const ctx: BuildContext = {
    packId,
    disputeId: dispute.id,
    shopId: pack.shop_id,
    disputeReason: dispute.reason,
    orderGid: dispute.order_gid,
    shopDomain: shop.shop_domain,
    accessToken: decryptAccessToken(session.access_token_encrypted),
    correlationId: opts?.correlationId,
  };

  // Run all collectors concurrently
  const results = await Promise.allSettled([
    collectOrderEvidence(ctx),
    collectFulfillmentEvidence(ctx),
    collectPolicyEvidence(ctx),
    collectManualEvidence(ctx),
  ]);

  const allSections: EvidenceSection[] = [];
  const collectorErrors: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      allSections.push(...r.value);
    } else {
      collectorErrors.push(
        r.reason instanceof Error ? r.reason.message : String(r.reason)
      );
    }
  }

  // Insert evidence_items for each section
  let itemsCreated = 0;
  for (const section of allSections) {
    const { error: itemErr } = await sb.from("evidence_items").insert({
      pack_id: packId,
      type: section.type,
      label: section.label,
      source: section.source,
      payload: section.data,
    });

    if (!itemErr) {
      itemsCreated++;
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: dispute.id,
        packId,
        actorType: "system",
        eventType: "item_added",
        eventPayload: {
          type: section.type,
          label: section.label,
          source: section.source,
        },
      });
    }
  }

  // Compute completeness
  const collectedFields = new Set<string>();
  for (const s of allSections) {
    for (const f of s.fieldsProvided) collectedFields.add(f);
  }
  const completeness = evaluateCompleteness(dispute.reason, collectedFields);

  const packStatus = completeness.blockers.length > 0 ? "blocked" : "ready";

  // Build the pack_json
  const packJson = {
    version: 1,
    generatedAt: new Date().toISOString(),
    disputeGid: dispute.dispute_gid,
    disputeReason: dispute.reason,
    sections: allSections.map((s) => ({
      type: s.type,
      label: s.label,
      source: s.source,
      fieldsProvided: s.fieldsProvided,
      data: s.data,
    })),
    completeness: {
      score: completeness.score,
      checklist: completeness.checklist,
      blockers: completeness.blockers,
      recommended_actions: completeness.recommended_actions,
    },
    collectorErrors: collectorErrors.length > 0 ? collectorErrors : undefined,
  };

  // Update the pack row
  await sb
    .from("evidence_packs")
    .update({
      status: packStatus as string,
      pack_json: packJson,
      completeness_score: completeness.score,
      checklist: completeness.checklist,
      blockers: completeness.blockers,
      recommended_actions: completeness.recommended_actions,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  return {
    packId,
    status: packStatus,
    completenessScore: completeness.score,
    blockers: completeness.blockers,
    sectionsCollected: allSections.length,
    itemsCreated,
  };
}
