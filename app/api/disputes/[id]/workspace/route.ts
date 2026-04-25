import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getArgumentTemplate, getIssuerClaimText } from "@/lib/argument/templates";
import { normalizeMode } from "@/lib/rules/normalizeMode";

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
    ruleAppliedRes,
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

    // Latest rule_applied event — source of truth for "what automation
    // decided on this dispute". Null when no rule matched (manual default).
    sb
      .from("audit_events")
      .select("event_payload, created_at")
      .eq("dispute_id", disputeId)
      .eq("event_type", "rule_applied")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // ── 4. Build case type info from argument templates ───────────────
  const template = getArgumentTemplate(row.reason);
  const issuerClaimText = getIssuerClaimText(row.reason);

  // ── 5. Build cross-collection ID-keyed maps ───────────────────────
  // Per plan v3 §3.A.5 (NO IMPLICIT UI MAPPING). Computed here so the
  // shapes below can reference them without forward-declaration issues.

  // Evidence-items-by-field map — every checklist entry resolves through
  // `pack.evidenceItemsByField[evidenceFieldKey]` for raw payload values
  // without scanning. Items without a `fieldsProvided` array are skipped
  // (they're not checklist-addressable).
  type RawEvidenceItem = {
    id: string;
    type?: string;
    label?: string | null;
    source?: string | null;
    payload?: {
      fieldsProvided?: string[];
      fileId?: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
      checklistField?: string;
      [k: string]: unknown;
    } | null;
    [k: string]: unknown;
  };
  const evidenceItemsByField: Record<string, RawEvidenceItem> = {};
  for (const it of (itemsRes.data ?? []) as RawEvidenceItem[]) {
    const fields = (it.payload?.fieldsProvided as string[] | undefined) ?? [];
    for (const f of fields) {
      // First write wins — collectors run in deterministic order, so the
      // earliest-collected item for a given field is the canonical source.
      if (!(f in evidenceItemsByField)) evidenceItemsByField[f] = it;
    }
  }

  // Derived attachments[] — first-class file inventory for the dispute
  // detail Review tab (R5 "Supporting documents"). Plan v3 §3.A.4.
  // Sourced from `evidence_items.payload.fileId`. Empty array (not
  // null) so the UI can render an explicit empty state without
  // ambiguity.
  type WorkspaceAttachment = {
    id: string;
    evidenceFieldKey: string | null;
    label: string | null;
    fileName: string | null;
    sizeBytes: number | null;
    mimeType: string | null;
    source: string | null;
    fileId: string;
  };
  const attachments: WorkspaceAttachment[] = [];
  for (const it of (itemsRes.data ?? []) as RawEvidenceItem[]) {
    const p = it.payload ?? {};
    const fileId = typeof p.fileId === "string" ? p.fileId : null;
    if (!fileId) continue;
    attachments.push({
      id: it.id,
      evidenceFieldKey:
        typeof p.checklistField === "string" ? p.checklistField : null,
      label: it.label ?? null,
      fileName: typeof p.fileName === "string" ? p.fileName : null,
      sizeBytes: typeof p.fileSize === "number" ? p.fileSize : null,
      mimeType: typeof p.mimeType === "string" ? p.mimeType : null,
      source: it.source ?? null,
      fileId,
    });
  }

  // ── 6. Shape the response ─────────────────────────────────────────
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
        // ID-keyed lookup: evidenceFieldKey → first evidence item
        // exposing that field via payload.fieldsProvided. Used by the
        // dispute-detail UI for O(1) raw-value lookups (plan v3 §3.A.5).
        evidenceItemsByField,
        auditEvents: auditRes.data ?? [],
        pdfPath: packRow.pdf_path ?? null,
        savedToShopifyAt: packRow.saved_to_shopify_at ?? null,
        activeBuildJob: buildJobRes.data ?? null,
        // Surface system-failure metadata so the UI can render a
        // system-error banner instead of misleading evidence-gap copy.
        // failureReason is internal-only — the UI maps failureCode to
        // safe merchant copy and never renders the raw reason.
        failureCode: (packRow.failure_code as string | null) ?? null,
        failureReason: (packRow.failure_reason as string | null) ?? null,
      }
    : null;

  // Argument map — augment counterclaim entries with `evidenceFieldKey`
  // alias for `field`, and build a server-side `counterclaimsById` map.
  // Both are required by the dispute-detail UI per plan v3 §3.A.5
  // (NO IMPLICIT UI MAPPING — cross-collection refs must resolve by ID).
  const argMap = argumentRes.data;
  type RawCounterclaimRow = {
    field: string;
    label: string;
    [k: string]: unknown;
  };
  type RawCounterclaim = {
    id: string;
    title: string;
    strength: string;
    supporting?: RawCounterclaimRow[];
    missing?: (RawCounterclaimRow & { impact?: string })[];
    systemUnavailable?: RawCounterclaimRow[];
  };
  const augmentRow = <T extends RawCounterclaimRow>(r: T): T & { evidenceFieldKey: string } => ({
    ...r,
    evidenceFieldKey: r.field,
  });
  const augmentedCounterclaims = argMap
    ? (argMap.counterclaims as RawCounterclaim[] | null ?? []).map((c) => ({
        ...c,
        supporting: (c.supporting ?? []).map(augmentRow),
        missing: (c.missing ?? []).map(augmentRow),
        systemUnavailable: (c.systemUnavailable ?? []).map(augmentRow),
      }))
    : [];
  const counterclaimsById: Record<string, (typeof augmentedCounterclaims)[number]> = {};
  for (const c of augmentedCounterclaims) {
    counterclaimsById[c.id] = c;
  }
  const argumentMap = argMap
    ? {
        issuerClaim: argMap.issuer_claim,
        counterclaims: augmentedCounterclaims,
        counterclaimsById,
        overallStrength: argMap.overall_strength,
      }
    : null;

  const rebRow = rebuttalRes.data;
  const rebuttalDraft = rebRow
    ? { sections: rebRow.sections, source: rebRow.source }
    : null;

  const rebuttalOutdated =
    Boolean(packRow?.updated_at) &&
    Boolean(rebRow?.updated_at) &&
    Boolean(argMap) &&
    new Date(packRow!.updated_at as string).getTime() >
      new Date(rebRow!.updated_at as string).getTime();

  const ruleAppliedPayload =
    (ruleAppliedRes.data?.event_payload as
      | { resulting_action?: { mode?: string } }
      | undefined) ?? null;
  const rawAppliedMode = ruleAppliedPayload?.resulting_action?.mode;
  // Surface the normalized (two-mode) value to the workspace UI. Legacy
  // audit rows recorded auto_pack / notify / manual — those collapse to
  // auto / review at the read boundary.
  const appliedRule = rawAppliedMode != null
    ? { mode: normalizeMode(rawAppliedMode) }
    : null;

  return NextResponse.json({
    dispute,
    pack,
    argumentMap,
    rebuttalDraft,
    rebuttalOutdated,
    submissionFields: [],
    // Derived first-class attachment inventory for the dispute Review
    // tab. Always an array (never null) — empty array is the explicit
    // empty state. Plan v3 §3.A.4.
    attachments,
    appliedRule,
    caseTypeInfo: {
      disputeType: template.disputeType,
      toWin: template.toWin,
      strongestEvidence: template.strongestEvidence,
      issuerClaim: issuerClaimText,
    },
  });
}
