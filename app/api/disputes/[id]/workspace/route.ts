import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { getArgumentTemplate, getIssuerClaimText } from "@/lib/argument/templates";
import { normalizeMode } from "@/lib/rules/normalizeMode";
import {
  collectedFieldsFromPack,
  reconcileChecklistWithCollectedFields,
} from "@/lib/packs/checklistReconcile";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { isFileEvidenceAttachmentsEnabled } from "@/lib/featureFlags";
import { deriveOrderContext } from "@/lib/defence/orderContext";
import {
  deriveEvidenceLineItems,
  type EvidenceLineItem,
  type SubmissionMethod,
} from "@/lib/argument/evidenceLineItem";
import { buildInternalSignalsByField } from "@/lib/argument/internalSignals";
import { resolveReasonFamily } from "@/lib/argument/reasonFamily";
import { CANONICAL_EVIDENCE, categoryFor } from "@/lib/argument/canonicalEvidence";
import {
  calculateCaseStrength,
  type CaseStrengthContribution,
} from "@/lib/argument/caseStrength";
import type { EvidenceFact } from "@/lib/defence/types";
import { CURRENT_PROMPT_VERSION } from "@/lib/defence/narrativeWriter";

/** Merchant-facing dispute submission state derived from the underlying
 *  DB enums + Shopify forwarding signal. See plan §"presentationStatus". */
export type PresentationStatus =
  | "DRAFT"
  | "SAVED_TO_SHOPIFY"
  | "AWAITING_SHOPIFY_AUTO_SUBMISSION"
  | "SUBMITTED_TO_NETWORK"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "CLOSED_UNKNOWN";

function derivePresentationStatus(args: {
  packExists: boolean;
  submissionState: string | null;
  normalizedStatus: string | null;
  finalOutcome: string | null;
  evidenceSentOn: string | null;
}): PresentationStatus {
  if (!args.packExists) return "DRAFT";
  if (args.finalOutcome === "won") return "CLOSED_WON";
  if (args.finalOutcome === "lost") return "CLOSED_LOST";
  if (args.finalOutcome != null) return "CLOSED_UNKNOWN";
  if (args.submissionState === "manual_submission_reported") return "CLOSED_UNKNOWN";
  // Shopify forwarded to the card network — the only state in which the
  // UI may say "card network review" / "submitted to network".
  if (args.normalizedStatus === "submitted_to_bank" || args.evidenceSentOn != null) {
    return "SUBMITTED_TO_NETWORK";
  }
  if (args.submissionState === "submitted_confirmed") {
    return "AWAITING_SHOPIFY_AUTO_SUBMISSION";
  }
  if (args.submissionState === "saved_to_shopify") return "SAVED_TO_SHOPIFY";
  return "DRAFT";
}

/** Scopes required for the file evidence layer's REST upload path
 *  (Phase 0 + 3). When the flag is on but the merchant's offline
 *  session was issued before these scopes shipped (commit f61176c),
 *  the merchant must reinstall to grant them — otherwise the save
 *  job's REST upload returns 403/404. The workspace surfaces a
 *  reinstall banner so they can self-serve.
 *
 *  Only the WRITE scope is checked. Shopify's OAuth deduplicates
 *  granted scopes — `write_*` subsumes `read_*`, so the stored
 *  session string only ever contains `write_shopify_payments_dispute_file_uploads`
 *  even when the app requests both. Requiring both would always
 *  return false-positive "missing scopes" and trigger the reinstall
 *  banner even after a successful reinstall. */
