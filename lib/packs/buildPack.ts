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
import {
  evaluateCompleteness,
  evaluateCompletenessV2,
  deriveCompletenessMetrics,
  type TemplateChecklistItem,
} from "@/lib/automation/completeness";
import { reconcileChecklistWithCollectedFields } from "./checklistReconcile";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  ORDER_DETAIL_QUERY,
  type OrderDetailResponse,
  type OrderDetailNode,
} from "@/lib/shopify/queries/orders";
import { collectOrderEvidence } from "./sources/orderSource";
import { collectFulfillmentEvidence } from "./sources/fulfillmentSource";
import { collectPolicyEvidence } from "./sources/policySource";
import { collectManualEvidence } from "./sources/manualSource";
import { collectCustomerCommEvidence } from "./sources/customerCommSource";
import { collectGorgiasCommEvidence } from "./sources/gorgiasCommSource";
import { collectPaymentEvidence } from "./sources/paymentSource";
import { collectThreeDSecureEvidence } from "./sources/threeDSecureSource";
import { collectFraudRiskEvidence } from "./sources/fraudRiskSource";
import {
  collectCoverageEvidence,
  summarizeCoverage,
  type CoverageSummary,
} from "./sources/coverageSource";
import { collectDeviceLocationEvidence } from "./sources/deviceLocationSource";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import type { CaseStrengthLevel } from "@/lib/argument/types";
import { detectFatalLoss, type FatalLossSummary } from "@/lib/automation/fatalLoss";
import {
  detectRiskWeakness,
  type RiskWeaknessSummary,
} from "@/lib/automation/riskWeakness";
import { enrichDisputeWithNetworkReasonCode } from "@/lib/disputes/enrichNetworkReasonCode";
import { evaluateQualification } from "@/lib/liabilityShift/evaluateQualification";
import type { EvidenceSection, BuildContext } from "./types";
import { readSectionLabel } from "./sectionLabel";
import enMessages from "@/messages/en.json";

/** Lookup helper for synthesizing the audit-event and DB `label`
 *  columns. The persisted JSON `pack_json.sections[].labelToken` is
 *  the canonical source; we additionally write the English-resolved
 *  string into the legacy `label` columns so existing analytics
 *  pipelines continue to read meaningful text. */
