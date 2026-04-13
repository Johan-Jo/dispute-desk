import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  DISPUTE_DETAIL_QUERY,
  type DisputeDetailNode,
} from "@/lib/shopify/queries/disputes";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import {
  STATUS_CHANGED,
  SUBMISSION_CONFIRMED,
  OUTCOME_DETECTED,
  DISPUTE_CLOSED,
  DISPUTE_RESYNCED,
} from "@/lib/disputeEvents/eventTypes";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function decryptAccessToken(encrypted: string): string {
  try {
    return decrypt(deserializeEncrypted(encrypted));
  } catch {
    return encrypted;
  }
}

/**
 * POST /api/disputes/:id/resync
 *
 * Re-fetches a single dispute from Shopify and updates the local row.
 * Respects override locks: overridden fields are not overwritten.
 *
 * Auth: admin or support role via Supabase JWT.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();

  // Verify admin/support role
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: { user } } = await sb.auth.getUser(authHeader.slice(7));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== "admin" && role !== "support") {
    return NextResponse.json({ error: "Admin or support role required" }, { status: 403 });
  }

  // Load dispute
  const { data: dispute } = await sb
    .from("disputes")
    .select("*")
    .eq("id", disputeId)
    .single();

  if (!dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const row = dispute as Record<string, unknown>;
  const overriddenFields = (row.overridden_fields as Record<string, boolean>) ?? {};

  // Load shop offline session
  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, key_version, shop_domain")
    .eq("shop_id", dispute.shop_id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "No offline session for shop" }, { status: 400 });
  }

  const accessToken = decryptAccessToken(session.access_token_encrypted);

  // Fetch from Shopify
  const gql = await requestShopifyGraphQL<{ dispute: DisputeDetailNode }>({
    session: { shopDomain: session.shop_domain ?? "", accessToken },
    query: DISPUTE_DETAIL_QUERY,
    variables: { id: dispute.dispute_gid },
    correlationId: `resync-${disputeId}`,
  });

  if (gql.errors?.length || !gql.data?.dispute) {
    return NextResponse.json({
      error: "Failed to fetch dispute from Shopify",
      details: gql.errors?.map((e) => e.message),
    }, { status: 502 });
  }

  const d = gql.data.dispute;
  const now = new Date().toISOString();
  const refreshedFields: string[] = [];
  const lockedFields: string[] = [];

  // Build update (respecting overrides)
  const update: Record<string, unknown> = {
    last_synced_at: now,
    sync_health: "ok",
  };

  const newStatus = d.status?.toLowerCase() ?? null;
  if (!overriddenFields.final_outcome) {
    if (row.status !== newStatus) {
      update.status = newStatus;
      refreshedFields.push("status");

      void emitDisputeEvent({
        disputeId,
        shopId: dispute.shop_id,
        eventType: STATUS_CHANGED,
        description: `${String(row.status)} → ${newStatus}`,
        eventAt: now,
        actorType: "shopify",
        sourceType: "shopify_sync",
        metadataJson: { old_status: row.status, new_status: newStatus, trigger: "resync" },
        dedupeKey: `${disputeId}:${STATUS_CHANGED}:${String(row.status)}_${newStatus}`,
      });

      // Terminal outcome
      const terminalMap: Record<string, string> = {
        won: "won", lost: "lost", charge_refunded: "refunded", accepted: "accepted",
      };
      if (newStatus && newStatus in terminalMap && !row.final_outcome) {
        update.final_outcome = terminalMap[newStatus];
        const amount = Number(row.amount) || 0;
        update.outcome_amount_recovered = terminalMap[newStatus] === "won" ? amount : 0;
        update.outcome_amount_lost = terminalMap[newStatus] === "won" ? 0 : amount;
        update.outcome_source = "shopify_sync";
        update.outcome_confidence = "high";
        if (!row.closed_at) update.closed_at = d.finalizedOn ?? now;
        refreshedFields.push("final_outcome", "closed_at");

        void emitDisputeEvent({
          disputeId,
          shopId: dispute.shop_id,
          eventType: OUTCOME_DETECTED,
          eventAt: d.finalizedOn ?? now,
          actorType: "shopify",
          sourceType: "shopify_sync",
          metadataJson: { final_outcome: terminalMap[newStatus], trigger: "resync" },
          dedupeKey: `${disputeId}:${OUTCOME_DETECTED}:${terminalMap[newStatus]}`,
        });

        void emitDisputeEvent({
          disputeId,
          shopId: dispute.shop_id,
          eventType: DISPUTE_CLOSED,
          eventAt: d.finalizedOn ?? now,
          actorType: "shopify",
          sourceType: "shopify_sync",
          dedupeKey: `${disputeId}:${DISPUTE_CLOSED}`,
        });
      }
    } else {
      refreshedFields.push("status");
    }
  } else {
    lockedFields.push("final_outcome", "status");
  }

  if (d.evidenceDueBy && d.evidenceDueBy !== row.due_at) {
    update.due_at = d.evidenceDueBy;
    refreshedFields.push("due_at");
  }

  // Submission confirmation
  if (!overriddenFields.submission_state && !overriddenFields.submitted_at) {
    if (d.evidenceSentOn && row.submission_state !== "submitted_confirmed") {
      update.submission_state = "submitted_confirmed";
      update.submitted_at = d.evidenceSentOn;
      refreshedFields.push("submission_state", "submitted_at");

      void emitDisputeEvent({
        disputeId,
        shopId: dispute.shop_id,
        eventType: SUBMISSION_CONFIRMED,
        eventAt: d.evidenceSentOn,
        actorType: "shopify",
        sourceType: "shopify_sync",
        dedupeKey: `${disputeId}:${SUBMISSION_CONFIRMED}:${d.evidenceSentOn}`,
      });
    }
  } else {
    if (overriddenFields.submission_state) lockedFields.push("submission_state");
    if (overriddenFields.submitted_at) lockedFields.push("submitted_at");
  }

  if (overriddenFields.closed_at) {
    lockedFields.push("closed_at");
  }

  await sb.from("disputes").update(update).eq("id", disputeId);

  void emitDisputeEvent({
    disputeId,
    shopId: dispute.shop_id,
    eventType: DISPUTE_RESYNCED,
    description: `Resynced by ${role}. Refreshed: ${refreshedFields.join(", ") || "none"}. Locked: ${lockedFields.join(", ") || "none"}.`,
    eventAt: now,
    actorType: "disputedesk_admin",
    actorRef: user.email ?? undefined,
    sourceType: "system",
    visibility: "internal_only",
    metadataJson: { refreshed_fields: refreshedFields, locked_fields: lockedFields },
    dedupeKey: `${disputeId}:${DISPUTE_RESYNCED}:${now}`,
  });

  void updateNormalizedStatus(disputeId);

  return NextResponse.json({
    resynced: true,
    refreshedFields,
    lockedFields,
  });
}