const FILE_EVIDENCE_REQUIRED_SCOPES = [
  "write_shopify_payments_dispute_file_uploads",
] as const;

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
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();

  // ── 1. Load dispute with shop_domain ──────────────────────────────
  const { data: row, error: disputeErr } = await sb
    .from("disputes")
    .select("*, shops(shop_domain)")
    .eq("id", disputeId)
    .eq("shop_id", shopId)
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

  // Fallback for older packs whose evidence_items rows were inserted
  // before payload.fieldsProvided was persisted. The data still exists
  // in pack_json.sections — synthesize ID-keyed entries from the raw
  // section so the categorizer can read avs_cvv_match codes,
  // ip_location_check signals, delivery proofType, etc. Without this,
  // an evidence-rich submitted pack reads as "0% confidence" because
  // every conditional field falls through the categorizer's
  // explicit-fail branch.
  type RawSection = {
    type?: string;
    label?: string;
    source?: string;
    fieldsProvided?: string[];
    data?: Record<string, unknown>;
  };
  const packJsonSections =
    ((packRow?.pack_json as { sections?: RawSection[] } | null)?.sections ?? []);
  for (const s of packJsonSections) {
    for (const f of s.fieldsProvided ?? []) {
      if (f in evidenceItemsByField) continue;
      evidenceItemsByField[f] = {
        id: `pack-section:${f}`,
        type: s.type,
        label: s.label ?? null,
        source: s.source ?? null,
        payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided },
      };
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
    // Accept either a legacy `fileId` (Storage object id) or the
    // current `storagePath` (bucket/key string). Real merchant uploads
    // from the embedded UI write `storagePath`; some older auto-collected
    // items wrote `fileId`. Without this fallback the Review tab silently
    // hid every uploaded file. The downstream UI doesn't render the id
    // — it's only used as a stable React key — so a string from either
    // source is fine.
    const fileId =
      typeof p.fileId === "string"
        ? p.fileId
        : typeof p.storagePath === "string"
          ? p.storagePath
          : null;
    if (!fileId) continue;
    attachments.push({
      id: it.id,
      evidenceFieldKey:
        typeof p.checklistField === "string" ? p.checklistField : null,
      label: it.label ?? null,
      fileName: typeof p.fileName === "string" ? p.fileName : null,
      sizeBytes: typeof p.fileSize === "number" ? p.fileSize : null,
      mimeType:
        typeof p.mimeType === "string"
          ? p.mimeType
          : typeof p.fileType === "string"
            ? p.fileType
            : null,
      source: it.source ?? null,
      fileId,
    });
  }

  // ── 6. Shape the response ─────────────────────────────────────────
  // Order context (card network, last 4, transaction date, gateway,
  // financial + fulfillment status, line items, timeline events) lives
  // in `pack_json.sections` — not as columns on `disputes`. The HTML
  // mirror on the Review & Submit tab consumes these via
  // `CompleteDefencePackageCard`'s `DisputeContextLike` prop. Same
  // helper that `buildDefencePackageJob` uses so the two views stay
  // in lockstep (2026-05-16 fix).
  const orderContext = deriveOrderContext(
    packJsonSections.map((s) => ({
      type: s.type ?? "",
      label: s.label ?? "",
      source: s.source ?? "",
      data: s.data ?? {},
      fieldsProvided: s.fieldsProvided ?? [],
    })),
  );

  const dispute = {
    id: row.id,
    reason: row.reason,
    phase: row.phase ?? null,
    amount: row.amount,
    currency: row.currency_code,
    orderName: row.order_name ?? null,
    orderGid: row.order_gid ?? null,
    customerName: row.customer_display_name ?? null,
    shopId: row.shop_id,
    shopDomain,
    disputeGid: row.dispute_gid,
    disputeEvidenceGid: row.dispute_evidence_gid ?? null,
    dueAt: row.due_at ?? null,
    openedAt: row.initiated_at ?? null,
    normalizedStatus: row.normalized_status ?? null,
    submissionState: row.submission_state ?? null,
    /** Set by `lib/disputes/syncDisputes.ts` from Shopify's
     *  `evidenceSentOn`. Only meaningful when
     *  `submissionState === "submitted_confirmed"`. Used in the
     *  Evidence-tab window-closed banner. */
    submittedAt: row.submitted_at ?? null,
    finalOutcome: row.final_outcome ?? null,
    // Order context — populated from pack_json. Each field can still be
    // null when the pack lacks the data (e.g. payment gateway on a
    // non-Shopify-Payments order).
    cardNetwork: orderContext.cardNetwork,
    cardLast4: orderContext.cardLast4,
    transactionDate: orderContext.transactionDate,
    paymentGateway: orderContext.paymentGateway,
    financialStatus: orderContext.financialStatus,
    fulfillmentStatus: orderContext.fulfillmentStatus,
    cardholderName: orderContext.cardholderName ?? row.customer_display_name ?? null,
    // Full event timeline from the pack's access_log section. The PDF
    // builder threads the same array through `meta.timelineEvents`;
    // surfacing it here lets the embedded HTML view render the same
    // rich chronology the bank gets instead of falling back to the
    // synthetic 2-event path. Capped to 20 events upstream in
    // `lib/packs/sources/orderSource.ts`.
    timelineEvents: orderContext.timelineEvents,
  };

  // Reconcile persisted checklist_v2 against fields actually carried by
  // the pack. Older packs (built before the buildPack-side reconcile
  // landed) can have rows still flagged `missing` for evidence the
  // collectors did produce — Overview surfaces would then look empty
  // even though pack_json.sections has the data. Pure normalization on
  // read; no DB write. Uses the same packJsonSections collected above
  // for the evidenceItemsByField fallback.
  const collectedForRead = collectedFieldsFromPack({
    sections: packJsonSections,
    evidenceItems: itemsRes.data ?? [],
  });
  const reconciledChecklistV2 = reconcileChecklistWithCollectedFields(
    (packRow?.checklist_v2 ?? null) as ChecklistItemV2[] | null,
    collectedForRead,
  );

  const pack = packRow
    ? {
        id: packRow.id,
        status: packRow.status,
        completenessScore: packRow.completeness_score ?? null,
        submissionReadiness: packRow.submission_readiness ?? null,
        checklistV2: reconciledChecklistV2,
        waivedItems: packRow.waived_items ?? [],
        evidenceItems: itemsRes.data ?? [],
        // ID-keyed lookup: evidenceFieldKey → first evidence item
        // exposing that field via payload.fieldsProvided. Used by the
        // dispute-detail UI for O(1) raw-value lookups (plan v3 §3.A.5).
        evidenceItemsByField,
        auditEvents: auditRes.data ?? [],
        pdfPath: packRow.pdf_path ?? null,
        savedToShopifyAt: packRow.saved_to_shopify_at ?? null,
        /** Last successful build timestamp. Used by the EvidenceTab
         *  rebuild-outcome banner to detect stale outcomes — if
         *  `lastRebuildAt < updatedAt`, the outcome describes a save
         *  attempt against a previous build, not the current one, and
         *  the banner suppresses itself. */
        updatedAt: (packRow.updated_at as string | null) ?? null,
        /** Resubmission Window: true when a merchant regenerate request
         *  is pending (set by the regenerate endpoint, cleared by
         *  buildPackJob at start). Drives the "Regenerating defence
         *  package" banner during the gap between request and worker
         *  pickup, when status is still `saved_to_shopify_verified`. */
        rebuildPending: (packRow.rebuild_pending as boolean | null) ?? false,
        /** Resubmission Window: user-facing explanation of the most
         *  recent regenerate attempt. NOT authoritative submission
         *  state. See `lib/automation/rebuildOutcome.ts` for the
         *  invariant. Possible values: saved | blocked_weak |
         *  blocked_fatal_loss | blocked_covered |
         *  blocked_no_material_change | failed | null (never
         *  regenerated). */
        lastRebuildOutcome:
          (packRow.last_rebuild_outcome as string | null) ?? null,
        lastRebuildAt:
          (packRow.last_rebuild_at as string | null) ?? null,
        lastRebuildReason:
          (packRow.last_rebuild_reason as string | null) ?? null,
        activeBuildJob: buildJobRes.data ?? null,
        // Surface system-failure metadata so the UI can render a
        // system-error banner instead of misleading evidence-gap copy.
        // failureReason is internal-only — the UI maps failureCode to
        // safe merchant copy and never renders the raw reason.
        failureCode: (packRow.failure_code as string | null) ?? null,
        failureReason: (packRow.failure_reason as string | null) ?? null,
        // Coverage Gate (PRD §4) — surfaced from `pack_json.coverage`
        // so the hook can pass it through to `calculateCaseStrength`
        // and the hero flips to the "Covered" state without re-walking
        // sections.
        coverage:
          ((packRow.pack_json as { coverage?: unknown } | null)?.coverage as
            | {
                state: "covered_shopify" | "not_covered";
                shopifyProtectStatus:
                  | "ACTIVE"
                  | "INACTIVE"
                  | "NOT_PROTECTED"
                  | "PENDING"
                  | "PROTECTED"
                  | null;
              }
            | undefined) ?? null,
        // File evidence layer (Phase 6 — UI transparency). When the
        // flag is on and the save job has run, `pack_json.attachmentUploads`
        // is the authoritative record of which evidence_items landed
        // in which Shopify *File slot. The UI renders a clip icon /
        // badge on Evidence-tab rows that match an uploaded item and
        // explains the routing in Review & Submit.
        attachmentUploads:
          ((packRow.pack_json as { attachmentUploads?: unknown } | null)?.attachmentUploads as
            | Array<{
                evidenceItemId: string;
                evidenceFieldKey: string;
                targetField: string;
                fileGid: string;
                uploadedAt: string;
              }>
            | undefined) ?? [],
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

  // Rebuttal draft — sections are persisted as JSONB by
  // `responseEngine.ts`, which populates `evidenceRefs[]` per section.
  // Old drafts predating that work may lack `evidenceRefs`, so we
  // normalize every section to guarantee the field is always an array
  // (never undefined). Plan v3 §3.A.3.
  const rebRow = rebuttalRes.data;
  type RawRebuttalSection = {
    id: string;
    type: "summary" | "claim" | "conclusion";
    claimId?: string;
    text: string;
    evidenceRefs?: string[] | null;
  };
  const rebuttalDraft = rebRow
    ? {
        sections: ((rebRow.sections as RawRebuttalSection[] | null) ?? []).map(
          (s) => ({
            ...s,
            evidenceRefs: Array.isArray(s.evidenceRefs) ? s.evidenceRefs : [],
          }),
        ),
        source: rebRow.source,
      }
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

  // ── File evidence layer status (Phase 7b) ─────────────────────────
  // Surface enough info for the embedded UI to:
  //   - show a "Reinstall to enable" banner when the flag is on but
  //     scopes are stale (merchant installed before commit f61176c),
  //   - hide the banner when scopes are granted, regardless of flag,
  //   - keep silent when the flag is off.
  const flagEnabled = isFileEvidenceAttachmentsEnabled();
  let scopesGranted = true;
  let missingScopes: string[] = [];
  if (flagEnabled) {
    const { data: sessionRow } = await sb
      .from("shop_sessions")
      .select("scopes")
      .eq("shop_id", row.shop_id)
      .eq("session_type", "offline")
      .is("user_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const scopesString = (sessionRow?.scopes as string | null | undefined) ?? "";
    const granted = new Set(
      scopesString.split(",").map((s) => s.trim()).filter(Boolean),
    );
    missingScopes = FILE_EVIDENCE_REQUIRED_SCOPES.filter(
      (s) => !granted.has(s),
    );
    scopesGranted = missingScopes.length === 0;
  }
  const fileEvidence = {
    flagEnabled,
    scopesGranted,
    missingScopes,
  };

  // ── 7. Derive presentationStatus + evidenceLineItems + submissionSummary ──
  // Single source of truth for the dispute-detail UI surfaces. Plan v2.
  // `submitted_at` stores Shopify's `evidenceSentOn` (per syncDisputes.ts).
  // When set, Shopify has forwarded the evidence to the card network —
  // the only state in which `SUBMITTED_TO_NETWORK` is reachable.
  const presentationStatus = derivePresentationStatus({
    packExists: !!packRow,
    submissionState: row.submission_state ?? null,
    normalizedStatus: row.normalized_status ?? null,
    finalOutcome: row.final_outcome ?? null,
    evidenceSentOn: (row.submitted_at as string | null) ?? null,
  });

  // Build the payload-by-field map the line-item derivation expects.
  const payloadByField = new Map<string, unknown>();
  for (const [field, item] of Object.entries(evidenceItemsByField)) {
    if (item.payload) payloadByField.set(field, item.payload);
  }

  // Defence package rows the embedded ReviewSubmitTab needs. The card
  // used to own its own `GET /api/packs/:packId/defence-packages` fetch
  // that ran on every tab mount — switching tabs unmounted/remounted
  // the card and re-paid the round-trip. Folding the two-row fetch
  // into this composite endpoint lets the workspace's existing 4s
  // poll keep the card fresh without an extra HTTP call, and the tab
  // switch becomes instant because the data is already in memory.
  //
  // Two rows are fetched (same as the deprecated standalone route):
  //   - `latest`:     highest-version row (drives draft preview + actions).
  //   - `bankFacing`: the row in status='submitted' (drives the "Saved to
  //                   Shopify" banner). At most one per pack.
  //
  // `factsJson` for the evidence-line-item derivation below comes from
  // `latest.facts_json` — no separate single-column query needed.
  const DEFENCE_SELECT_COLS =
    "id, version, status, package_mode, generated_at, generated_by, pdf_path, evidence_hash, llm_model, prompt_family, prompt_version, reason_code_module, validation_status, validation_errors, failure_code, failure_reason, submitted_at, narrative_json, facts_json";
  let defencePackageLatest: Record<string, unknown> | null = null;
  let defencePackageBankFacing: Record<string, unknown> | null = null;
  if (packRow?.id) {
    const [latestRes, bankFacingRes] = await Promise.all([
      sb
        .from("defence_packages")
        .select(DEFENCE_SELECT_COLS)
        .eq("source_pack_id", packRow.id)
        .eq("shop_id", row.shop_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("defence_packages")
        .select(DEFENCE_SELECT_COLS)
        .eq("source_pack_id", packRow.id)
        .eq("shop_id", row.shop_id)
        .eq("status", "submitted")
        .maybeSingle(),
    ]);
    defencePackageLatest = (latestRes.data as Record<string, unknown> | null) ?? null;
    defencePackageBankFacing = (bankFacingRes.data as Record<string, unknown> | null) ?? null;
  }
  // Reuse the latest row's facts_json for the line-item derivation
  // below. When absent (no defence package built yet), facts is empty —
  // the line items still resolve via the canonical categorizer, just
  // without fact-anchored bank-narrative flags.
  let factsJson: EvidenceFact[] = [];
  if (Array.isArray((defencePackageLatest as { facts_json?: unknown } | null)?.facts_json)) {
    factsJson = (defencePackageLatest as { facts_json: EvidenceFact[] }).facts_json;
  }

  // Compute strong/moderate contributions for the line-item resolver.
  // Mirrors `useDisputeWorkspace`'s derivation but server-side so the
  // workspace API can ship a fully-derived view-model.
  const coverageInput = pack?.coverage ?? undefined;
  const caseStrength = calculateCaseStrength(
    reconciledChecklistV2,
    row.reason,
    { kind: "byField", map: evidenceItemsByField as Record<string, { payload?: Record<string, unknown> | null }> },
    coverageInput
      ? { state: coverageInput.state, shopifyProtectStatus: coverageInput.shopifyProtectStatus }
      : undefined,
  );
  // computeContributions equivalent inline — same logic as
  // useDisputeWorkspace's derivation, deduped by signalId.
  const RANK_CONTRIB: Record<string, number> = { strong: 3, moderate: 2, supporting: 1, invalid: 0 };
  const bestBySignal = new Map<
    string,
    { category: "strong" | "moderate"; labelKey: string; evidenceFieldKey: string }
  >();
  for (const item of reconciledChecklistV2) {
    if (item.status !== "available" && item.status !== "waived") continue;
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue;
    const cat = categoryFor({
      fieldKey: item.field,
      payload: (evidenceItemsByField[item.field]?.payload ?? null) as Record<string, unknown> | null,
    });
    if (cat !== "strong" && cat !== "moderate") continue;
    const prev = bestBySignal.get(spec.signalId);
    if (!prev || RANK_CONTRIB[cat] > RANK_CONTRIB[prev.category]) {
      bestBySignal.set(spec.signalId, {
        category: cat,
        labelKey: spec.labelKey,
        evidenceFieldKey: item.field,
      });
    }
  }
  const strongContribs: CaseStrengthContribution[] = [];
  const moderateContribs: CaseStrengthContribution[] = [];
  for (const [signalId, acc] of bestBySignal.entries()) {
    const entry: CaseStrengthContribution = {
      signalId: signalId as CaseStrengthContribution["signalId"],
      category: acc.category,
      labelToken: { key: acc.labelKey },
      evidenceFieldKey: acc.evidenceFieldKey,
    };
    if (acc.category === "strong") strongContribs.push(entry);
    else moderateContribs.push(entry);
  }

  // Inclusion overrides — keyed by field. Stored in
  // pack_json.inclusionOverrides (commit 10 writes here; empty until
  // the override route lands).
  type InclusionOverrideMap = Record<string, "force_include" | "force_exclude">;
  const rawOverrides =
    ((packRow?.pack_json as { inclusionOverrides?: InclusionOverrideMap } | null)
      ?.inclusionOverrides as InclusionOverrideMap | undefined) ?? {};
  const inclusionOverrides = new Map<string, "force_include" | "force_exclude">(
    Object.entries(rawOverrides) as Array<[string, "force_include" | "force_exclude"]>,
  );

  // Excluded fields — legacy excludedFields list lives transiently in
  // clientState; pack-side persistence happens through inclusionOverrides
  // (force_exclude). For server-side derivation we just consume the
  // overrides map.
  const excludedFromOverrides = new Set<string>();
  for (const [field, value] of inclusionOverrides.entries()) {
    if (value === "force_exclude") excludedFromOverrides.add(field);
  }

  // Attachment upload failures map. Today `pack_json.attachmentUploads`
  // only records successes; future schema may add `attachmentUploadFailures[]`.
  // Stay defensive — empty map when not present.
  const rawFailures =
    ((packRow?.pack_json as { attachmentUploadFailures?: Array<{ field: string; reason: string }> } | null)
      ?.attachmentUploadFailures as Array<{ field: string; reason: string }> | undefined) ?? [];
  const attachmentUploadFailures = new Map<string, string>();
  for (const f of rawFailures) attachmentUploadFailures.set(f.field, f.reason);

  // Internal-only signals, anchored to fields.
  const internalSignalsByField = buildInternalSignalsByField(payloadByField);

  // Override audit history per field. Surfaces the latest
  // evidence_inclusion_overridden_with_warning event for each field so
  // the Inclusion Review row can render an "You overrode this on
  // Month DD" caption. Only acknowledged-risk overrides are surfaced;
  // routine include/exclude toggles aren't auditable as policy
  // decisions and don't deserve a caption.
  type OverrideAuditEntry = {
    field: string;
    action: "force_include" | "force_exclude" | "clear" | null;
    confirmedAt: string;
    actorType: string | null;
  };
  const overrideHistoryByField = new Map<string, OverrideAuditEntry>();
  if (packRow?.id) {
    const { data: auditRows } = await sb
      .from("audit_events")
      .select("event_type, event_payload, actor_type, created_at")
      .eq("pack_id", packRow.id)
      .eq("event_type", "evidence_inclusion_overridden_with_warning")
      .order("created_at", { ascending: false })
      .limit(50);
    for (const r of (auditRows ?? []) as Array<{
      event_payload: { field?: string; action?: string; confirmedAt?: string } | null;
      actor_type: string | null;
      created_at: string;
    }>) {
      const field = r.event_payload?.field;
      if (typeof field !== "string") continue;
      // First match wins per field (we ordered desc by created_at).
      if (overrideHistoryByField.has(field)) continue;
      overrideHistoryByField.set(field, {
        field,
        action: (r.event_payload?.action ?? null) as OverrideAuditEntry["action"],
        confirmedAt: r.event_payload?.confirmedAt ?? r.created_at,
        actorType: r.actor_type,
      });
    }
  }

  const evidenceLineItems: EvidenceLineItem[] = packRow
    ? deriveEvidenceLineItems({
        checklist: reconciledChecklistV2,
        facts: factsJson,
        payloadByField,
        contributions: { strong: strongContribs, moderate: moderateContribs },
        packSavedToShopify: !!packRow.saved_to_shopify_at,
        excludedFields: excludedFromOverrides,
        attachmentUploadFailures,
        inclusionOverrides,
        reasonFamily: resolveReasonFamily(row.reason),
        internalSignalsByField,
        overrideHistoryByField,
      })
    : [];

  // Submission summary — drives the SubmissionSummaryPanel.
  // shopifyStructuredFields uses the same first/last split as
  // composeShopifyMutationPayload so the panel matches what gets sent.
  const displayName = (row.customer_display_name as string | null)?.trim() ?? "";
  let customerFirstName: string | null = null;
  let customerLastName: string | null = null;
  if (displayName) {
    const [first, ...rest] = displayName.split(/\s+/);
    customerFirstName = first || null;
    const last = rest.join(" ").trim();
    customerLastName = last || null;
  }
  const factsInPdf = factsJson
    .filter((f) => f.bankEligible && f.includeInBankNarrative && !f.submissionRisk)
    .map((f) => ({
      field: ((f.value as { fieldKey?: string } | null)?.fieldKey ?? "") as string,
      label: f.label,
      categoryLabel: f.category as string,
    }));
  const methodCount = (m: SubmissionMethod): number =>
    evidenceLineItems.filter((li) => li.submissionMethod === m).length;
  const submissionSummary = {
    pdfFileName: packRow?.pdf_path
      ? path.basename(String(packRow.pdf_path))
      : null,
    shopifyStructuredFields: [
      { field: "customer_first_name" as const, value: customerFirstName },
      { field: "customer_last_name" as const, value: customerLastName },
      { field: "customer_email" as const, value: (row.customer_email as string | null) ?? null },
    ],
    factsInPdf,
    counts: {
      usedAsPositiveBankArgument: evidenceLineItems.filter((li) => li.usedAsPositiveBankEvidence).length,
      contextOnly: methodCount("context_only"),
      internalOnly: methodCount("internal_only"),
      excluded: methodCount("excluded"),
      notSupported: methodCount("not_supported"),
      failedUpload: methodCount("failed_upload"),
      waived: methodCount("waived"),
    },
  };
  // Reference unused fields so tsc doesn't complain when caseStrength
  // isn't directly returned (the workspace UI re-derives it client-side
  // for now; the server-side compute exists so future commits can move
  // strengthReason composition to the API).
  void caseStrength;

  return NextResponse.json({
    dispute,
    pack,
    argumentMap,
    rebuttalDraft,
    rebuttalOutdated,
    presentationStatus,
    evidenceLineItems,
    submissionSummary,
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
    fileEvidence,
    // Defence package data for the embedded ReviewSubmitTab. Folded
    // into the workspace endpoint so the card no longer needs its own
    // fetch-on-mount — switching tabs is now instant and the existing
    // 4s workspace poll keeps the rows fresh.
    defencePackage: {
      latest: defencePackageLatest,
      bankFacing: defencePackageBankFacing,
      currentPromptVersion: CURRENT_PROMPT_VERSION,
    },
  });
}
