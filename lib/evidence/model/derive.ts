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
import { isUnciteableThreeDsFact } from "@/lib/defence/factClassifier";
import type { WaivedItemRecord } from "@/lib/types/evidenceItem";
import { definitionFor, DEFINITION_REGISTRY_VERSION } from "./definitions";
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
    if (fieldKey === "fraud_risk_screening") {
      const positives = payload?.positiveFacts;
      return Array.isArray(positives) && positives.length > 0
        ? { eligibility: "eligible", reasonToken: null }
        : { eligibility: "ineligible", reasonToken: null };
    }
  }

  return { eligibility: "eligible", reasonToken: null };
}

function makeRecord(args: {
  fieldKey: EvidenceFieldKey;
  payload: Record<string, unknown> | null;
  source: string | null | undefined;
  evidenceItemId: string | null;
  collectedAt: string | null;
}): CaseEvidenceRecord {
  const { fieldKey, payload, source, evidenceItemId, collectedAt } = args;
  const legacy = categorizeEvidenceField(fieldKey, payload);
  const { validity, quality } = fromLegacyCategory(legacy);
  const isValid = validity === "valid";

  // Stable identity: the DB row when we have one, else the collector that
  // produced it. Never positional — `EvidenceFact.id` is `f${index}` today,
  // so it changes on every rebuild and nothing can reference it.
  const sourceKey = evidenceItemId ?? source ?? "unknown";

  return {
    recordId: `${fieldKey}#${sourceKey}`,
    fieldKey,
    provenance: {
      origin: originFor(source),
      sourceSystemId: null,
      evidenceItemId,
      collectedAt,
      supersedes: null,
    },
    validity: { state: validity, reasonToken: null },
    quality: isValid ? quality : null,
    citation: citationFor(fieldKey, payload, isValid),
  };
}

/** How many instances a section nests, so the collapse is measurable. */
function nestedInstanceCount(payload: Record<string, unknown> | null): number {
  if (!payload) return 1;
  for (const key of ["fulfillments", "conversations", "uploads"]) {
    const v = payload[key];
    if (Array.isArray(v) && v.length > 0) return v.length;
  }
  const n = payload.messageCount;
  if (typeof n === "number" && n > 0) return n;
  return 1;
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

  const push = (field: string, rec: CaseEvidenceRecord, nested: number) => {
    if (!isEvidenceField(field)) return;
    const list = recordsByField.get(field) ?? [];
    // One record per (source × field) in P1 — dedup on the stable id so a
    // section and its mirrored evidence_item do not double-count.
    if (!list.some((r) => r.recordId === rec.recordId)) list.push(rec);
    recordsByField.set(field, list);
    const prev = collapsed[field] ?? { nested: 0, emitted: 0 };
    collapsed[field] = { nested: prev.nested + nested, emitted: list.length };
  };

  for (const section of sections) {
    const fields = section.fieldsProvided ?? [];
    seenFields.push(...fields);
    const nested = nestedInstanceCount(section.data ?? null);
    for (const field of fields) {
      if (!isEvidenceField(field)) continue;
      push(
        field,
        makeRecord({
          fieldKey: field,
          payload: section.data ?? null,
          source: section.source,
          evidenceItemId: null,
          collectedAt: null,
        }),
        nested,
      );
    }
  }

  for (const item of evidenceItems) {
    const payload = item.payload ?? null;
    const fields = [
      ...((payload?.fieldsProvided as string[] | undefined) ?? []),
      ...(typeof payload?.checklistField === "string" ? [payload.checklistField] : []),
    ];
    seenFields.push(...fields);
    for (const field of fields) {
      if (!isEvidenceField(field)) continue;
      push(
        field,
        makeRecord({
          fieldKey: field,
          payload,
          source: item.source,
          evidenceItemId: item.id ?? null,
          collectedAt: item.created_at ?? null,
        }),
        nestedInstanceCount(payload),
      );
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

    fields[fieldKey] = {
      fieldKey,
      relevance,
      records,
      representativeId: representative?.recordId ?? null,
      citableIds: records
        .filter((r) => r.citation.eligibility === "eligible")
        .map((r) => r.recordId),
      status: {
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
