import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  DISPUTE_EVIDENCE_UPDATE_MUTATION,
  type DisputeEvidenceUpdateResult,
} from "@/lib/shopify/mutations/disputeEvidenceUpdate";
import { buildEvidenceInput, type PackSection } from "@/lib/shopify/fieldMapping";
import { logAuditEvent } from "@/lib/audit/logEvent";

/**
 * POST /api/packs/:packId/save-to-shopify
 *
 * Requires ONLINE session (user context) for disputeEvidenceUpdate.
 * Uses the dispute_evidence_gid stored during dispute sync.
 *
 * Body: { sections: PackSection[] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const db = getServiceClient();

  // Load pack + dispute
  const { data: pack, error: pErr } = await db
    .from("evidence_packs")
    .select("id, shop_id, dispute_id")
    .eq("id", packId)
    .single();

  if (pErr || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const { data: dispute, error: dErr } = await db
    .from("disputes")
    .select("id, dispute_evidence_gid, dispute_gid, shop_id")
    .eq("id", pack.dispute_id)
    .single();

  if (dErr || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  if (!dispute.dispute_evidence_gid) {
    return NextResponse.json(
      {
        error: "Missing disputeEvidence GID. Sync the dispute first to fetch evidence ID.",
        code: "MISSING_EVIDENCE_GID",
      },
      { status: 422 }
    );
  }

  // Require online session
  const onlineSession = await loadSession(pack.shop_id, "online");
  if (!onlineSession) {
    return NextResponse.json(
      {
        error: "Online session required. Please re-open the app from Shopify Admin to authenticate.",
        code: "ONLINE_SESSION_REQUIRED",
      },
      { status: 403 }
    );
  }

  // Build evidence input from sections
  const body = (await req.json()) as { sections: PackSection[] };
  const evidenceInput = buildEvidenceInput(body.sections);

  // Call Shopify mutation
  const result = await requestShopifyGraphQL<DisputeEvidenceUpdateResult>({
    session: {
      shopDomain: onlineSession.shopDomain,
      accessToken: onlineSession.accessToken,
    },
    query: DISPUTE_EVIDENCE_UPDATE_MUTATION,
    variables: {
      id: dispute.dispute_evidence_gid,
      input: evidenceInput,
    },
    correlationId: `save-evidence-${packId}`,
  });

  const userErrors = result.data?.disputeEvidenceUpdate?.userErrors ?? [];

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: dispute.id,
    packId: pack.id,
    actorType: "merchant",
    eventType: "evidence_saved_to_shopify",
    eventPayload: {
      evidenceGid: dispute.dispute_evidence_gid,
      fieldsSent: Object.keys(evidenceInput),
      userErrors,
    },
  });

  if (userErrors.length > 0) {
    return NextResponse.json(
      { error: "Shopify returned errors", userErrors },
      { status: 422 }
    );
  }

  // Update pack timestamp
  await db
    .from("evidence_packs")
    .update({ last_saved_to_shopify_at: new Date().toISOString() })
    .eq("id", packId);

  return NextResponse.json({
    success: true,
    savedFields: Object.keys(evidenceInput),
    savedAt: new Date().toISOString(),
  });
}
