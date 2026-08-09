/**
 * `deriveCaseEvidenceModel` — the single derivation of "what evidence exists".
 *
 * Pure. No I/O, no policy, no thresholds. Scoring lives in `CaseAssessment`
 * and automation in `CaseAutomationDecision`, each with its own policy
 * version, so changing a threshold cannot change this model's meaning.
 *
 * P1 SCOPE — shadow only. Nothing consumes this yet. It reproduces today's
 * answers (seeded per the authority rules in the plan §6b) so the
 * characterization tests can pin current behaviour and the divergence
 * manifest can be trusted.
 *
 * KNOWN P1 LIMITATION, deliberately not fixed here: collectors emit ONE
 * section per field with instances nested inside it (`data.fulfillments[]`,
 * `data.conversations[]`), so this derivation currently produces one record
 * per (section × field) — today's granularity. Splitting nested instances
 * into real records needs the typed payloads that land in P2a. The prod
 * survey (scripts/sql/evidence-model-cardinality-survey.sql) measured the
 * cost: 74/74 disputed orders have a single fulfillment, but one comms
 * section carries messageCount=3 and one Gorgias section carries 2
 * conversations. `recordsCollapsed` records the shortfall per field so the
 * loss is visible rather than silent — which is the whole point.
 */

import { createHash } from "crypto";
import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import {
  isUnciteablePaymentVerificationFact,
  isUnciteableThreeDsFact,
} from "@/lib/defence/factClassifier";
import type { WaivedItemRecord } from "@/lib/types/evidenceItem";
import {
  definitionFor,
  DEFINITION_REGISTRY_VERSION,
  requirementModeFor,
} from "./definitions";
import { resolveRequirement, type OrderContext } from "@/lib/automation/completeness";
import {
  instanceCount,
  normalizeEvidencePayload,
  type EvidencePayload,
} from "./payloads";
import {
  retiredFieldKeysIn,
  retiredPayloadKeysIn,
  stripRetiredPayloadKeys,
} from "./retiredKeys";
import {
  EVIDENCE_FIELD_KEYS,
  domainOf,
  isEvidenceField,
  unregisteredCollectorFields,
  type EvidenceFieldKey,
} from "./domains";
import {
  MODEL_VERSION,
  type CaseEvidenceModel,
  type CaseEvidenceRecord,
  type EvidenceOrigin,
  type FieldEvidenceSummary,
} from "./types";
import {
  QUALITY_RANK,
  fromLegacyCategory,
  type CitationState,
  type EvidenceQuality,
} from "./vocabulary";

export interface SectionLike {
  source?: string | null;
  fieldsProvided?: string[] | null;
  data?: Record<string, unknown> | null;
}

