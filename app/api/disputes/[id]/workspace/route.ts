import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getArgumentTemplate, getIssuerClaimText } from "@/lib/argument/templates";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/disputes/:id/workspace?locale=xx
 *
 * Composite endpoint that returns ALL data needed for the dispute workspace
 * in a single request: dispute, latest pack (with evidence items, audit
 * events, active build job), argument map, rebuttal draft, and case-type
 * info from the argument templates.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const locale = req.nextUrl.searchParams.get("locale") ?? "en-US";
  const sb = getServiceClient();

  // ── 1. Load dispute with shop_domain ──────────────────────────────
  const { data: row, error: disputeErr } = await sb
    .from("disputes")
    .select("*, shops(shop_domain)")
    .eq("id", disputeId)
    .single();

  if (disputeErr || !row) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const shop = Array.isArray(row.shops) ? row.shops[0] : row.shops;
  const shopDomain =
    (shop as { shop_domain?: string } | null)?.shop_domain ?? null;

  // ── 2. Load latest evidence pack ──────────────────────────────────
  const { data: packRow } = await sb
    .from("evidence_packs")
    .select("*")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── 3. Parallel fetches (only when pack exists) ───────────────────
  const packId = packRow?.id ?? null;

  const [
    itemsRes,
    auditRes,
    buildJobRes,
    argumentRes,
    rebuttalRes,
  ] = await Promise.all([
    // Evidence items
    packId
      ? sb
          .from("evidence_items")
          .select("*")
          .eq("pack_id", packId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),

    // Audit events
    packId
      ? sb
          .from("audit_events")
          .select("id, event_type, event_payload, actor_type, created_at")
          .eq("pack_id", packId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),

    // Active build job
    packId
      ? sb
          .from("jobs")
          .select("id, status, last_error, created_at, updated_at")
          .eq("entity_id", packId)
          .eq("job_type", "build_pack")
          .in("status", ["queued", "running"])
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // Argument map
    packId
      ? sb
          .from("argument_maps")
          .select("*")
          .eq("dispute_id", disputeId)
          .eq("pack_id", packId)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // Rebuttal draft
    packId
      ? sb
          .from("rebuttal_drafts")
          .select("*")
          .eq("pack_id", packId)
          .eq("locale", "en-US")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // ── 4. Build case type info from argument templates ───────────────
  const template = getArgumentTemplate(row.reason);
  const issuerClaimText = getIssuerClaimText(row.reason);

  // ── 5. Shape the response ─────────────────────────────────────────
  const dispute = {
    id: row.id,
    reason: row.reason,
    phase: row.phase ?? null,
    amount: row.amount,
    currency: row.currency_code,
    orderName: row.order_name ?? null,
    orderGid: row.order_gid ?? null,
    customerName: row.customer_display_name ?? null,
    shopDomain,
    disputeGid: row.dispute_gid,
    disputeEvidenceGid: row.dispute_evidence_gid ?? null,
    dueAt: row.due_at ?? null,
    openedAt: row.initiated_at ?? null,
    normalizedStatus: row.normalized_status ?? null,
    submissionState: row.submission_state ?? null,
    finalOutcome: row.final_outcome ?? null,
  };

  const pack = packRow
    ? {
        id: packRow.id,
        status: packRow.status,
        completenessScore: packRow.completeness_score ?? null,
        submissionReadiness: packRow.submission_readiness ?? null,
        checklistV2: packRow.checklist_v2 ?? null,
        waivedItems: packRow.waived_items ?? [],
        evidenceItems: itemsRes.data ?? [],
        auditEvents: auditRes.data ?? [],
        pdfPath: packRow.pdf_path ?? null,
        savedToShopifyAt: packRow.saved_to_shopify_at ?? null,
        activeBuildJob: buildJobRes.data ?? null,
      }
    : null;

  const argMap = argumentRes.data;
  const argumentMap = argMap
    ? {
        issuerClaim: argMap.issuer_claim,
        counterclaims: argMap.counterclaims,
        overallStrength: argMap.overall_strength,
      }
    : null;

  const rebRow = rebuttalRes.data;
  const rebuttalDraft = rebRow
    ? { sections: rebRow.sections, source: rebRow.source }
    : null;

  return NextResponse.json({
    dispute,
    pack,
    argumentMap,
    rebuttalDraft,
    submissionFields: [],
    caseTypeInfo: {
      disputeType: template.disputeType,
      toWin: template.toWin,
      strongestEvidence: template.strongestEvidence,
      issuerClaim: issuerClaimText,
    },
  });
}