function lookupEn(key: string): string {
  const parts = key.split(".");
  let node: unknown = enMessages;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

function enTranslate(key: string, params?: Record<string, string | number>): string {
  let msg = lookupEn(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return msg;
}

function sectionLabelEn(section: EvidenceSection): string {
  return readSectionLabel(section, enTranslate);
}
import type { OrderContext } from "@/lib/automation/completeness";

function decryptAccessToken(encrypted: string): string {
  try {
    return decrypt(deserializeEncrypted(encrypted));
  } catch (err) {
    console.error(
      "[buildPack] Failed to decrypt access token:",
      err instanceof Error ? err.message : String(err),
    );
    // Fall back to raw string — will likely 401 at Shopify
    return encrypted;
  }
}

/**
 * Machine-readable failure codes. Used by the merchant UI to map to
 * safe copy. The internal `failure_reason` (full error text) is kept
 * server-side and never rendered to merchants.
 */
export type PackFailureCode =
  | "order_fetch_failed";

export interface BuildResult {
  packId: string;
  status: "ready" | "failed";
  completenessScore: number;
  blockers: string[];
  sectionsCollected: number;
  itemsCreated: number;
  failureCode: PackFailureCode | null;
}

export async function buildPack(
  packId: string,
  opts?: { correlationId?: string }
): Promise<BuildResult> {
  const sb = getServiceClient();

  // Load pack → dispute → shop + session
  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, pack_template_id")
    .eq("id", packId)
    .single();
  if (packErr || !pack) throw new Error(`Pack not found: ${packId}`);

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, reason, order_gid, dispute_gid, amount")
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

  // Fetch the order once and share it across all three
  // order-dependent collectors (orderSource, fulfillmentSource,
  // customerCommSource). Before this, each collector was issuing the
  // same ORDER_DETAIL_QUERY independently — three round-trips per
  // pack build. Cache happens at the shared-context level.
  //
  // If this fetch fails, capture the structured error so the build
  // record self-explains: collectors silently returning [] on null
  // ctx.order is the most common cause of "score 0% / 1 item / pack
  // blocked" pack states. Without this, the actual error lives only
  // in console.warn and is lost when Vercel runtime logs roll over.
  let order: OrderDetailNode | null = null;
  let orderFetchError: { message: string; durationMs: number; gid: string } | null = null;
  // 2026-05-20 incident regression: if the dispute row landed without
  // order_gid (e.g. a webhook insert that skipped the GraphQL backfill),
  // every order-dependent collector returns [] and the pack ends up at
  // score 0 with no explanation. Record the gap loudly so the audit
  // trail self-explains instead of looking like a normal empty pack.
  if (!dispute.order_gid) {
    orderFetchError = {
      message:
        "dispute.order_gid is null — order-dependent collectors will skip. " +
        "This usually means a webhook insert wasn't backfilled via " +
        "fetchDisputeDetail. See docs/runbooks/webhook-delivery.md.",
      durationMs: 0,
      gid: "",
    };
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: dispute.id,
      packId,
      actorType: "system",
      eventType: "order_gid_null_at_build",
      eventPayload: { dispute_id: dispute.id, pack_id: packId },
    });
  }
  if (dispute.order_gid) {
    const fetchStart = Date.now();
    try {
      const res = await requestShopifyGraphQL<OrderDetailResponse>({
        session: {
          shopDomain: shop.shop_domain,
          accessToken: decryptAccessToken(session.access_token_encrypted),
        },
        query: ORDER_DETAIL_QUERY,
        variables: { id: dispute.order_gid },
        correlationId: opts?.correlationId,
      });
      order = (res.data?.node as OrderDetailNode | undefined) ?? null;
      if (!order) {
        orderFetchError = {
          message: res.errors?.length
            ? `Shopify returned errors: ${res.errors.map((e) => e.message).join("; ")}`
            : "Shopify returned null for order node — order may be deleted or inaccessible",
          durationMs: Date.now() - fetchStart,
          gid: dispute.order_gid,
        };
      }
    } catch (err) {
      orderFetchError = {
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - fetchStart,
        gid: dispute.order_gid,
      };
    }

    if (orderFetchError) {
      console.warn(
        `[buildPack] order fetch failed for pack ${packId} (${orderFetchError.durationMs}ms):`,
        orderFetchError.message,
      );
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: dispute.id,
        packId,
        actorType: "system",
        eventType: "order_fetch_failed",
        eventPayload: orderFetchError,
      });
    }

    // Closes the ingestion gap exposed on dispute 30b00826 / order
    // 6437753061433: risk assessments are populated by the daily
    // orders backfill, but orders created AFTER the last backfill
    // window have no row in `shopify_order_risk_assessments` and
    // therefore can't be cited by fraudRiskSource OR explained
    // honestly to the merchant on the Inclusion Review row.
    //
    // Here, on the per-dispute pack-build path, we already pay a
    // single-order GraphQL fetch — so attaching the `risk { ... }`
    // selection adds zero extra round-trips, just a few extra
    // fields. If the order carries an assessment AND no row already
    // exists for this (shop, order, provider) tuple, we insert one.
    // Idempotent on re-build via the same uniqueness check.
    if (order?.risk && dispute.order_gid) {
      try {
        await persistRiskAssessmentIfMissing({
          sb,
          shopId: pack.shop_id,
          disputeId: dispute.id,
          packId,
          orderGid: dispute.order_gid,
          risk: order.risk,
          createdAt: order.createdAt,
        });
      } catch (err) {
        // The persist step is a side-effect that improves UX on the
        // next regenerate; it must NEVER fail the pack build itself.
        // Swallow any error and continue — the build's primary job
        // (narrative + PDF) is unaffected by a missing risk row.
        console.warn(
          `[buildPack] risk-assessment persist threw for pack ${packId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  const ctx: BuildContext = {
    packId,
    disputeId: dispute.id,
    shopId: pack.shop_id,
    disputeReason: dispute.reason,
    orderGid: dispute.order_gid,
    shopDomain: shop.shop_domain,
    accessToken: decryptAccessToken(session.access_token_encrypted),
    correlationId: opts?.correlationId,
    order,
  };

  // LSE-0: resolve the network reason code (Visa 10.x / 13.x or Mastercard
  // 48xx) now that the order + transaction context is loaded. This populates
  // disputes.network_reason_code for downstream consumers (LSE-1 CE 3.0
  // qualification, LSE-3 FPT readiness, rebuttal-template selection).
  // Non-fatal: a failure here logs but does not block the pack build.
  let resolvedNetworkCode: string | null = null;
  try {
    const enrichResult = await enrichDisputeWithNetworkReasonCode({
      disputeId: dispute.id,
      shopifyReason: dispute.reason,
      order,
    });
    resolvedNetworkCode = enrichResult.result.code;
  } catch (err) {
    console.warn(
      `[buildPack] network reason code enrichment failed for pack ${packId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // LSE-1: evaluate Visa CE 3.0 qualification (auto-qualified / initial-billing /
  // standard branches). Reads the network code we just resolved + the disputed
  // order's 3DS state, and fetches customer priors from Shopify. Persists the
  // verdict to dispute_qualifications. Non-fatal: failure here logs and the
  // pack build continues normally.
  if (resolvedNetworkCode && order && dispute.dispute_gid) {
    try {
      await evaluateQualification({
        disputeId: dispute.id,
        shopId: pack.shop_id,
        shopDomain: shop.shop_domain,
        accessToken: decryptAccessToken(session.access_token_encrypted),
        shopifyDisputeId: dispute.dispute_gid,
        networkReasonCode: resolvedNetworkCode,
        disputedOrder: order,
        correlationId: opts?.correlationId,
      });
    } catch (err) {
      console.warn(
        `[buildPack] CE 3.0 qualification failed for pack ${packId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Run all collectors concurrently
  const results = await Promise.allSettled([
    collectOrderEvidence(ctx),
    collectFulfillmentEvidence(ctx),
    collectPolicyEvidence(ctx),
    collectCustomerCommEvidence(ctx),
    collectGorgiasCommEvidence(ctx),
    collectManualEvidence(ctx),
    collectPaymentEvidence(ctx),
    collectThreeDSecureEvidence(ctx),
    collectFraudRiskEvidence(ctx),
    collectCoverageEvidence(ctx),
    collectDeviceLocationEvidence(ctx),
  ]);

  const allSections: EvidenceSection[] = [];
  const collectorErrors: string[] = [];

  // Surface the upstream order-fetch failure as a collector error so it
  // shows up on the pack record alongside any individual collector throws.
  if (orderFetchError) {
    collectorErrors.push(
      `order_fetch: ${orderFetchError.message} (${orderFetchError.durationMs}ms, gid=${orderFetchError.gid})`,
    );
  }

  for (const r of results) {
    if (r.status === "fulfilled") {
      allSections.push(...r.value);
    } else {
      collectorErrors.push(
        r.reason instanceof Error ? r.reason.message : String(r.reason)
      );
    }
  }

  // Insert evidence_items for each section. Plan §P2.4a — the workspace
  // API normalises category on read by routing through the canonical
  // categorizer (which is the source of truth). We persist
  // `fieldsProvided` inside `payload` so the workspace's
  // `evidenceItemsByField` map can resolve canonical signals back to
  // their evidence item without scanning the array.
  let itemsCreated = 0;
  for (const section of allSections) {
    const labelEn = sectionLabelEn(section);
    const { error: itemErr } = await sb.from("evidence_items").insert({
      pack_id: packId,
      type: section.type,
      label: labelEn,
      source: section.source,
      payload: { ...section.data, fieldsProvided: section.fieldsProvided },
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
          label: labelEn,
          labelToken: section.labelToken,
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

  // When a matching automation rule installed a template on this
  // pack, load its items so the engine scores against admin-defined
  // requirements instead of the hardcoded REASON_TEMPLATES fallback.
  // Items whose collector_key is NULL are merchant-supplied and
  // counted as satisfied by any manual upload (supporting_documents).
  let templateItems: TemplateChecklistItem[] | null = null;
  const templateId = (pack as { pack_template_id?: string | null })
    .pack_template_id;
  if (templateId) {
    const { data: sections } = await sb
      .from("pack_template_sections")
      .select(
        "id, sort, pack_template_items(key, label_default, required, collector_key, sort)",
      )
      .eq("template_id", templateId)
      .order("sort", { ascending: true });
    const items: TemplateChecklistItem[] = [];
    for (const sec of sections ?? []) {
      const raw = (
        sec as {
          pack_template_items?: Array<{
            key: string;
            label_default: string;
            required: boolean;
            collector_key: string | null;
            sort: number;
          }>;
        }
      ).pack_template_items ?? [];
      const sorted = [...raw].sort((a, b) => a.sort - b.sort);
      for (const it of sorted) {
        items.push({
          key: it.key,
          label: it.label_default,
          required: it.required,
          collector_key: it.collector_key,
        });
      }
    }
    if (items.length > 0) templateItems = items;
  }

  // Derive order context for conditional requirement evaluation.
  //
  // hasCardPayment / avsCvvAvailable: a transaction counts as
  // "card-backed" when EITHER (a) its paymentDetails typename is the
  // canonical CardPaymentDetails, OR (b) the union member exposes
  // non-empty `avsResultCode` / `cvvResultCode` at runtime (the
  // presence of those codes IS the proof a card was charged, even on
  // payment-details typenames like ShopPayInstallmentsPaymentDetails
  // that aren't strictly `CardPaymentDetails`). Without (b), conditional
  // fields like AVS/CVV/billing_address_match incorrectly flip to
  // `unavailable` for Shopify Payments orders that wrap a card behind
  // a non-card union member — the workspace UI then renders "no
  // decisive bank-facing evidence" while the PDF, which reads the
  // collector payload directly, cites AVS=Y/CVV=M correctly.
  function transactionExposesCardCodes(t: typeof order extends null ? never : NonNullable<typeof order>["transactions"][number] | undefined): boolean {
    if (!t?.paymentDetails) return false;
    if (t.paymentDetails.__typename === "CardPaymentDetails") return true;
    // Runtime fallback — read the codes regardless of static typing.
    const d = t.paymentDetails as Record<string, unknown>;
    const avs = typeof d.avsResultCode === "string" ? d.avsResultCode : null;
    const cvv = typeof d.cvvResultCode === "string" ? d.cvvResultCode : null;
    return (avs != null && avs !== "") || (cvv != null && cvv !== "");
  }

  const isFulfilled =
    order?.displayFulfillmentStatus !== "UNFULFILLED" &&
    (order?.fulfillments?.length ?? 0) > 0;
  const hasCardPayment =
    order?.transactions?.some(transactionExposesCardCodes) ?? false;
  // AVS/CVV is only "available" if the transaction actually returned codes.
  // External gateways (Stripe via Shopify, Adyen, etc.) often return null
  // even for card payments — this must NOT block or penalize the pack.
  const avsCvvAvailable =
    order?.transactions?.some((t) => {
      if (!transactionExposesCardCodes(t)) return false;
      const d = t.paymentDetails as Record<string, unknown> | null;
      const avs = typeof d?.avsResultCode === "string" ? d.avsResultCode : null;
      const cvv = typeof d?.cvvResultCode === "string" ? d.cvvResultCode : null;
      return (avs != null && avs !== "") || (cvv != null && cvv !== "");
    }) ?? false;
  // Has at least one fulfillment record carrying tracking — used to
  // distinguish "Order is unfulfilled" from "Awaiting delivery
  // confirmation" when the order ships but Shopify hasn't moved
  // displayFulfillmentStatus off UNFULFILLED yet (partial shipments,
  // 3PL handoffs, etc.). The collector emits `shipping_tracking` for
  // exactly this condition.
  const hasShippingEvidence =
    order?.fulfillments?.some((f) =>
      f.trackingInfo?.some((t) => t.number || t.url),
    ) ?? false;
  const orderContext: OrderContext = {
    isFulfilled,
    hasCardPayment,
    avsCvvAvailable,
    hasShippingEvidence,
  };

  const completeness = evaluateCompleteness(
    dispute.reason,
    collectedFields,
    templateItems,
    orderContext,
  );

  // V2 evaluation: preserves any waived items from the pack row
  const { data: existingPack } = await sb
    .from("evidence_packs")
    .select("waived_items")
    .eq("id", packId)
    .single();
  const waivedItems = (existingPack?.waived_items ?? []) as import("@/lib/types/evidenceItem").WaivedItemRecord[];

  const completenessV2Raw = evaluateCompletenessV2(
    dispute.reason,
    collectedFields,
    waivedItems,
    templateItems,
    orderContext,
  );

  // Reconcile checklist status with the fields the collectors actually
  // produced. Without this, a template path can leave a row as
  // `missing` for a field that is present in `pack_json.sections[*].fieldsProvided`
  // (e.g. policies, ip_location_check). The Evidence coverage buckets
  // and the Overview's "Evidence collected" panel must reflect what
  // was collected, not stale template-driven status.
  const reconciledChecklist = reconcileChecklistWithCollectedFields(
    completenessV2Raw.checklist,
    collectedFields,
  );
  const reconciledMetrics = deriveCompletenessMetrics(reconciledChecklist);
  const completenessV2 = {
    checklist: reconciledChecklist,
    ...reconciledMetrics,
  };

  // Pack status reflects whether the build itself succeeded as a
  // *system operation*, not whether it has enough evidence:
  //   - failed → upstream/system error (e.g., couldn't load the order
  //     from Shopify). Evidence-gap UI is misleading here.
  //   - ready → build completed; submission_readiness encodes whether
  //     evidence is sufficient to submit.
  const packStatus: "ready" | "failed" = orderFetchError ? "failed" : "ready";
  const failureCode: PackFailureCode | null = orderFetchError ? "order_fetch_failed" : null;
  const failureReason: string | null = orderFetchError ? orderFetchError.message : null;

  // Flat summary of the Device & Location Consistency section, surfaced
  // as `pack_json.device_location` so portal UI and audit events can read
  // it without traversing `sections`. The full data still lives on the
  // corresponding section inside `sections`.
  // Accept both new (`ip_location_check`) and legacy (`device_location_consistency`)
  // keys so an in-progress build picks up either collector output.
  const deviceLocSection = allSections.find((s) =>
    s.fieldsProvided.includes("ip_location_check") ||
    s.fieldsProvided.includes("device_location_consistency"),
  );
  const deviceLocSummary = deviceLocSection
    ? {
        score: deviceLocSection.data.score,
        locationMatch: deviceLocSection.data.locationMatch,
        riskLevel: deviceLocSection.data.riskLevel,
        ipConsistencyLevel: deviceLocSection.data.ipConsistencyLevel,
        ipReuseCount: deviceLocSection.data.ipReuseCount,
        bankEligible: deviceLocSection.data.bankEligible,
      }
    : null;

  // Coverage summary — Shopify Protect / Coverage Gate (PRD §4).
  // Surfaced at the top of `pack_json` so the pipeline can short-circuit
  // auto-save and the workspace API can flip the hero into the "Covered"
  // state without re-walking sections.
  const coverageSummary: CoverageSummary = summarizeCoverage(order);

  // Fatal-loss summary — PRD §3 step 2 / §5. Detects structurally
  // unwinnable cases (refund issued, INR with no fulfillment) so the
  // pipeline can refuse auto-submission and the case-strength engine
  // can cap overall at "weak" with a fatal-loss explanation. Pure
  // function over the already-fetched order + dispute context.
  const disputeAmountNum =
    typeof dispute.amount === "number"
      ? dispute.amount
      : dispute.amount != null
        ? Number(dispute.amount)
        : null;
  const fatalLossSummary: FatalLossSummary = detectFatalLoss(
    order,
    dispute.reason,
    Number.isFinite(disputeAmountNum) ? (disputeAmountNum as number) : null,
  );

  // Risk-weakness summary — fraud-risk Phase 2. Caps overall at
  // "moderate" when Shopify flagged the order as HIGH risk pre-auth
  // but the merchant fulfilled anyway. Diagnostics only; never cited
  // in bank-rebuttal text, evidence PDF, or Shopify mutations.
  //
  // Reads the persisted snapshot from `shopify_orders` (populated by
  // the orders backfill ingestion — no new Shopify call). A null/
  // missing row simply means no signal; the gate cannot trigger.
  //
  // Pass the live fulfillment count as a hint — loadRiskWeakness will
  // fall back to the persisted shopify_orders.fulfillment_status /
  // fulfilled_at when the live order fetch failed, so the gate still
  // fires correctly during a Shopify outage.
  const riskWeaknessSummary: RiskWeaknessSummary = await loadRiskWeakness({
    sb,
    shopId: pack.shop_id,
    orderGid: dispute.order_gid,
    disputeReason: dispute.reason,
    liveFulfillmentCount: order?.fulfillments?.length ?? null,
  });

  // Case-strength summary — PRD §6 + §9. Computed server-side here so
  // `evaluateAndMaybeAutoSave` can gate auto-mode on strength without
  // re-loading the argument map (the UI hook still computes its own
  // for the supportedClaims/totalClaims diagnostics, which need the
  // argumentMap). Per PRD §9: auto + strong → auto-submit;
  // auto + moderate → review; auto + weak → block.
  //
  // We pass `null` for `argumentMap` because it is not loaded in the
  // build path. That collapses `supportedClaims/totalClaims` to 0 here,
  // but those counters are diagnostic only — the gate uses `overall`,
  // and `overall` is independent of the argument map (it depends on
  // checklist + payloads + reason + coverage + fatalLoss).
  const caseStrengthPayloadSource = {
    kind: "list" as const,
    items: allSections.map((s) => ({
      payload: { ...s.data, fieldsProvided: s.fieldsProvided } as
        & { fieldsProvided?: string[] }
        & Record<string, unknown>,
    })),
  };
  const caseStrengthForGate = calculateCaseStrength(
    reconciledChecklist,
    dispute.reason,
    caseStrengthPayloadSource,
    {
      state: coverageSummary.state,
      shopifyProtectStatus: coverageSummary.shopifyProtectStatus,
    },
    fatalLossSummary,
    riskWeaknessSummary,
  );
  const caseStrengthSummary: {
    overall: CaseStrengthLevel;
    strongCount: number;
    moderateCount: number;
    supportingCount: number;
  } = {
    overall: caseStrengthForGate.overall,
    strongCount: caseStrengthForGate.strongCount,
    moderateCount: caseStrengthForGate.moderateCount,
    supportingCount: caseStrengthForGate.supportingCount,
  };

  // Build the pack_json
  const packJson = {
    version: 1,
    generatedAt: new Date().toISOString(),
    disputeGid: dispute.dispute_gid,
    disputeReason: dispute.reason,
    sections: allSections.map((s) => ({
      type: s.type,
      labelToken: s.labelToken,
      // Legacy English `label` is written alongside `labelToken` so
      // pre-Phase-4 consumers (analytics queries, the defence pipeline,
      // SQL dashboards) continue to read meaningful text without a
      // migration. New code reads `labelToken` via
      // `lib/packs/sectionLabel.ts`.
      label: sectionLabelEn(s),
      source: s.source,
      fieldsProvided: s.fieldsProvided,
      data: s.data,
    })),
    completeness: {
      score: completeness.score,
      evidenceStrengthScore: completeness.evidenceStrengthScore,
      checklist: completeness.checklist,
      blockers: completeness.blockers,
      recommended_actions: completeness.recommended_actions,
    },
    device_location: deviceLocSummary,
    coverage: coverageSummary,
    case_strength: caseStrengthSummary,
    fatal_loss: fatalLossSummary,
    risk_weakness: riskWeaknessSummary,
    collectorErrors: collectorErrors.length > 0 ? collectorErrors : undefined,
  };

  // Update the pack row (dual-write: v1 checklist + v2 checklist).
  // failure_code/failure_reason are written every time so a successful
  // rebuild after a failure clears the prior failure markers.
  //
  // INVARIANT: evidence-derived fields (completeness_score, checklist,
  // blockers, recommended_actions, checklist_v2, submission_readiness)
  // are meaningful ONLY when status === "ready". When the build failed
  // as a system operation, we must null these out — otherwise stale or
  // partial values can flow to UIs and auto-save gates and make a
  // failed pack look actionable.
  const isFailed = packStatus === "failed";
  // P0 fix (2026-05-15): submission_readiness is NOT NULL with a check
  // constraint of {ready, ready_with_warnings, blocked, submitted}.
  // Writing null on failed builds silently errored (supabase-js does
  // not throw on update() — it returns { error } we weren't checking),
  // which left failed packs stuck at status='building' with no
  // pack_json. "blocked" is the semantically correct value for a pack
  // that cannot be submitted because the build itself failed.
  //
  // We also now check the update's error result so future schema drifts
  // surface immediately instead of silently dropping pack state.
  //
  // last_rebuild_* clearing: a successful build invalidates the prior
  // rebuild-outcome verdict — the prior outcome described a save attempt
  // against stale data. The downstream auto-save pipeline
  // (evaluateAndMaybeAutoSave in lib/automation/pipeline.ts) re-stamps
  // with the new verdict if a save attempt fires. When no save attempt
  // runs (manual builds, admin reruns), the columns stay null instead of
  // surfacing a stale "Defense package rebuilt — not re-saved" banner
  // that contradicts the fresh case_strength.
  const clearedRebuildColumns = !isFailed
    ? {
        last_rebuild_outcome: null,
        last_rebuild_at: null,
        last_rebuild_reason: null,
      }
    : {};
  const { error: packUpdateErr } = await sb
    .from("evidence_packs")
    .update({
      status: packStatus as string,
      pack_json: packJson,
      completeness_score: isFailed ? 0 : completenessV2.completenessScore,
      checklist: isFailed ? null : completenessV2.legacyChecklist,
      blockers: isFailed ? null : completenessV2.legacyBlockers,
      recommended_actions: isFailed ? null : completenessV2.legacyRecommendedActions,
      checklist_v2: isFailed ? null : completenessV2.checklist,
      submission_readiness: isFailed
        ? "blocked"
        : completenessV2.submissionReadiness,
      failure_code: failureCode,
      failure_reason: failureReason,
      ...clearedRebuildColumns,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);
  if (packUpdateErr) {
    console.error(
      `[buildPack] terminal pack update failed for ${packId}:`,
      packUpdateErr.message,
    );
    throw new Error(
      `Failed to persist pack ${packId} terminal state: ${packUpdateErr.message}`,
    );
  }

  // Return v2 score + blockers so downstream consumers (buildPackJob
  // audit events + activity feed) show the same number as the DB column
  // and the auto-save gate. The legacy v1 engine is still computed above
  // for dual-write parity, but its score/blockers must never leak to the
  // merchant-facing activity feed alongside v2's different numbers.
  return {
    packId,
    status: packStatus,
    completenessScore: isFailed ? 0 : completenessV2.completenessScore,
    blockers: isFailed ? [] : completenessV2.legacyBlockers,
    sectionsCollected: allSections.length,
    itemsCreated,
    failureCode,
  };
}

/**
 * Load the persisted risk snapshot for the order and evaluate the
 * risk-weakness gate. Read failures and missing rows produce a
 * not-triggered summary — the cap can never fire without data, by
 * design. The Phase 1 collector follows the same posture for the
 * positive-signal path.
 *
 * Fulfillment-count derivation order:
 *   1. Live count from the Shopify order fetch (most accurate when present).
 *   2. Persisted snapshot: fulfilled_at IS NOT NULL OR
 *      fulfillment_status = 'FULFILLED' → count = 1 (we only need ≥ 1
 *      for the gate). This is the resilience path for Shopify hiccups
 *      that fail the live fetch but leave the snapshot intact.
 *   3. Fallback to 0 (cap will not trigger).
 *
 * The point of this fallback: when Shopify has a transient 5xx, the
 * cap should still fire on a HIGH-risk fulfilled fraud dispute — we
 * have every input we need from Supabase already.
 */
async function loadRiskWeakness(args: {
  sb: ReturnType<typeof getServiceClient>;
  shopId: string;
  orderGid: string | null;
  disputeReason: string | null;
  /** Live fulfillment count from the Shopify order fetch. Null when
   *  the fetch failed or the order has no fulfillments. */
  liveFulfillmentCount: number | null;
}): Promise<RiskWeaknessSummary> {
  const { sb, shopId, orderGid, disputeReason, liveFulfillmentCount } = args;

  // No order → no snapshot → cannot evaluate. Return diagnostics-empty
  // not-triggered so pack_json still has the field for shape stability.
  if (!orderGid) {
    return detectRiskWeakness({
      disputeReason,
      riskLevelInitial: null,
      riskRecommendationInitial: null,
      fulfillmentCount: liveFulfillmentCount ?? 0,
    });
  }

  const { data: row, error } = await sb
    .from("shopify_orders")
    .select(
      "risk_level_initial, risk_recommendation_initial, fulfillment_status, fulfilled_at",
    )
    .eq("shop_id", shopId)
    .eq("shopify_order_id", orderGid)
    .maybeSingle();

  if (error) {
    console.warn(
      `[buildPack] risk-weakness snapshot read failed for order ${orderGid}:`,
      error.message,
    );
    return detectRiskWeakness({
      disputeReason,
      riskLevelInitial: null,
      riskRecommendationInitial: null,
      fulfillmentCount: liveFulfillmentCount ?? 0,
    });
  }

  // Derive fulfillmentCount with resilience to Shopify-fetch failures.
  const snapshotIndicatesFulfilled =
    (row?.fulfillment_status as string | null)?.toUpperCase() === "FULFILLED" ||
    row?.fulfilled_at != null;
  const resolvedFulfillmentCount =
    liveFulfillmentCount != null && liveFulfillmentCount > 0
      ? liveFulfillmentCount
      : snapshotIndicatesFulfilled
        ? 1
        : (liveFulfillmentCount ?? 0);

  return detectRiskWeakness({
    disputeReason,
    riskLevelInitial: (row?.risk_level_initial as string | null) ?? null,
    riskRecommendationInitial:
      (row?.risk_recommendation_initial as string | null) ?? null,
    fulfillmentCount: resolvedFulfillmentCount,
  });
}

/* ── Risk-assessment ingestion (per-pack fallback) ─────────────────── */

/**
 * Persist a `shopify_order_risk_assessments` row when the pack-build
 * order fetch returns risk data AND no row already exists for this
 * (shop, order, provider). Closes the ingestion gap for orders that
 * are created AFTER the last backfill window — the merchant's
 * Inclusion Review row would otherwise stay stuck at the "Shopify
 * did not return a qualifying pre-authorization risk assessment for
 * this order" message even though the data IS available on Shopify.
 *
 * Conservative behaviour:
 *
 *   - One provider per call. We pick the first Shopify assessment
 *     (or "shopify" as a fallback provider when the provider title
 *     is null, matching what `normalizeBackfillOrder` does for the
 *     batch backfill writer).
 *   - Skip when the assessment carries no useful signal
 *     (no riskLevel AND no facts).
 *   - Skip when a row already exists for (shop, order, provider) —
 *     existence check, not value diff. The backfill is append-only
 *     and inserts a fresh snapshot_at each pass; we don't want to
 *     create snapshots that nobody asked for on every regenerate.
 *   - All failures are silent (warn + audit). Never throws — the
 *     pack build must not fail because we couldn't write a risk
 *     row.
 */
async function persistRiskAssessmentIfMissing(args: {
  sb: ReturnType<typeof getServiceClient>;
  shopId: string;
  disputeId: string;
  packId: string;
  orderGid: string;
  risk: NonNullable<OrderDetailNode["risk"]>;
  createdAt: string;
}): Promise<void> {
  const { sb, shopId, disputeId, packId, orderGid, risk, createdAt } = args;
  const assessments = risk.assessments ?? [];
  if (assessments.length === 0) return;

  // Pick the first assessment that carries any signal. Mirror
  // `normalizeBackfillOrder` filter: `riskLevel != null || facts.length > 0`.
  const pick = assessments.find(
    (a) => a.riskLevel != null || (a.facts?.length ?? 0) > 0,
  );
  if (!pick) return;

  const provider = pick.provider?.title?.trim() || "shopify";

  // Existence check on (shop, order, provider). Don't add yet another
  // row if backfill (or a prior pack-build pass) already wrote one —
  // fraudRiskSource picks the Shopify-provider row regardless of
  // snapshot_at.
  const { data: existing, error: lookupErr } = await sb
    .from("shopify_order_risk_assessments")
    .select("id")
    .eq("shop_id", shopId)
    .eq("shopify_order_id", orderGid)
    .eq("provider", provider)
    .limit(1);
  if (lookupErr) {
    console.warn(
      `[buildPack] risk-assessment lookup failed for ${orderGid}:`,
      lookupErr.message,
    );
    return;
  }
  if (existing && existing.length > 0) return;

  const row = {
    shop_id: shopId,
    shopify_order_id: orderGid,
    provider,
    risk_level: pick.riskLevel ?? null,
    recommendation: risk.recommendation ?? null,
    facts_json: pick.facts ?? null,
    assessed_at: createdAt,
  };
  const { error: insertErr } = await sb
    .from("shopify_order_risk_assessments")
    .insert(row);
  if (insertErr) {
    console.warn(
      `[buildPack] risk-assessment insert failed for ${orderGid}:`,
      insertErr.message,
    );
    return;
  }
  await logAuditEvent({
    shopId,
    disputeId,
    packId,
    actorType: "system",
    eventType: "risk_assessment_persisted",
    eventPayload: {
      orderGid,
      provider,
      riskLevel: pick.riskLevel,
      recommendation: risk.recommendation,
      factCount: pick.facts?.length ?? 0,
    },
  });
}