export interface EvidenceItemLike {
  id?: string | null;
  source?: string | null;
  created_at?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface DeriveCaseEvidenceModelInput {
  disputeId: string;
  reason: string | null;
  packId?: string | null;
  sections?: SectionLike[] | null;
  evidenceItems?: EvidenceItemLike[] | null;
  waivedItems?: WaivedItemRecord[] | null;
  inclusionOverrides?: Record<string, "force_include" | "force_exclude"> | null;
  coverage?: { state?: string | null; shopifyProtectStatus?: string | null } | null;
  networkReasonCode?: string | null;
  /**
   * Order facts that decide whether a field CAN exist here (fulfilled, card
   * payment, refunded). Omitted ⇒ everything is treated as applicable, which
   * matches a model derived without order access; callers that have the
   * context must pass it or completeness will read ~30 points low.
   */
  orderContext?: OrderContext | null;
}

/** Collector `source` strings → the typed provenance origin. */
function originFor(source: string | null | undefined): EvidenceOrigin {
  switch (source) {
    case "shopify_fulfillments":
      return "shopify_fulfillment";
    case "shopify_transactions":
      return "gateway_receipt";
    case "shopify_policy":
    case "policy_snapshots":
      return "shopify_policy";
    case "gorgias":
      return "gorgias";
    case "manual_upload":
      return "merchant_upload";
    case "ipinfo":
      return "ipinfo";
    default:
      return "shopify_order";
  }
}

/**
 * Citation eligibility for one record. The `conditional` arms delegate to the
 * SAME predicates the bank filter uses — `isUnciteableThreeDsFact` is
 * imported from the classifier rather than restated, and the IP / fraud gates
 * read the flags their own collectors pre-computed. A second copy here is
 * precisely the duplication this model removes.
 */
function citationFor(
  fieldKey: EvidenceFieldKey,
  payload: Record<string, unknown> | null,
  isValid: boolean,
): CitationState {
  const policy = definitionFor(fieldKey).citationPolicy;

  if (policy === "never") {
    return {
      eligibility: "withheld_internal",
      reasonToken: { key: "disputes.citation.withheldInternal" },
    };
  }

  if (!isValid) return { eligibility: "ineligible", reasonToken: null };

  if (policy === "conditional") {
    if (fieldKey === "tds_authentication") {
      return isUnciteableThreeDsFact(fieldKey, payload as never)
        ? {
            eligibility: "withheld_risk",
            reasonToken: { key: "disputes.citation.threeDsNoLiabilityShift" },
          }
        : { eligibility: "eligible", reasonToken: null };
    }
    if (fieldKey === "ip_location_check") {
      // `deviceLocationSource.computeBankEligible` already encodes the whole
      // gate (same city/country, no VPN/proxy/hosting, consistent history).
      return payload?.bankEligible === true
        ? { eligibility: "eligible", reasonToken: null }
        : {
            eligibility: "withheld_risk",
            reasonToken: { key: "disputes.citation.ipNotBankEligible" },
          };
    }
    if (fieldKey === "avs_cvv_match") {
      // PR-C2 decision 1 — same predicate the bank filter uses, imported
      // rather than restated.
      return isUnciteablePaymentVerificationFact(fieldKey, payload)
        ? {
            eligibility: "withheld_risk",
            reasonToken: { key: "disputes.citation.cvvOnlyNotAddressEvidence" },
          }
        : { eligibility: "eligible", reasonToken: null };
    }
    if (fieldKey === "fraud_risk_screening") {
      const positives = payload?.positiveFacts;
      return Array.isArray(positives) && positives.length > 0
        ? { eligibility: "eligible", reasonToken: null }
        : { eligibility: "ineligible", reasonToken: null };
    }
  }

  return { eligibility: "eligible", reasonToken: null };
}

/**
 * Per-instance identity, so a record id survives a rebuild AND distinguishes
 * parcel A from parcel B. Falls back to the ordinal only when the upstream
 * system gave us nothing — an ordinal is still stable for a fixed payload,
 * unlike `EvidenceFact.id`, which is assigned by cross-section iteration
 * order and shifts whenever any earlier section changes.
 */
function instanceKey(
  payload: EvidencePayload | null,
  index: number,
  fallback: string,
): string {
  if (payload) {
    switch (payload.fieldKey) {
      case "delivery_proof":
      case "shipping_tracking": {
        const f = payload.fulfillments[index];
        if (f?.fulfillmentId) return f.fulfillmentId;
        if (f?.tracking[0]?.number) return f.tracking[0].number;
        break;
      }
      case "customer_communication": {
        const c = payload.conversations[index];
        if (c?.conversationId) return c.conversationId;
        break;
      }
      case "supporting_documents":
      case "product_description": {
        const u = payload.uploads[index];
        if (u?.evidenceItemId) return u.evidenceItemId;
        if (u?.storagePath) return u.storagePath;
        break;
      }
      default:
        break;
    }
  }
  return index === 0 ? fallback : `${fallback}:${index}`;
}

/**
 * One record per real instance. A two-parcel shipment yields two records; a
 * Gorgias thread with two conversations yields two.
 *
 * Validity and quality come from the SECTION payload via
 * `categorizeEvidenceField` — the declared authority (R2) — so every instance
 * of one section currently shares a grade. Grading parcels individually
 * changes what a case scores and belongs to P2b with its transition matrix,
 * not to a refactor.
 */
function makeRecords(args: {
  fieldKey: EvidenceFieldKey;
  raw: Record<string, unknown> | null;
  source: string | null | undefined;
  evidenceItemId: string | null;
  collectedAt: string | null;
}): CaseEvidenceRecord[] {
  const { fieldKey, raw: rawInput, source, evidenceItemId, collectedAt } = args;
  // Retired keys are removed BEFORE anything reads the payload, so a
  // historical pack can be derived without its retired values re-entering a
  // category, a grade, a normalized payload, or a citation decision.
  const raw = stripRetiredPayloadKeys(rawInput);
  const legacy = categorizeEvidenceField(fieldKey, raw);
  const { validity, quality } = fromLegacyCategory(legacy);
  const isValid = validity === "valid";
  const payload = normalizeEvidencePayload(fieldKey, raw);
  const citation = citationFor(fieldKey, raw, isValid);
  const fallback = evidenceItemId ?? source ?? "unknown";

  const count =
    definitionFor(fieldKey).cardinality === "multiple" && payload
      ? instanceCount(payload)
      : 1;

  return Array.from({ length: count }, (_, i) => ({
    recordId: `${fieldKey}#${instanceKey(payload, i, fallback)}`,
    fieldKey,
    provenance: {
      origin: originFor(source),
      sourceSystemId: perInstanceSourceId(payload, i),
      evidenceItemId,
      collectedAt,
      supersedes: null,
    },
    validity: { state: validity, reasonToken: null },
    quality: isValid ? quality : null,
    citation,
    payload,
  }));
}

/** Upstream identifier for one instance (Shopify GID, conversation id, path). */
function perInstanceSourceId(
  payload: EvidencePayload | null,
  index: number,
): string | null {
  if (!payload) return null;
  switch (payload.fieldKey) {
    case "delivery_proof":
    case "shipping_tracking":
      return payload.fulfillments[index]?.fulfillmentId ?? null;
    case "customer_communication":
      return payload.conversations[index]?.conversationId ?? null;
    case "supporting_documents":
    case "product_description":
      return payload.uploads[index]?.storagePath ?? null;
    default:
      return null;
  }
}

export interface DeriveResult {
  model: CaseEvidenceModel;
  /**
   * Per field, how many real instances the source nested versus how many
   * records we emitted. Non-zero entries are the P2a work-list; recording it
   * keeps the shortfall visible instead of silently flattened.
   */
  recordsCollapsed: Record<string, { nested: number; emitted: number }>;
}

export function deriveCaseEvidenceModel(
  input: DeriveCaseEvidenceModelInput,
): DeriveResult {
  const sections = input.sections ?? [];
  const evidenceItems = input.evidenceItems ?? [];
  const waiveMap = new Map<string, WaivedItemRecord>(
    (input.waivedItems ?? []).map((w) => [w.field, w]),
  );
  const overrides = input.inclusionOverrides ?? {};

  const recordsByField = new Map<EvidenceFieldKey, CaseEvidenceRecord[]>();
  const collapsed: Record<string, { nested: number; emitted: number }> = {};
  const seenFields: string[] = [];
  /**
   * Retired keys observed on ANY input — payload keys inside `data`, and whole
   * retired FIELD keys in `fieldsProvided`. Reported, never read: neither kind
   * ever becomes a record, a category, a grade, a completeness credit, a
   * citation or an LLM value.
   */
  const retiredSeen = new Set<string>();

  const push = (field: string, recs: CaseEvidenceRecord[], nested: number) => {
    if (!isEvidenceField(field)) return;
    const list = recordsByField.get(field) ?? [];
    // Dedup on the stable id so a section and its mirrored evidence_item do
    // not double-count the same underlying instance.
    for (const rec of recs) {
      if (!list.some((r) => r.recordId === rec.recordId)) list.push(rec);
    }
    recordsByField.set(field, list);
    const prev = collapsed[field] ?? { nested: 0, emitted: 0 };
    collapsed[field] = { nested: prev.nested + nested, emitted: list.length };
  };

  for (const section of sections) {
    const fields = section.fieldsProvided ?? [];
    seenFields.push(...fields);
    for (const k of retiredPayloadKeysIn(section.data ?? null)) retiredSeen.add(k);
    for (const k of retiredFieldKeysIn(fields)) retiredSeen.add(k);
    for (const field of fields) {
      // A retired field key is not an evidence field, so this `continue` is
      // what stops it — but it is recorded above first, so a historical pack
      // reports it rather than losing it.
      if (!isEvidenceField(field)) continue;
      const recs = makeRecords({
        fieldKey: field,
        raw: section.data ?? null,
        source: section.source,
        evidenceItemId: null,
        collectedAt: null,
      });
      push(field, recs, recs.length);
    }
  }

  for (const item of evidenceItems) {
    const payload = item.payload ?? null;
    for (const k of retiredPayloadKeysIn(payload)) retiredSeen.add(k);
    const fields = [
      ...((payload?.fieldsProvided as string[] | undefined) ?? []),
      ...(typeof payload?.checklistField === "string" ? [payload.checklistField] : []),
    ];
    seenFields.push(...fields);
    for (const k of retiredFieldKeysIn(fields)) retiredSeen.add(k);
    for (const field of fields) {
      if (!isEvidenceField(field)) continue;
      const recs = makeRecords({
        fieldKey: field,
        raw: payload,
        source: item.source,
        evidenceItemId: item.id ?? null,
        collectedAt: item.created_at ?? null,
      });
      push(field, recs, recs.length);
    }
  }

  // Every registered evidence field gets an entry, present or not. Membership
  // carries no meaning — that is the whole correction. A field with nothing
  // collected is an empty `records` array with explicit status flags, not an
  // absence that later code has to interpret.
  const fields = {} as Record<EvidenceFieldKey, FieldEvidenceSummary>;
  for (const fieldKey of EVIDENCE_FIELD_KEYS) {
    const def = definitionFor(fieldKey);
    const records = recordsByField.get(fieldKey) ?? [];
    const valid = records.filter((r) => r.validity.state === "valid");
    const waived = waiveMap.get(fieldKey) ?? null;
    const relevance = def.relevance(input.reason);

    let quality: EvidenceQuality | null = null;
    for (const r of valid) {
      if (!r.quality) continue;
      if (!quality || QUALITY_RANK[r.quality] > QUALITY_RANK[quality]) {
        quality = r.quality;
      }
    }

    const representative =
      def.aggregation.representative === "most_recent"
        ? [...valid].sort((a, b) =>
            String(b.provenance.collectedAt ?? "").localeCompare(
              String(a.provenance.collectedAt ?? ""),
            ),
          )[0]
        : def.aggregation.representative === "best_quality"
          ? [...valid].sort(
              (a, b) =>
                QUALITY_RANK[b.quality ?? "contextual"] -
                QUALITY_RANK[a.quality ?? "contextual"],
            )[0]
          : valid[0];

    const available = valid.length > 0;

    // Order-applicability, from the SAME rule the completeness engine uses.
    const mode = requirementModeFor(fieldKey, input.reason);
    const applicable =
      !input.orderContext || !mode
        ? true
        : resolveRequirement(mode, input.orderContext).collectable;

    fields[fieldKey] = {
      fieldKey,
      relevance,
      records,
      representativeId: representative?.recordId ?? null,
      citableIds: records
        .filter((r) => r.citation.eligibility === "eligible")
        .map((r) => r.recordId),
      status: {
        applicable,
        // Reads record validity ONLY. Waiving never makes evidence available.
        available,
        required: relevance === "critical",
        waived,
        // Every REASON_TEMPLATES_V2 field is `blocking: false` today; nothing
        // in the evidence model may invent a hard block.
        blocking: false,
        satisfied: available || (waived !== null && !available),
      },
      quality,
      merchantOverride: overrides[fieldKey] ?? null,
    };
  }

  const model: CaseEvidenceModel = {
    modelVersion: MODEL_VERSION,
    definitionRegistryVersion: DEFINITION_REGISTRY_VERSION,
    disputeId: input.disputeId,
    reason: input.reason,
    fields,
    nonEvidence: {
      coverage: input.coverage
        ? {
            state: input.coverage.state ?? null,
            shopifyProtectStatus: input.coverage.shopifyProtectStatus ?? null,
          }
        : null,
      riskSignals: null,
      disputeMetadata: {
        reason: input.reason,
        networkReasonCode: input.networkReasonCode ?? null,
      },
      operational: {
        collectorErrors: [],
        // Reported, never dropped. Today both pipelines `continue` past an
        // unknown key with no record that it existed.
        unregisteredFields: unregisteredCollectorFields(
          seenFields.filter((f) => domainOf(f) !== "coverage"),
        ),
        // Retired keys are recorded here and NOWHERE else in the model. They
        // are not unregistered fields (which would read as an accident) and
        // they never became records.
        retiredFields: [...retiredSeen],
      },
    },
    derivedFrom: {
      packId: input.packId ?? null,
      sectionsHash: createHash("sha1")
        .update(JSON.stringify(sections.map((s) => s.fieldsProvided ?? [])))
        .digest("hex")
        .slice(0, 12),
      evidenceItemIds: evidenceItems
        .map((i) => i.id)
        .filter((id): id is string => typeof id === "string"),
    },
  };

  return { model, recordsCollapsed: collapsed };
}
