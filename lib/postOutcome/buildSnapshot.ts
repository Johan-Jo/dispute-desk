/**
 * Submission-time snapshot builder — plan §7 Stage 1, §23 step 3.
 *
 * Split deliberately in two:
 *
 *   `assembleSnapshot`  pure, synchronous, no I/O. Every classification rule
 *                       lives here and is unit-testable against fixtures.
 *   `loadSnapshotInputs` the only part that touches the database.
 *
 * The split exists because the rules are the risky part and the queries are
 * the boring part. A rule that mistakes a late arrival for an omission is a
 * false accusation against the pipeline; a rule that mistakes a saved package
 * for a forwarded one invents an adjudication that never happened. Those need
 * fixtures, not a live database.
 *
 * ── What "submission time" means here ──
 *
 * `submissionInstant` is the moment the record is reconstructed against, and it
 * is NOT simply "now" or "whenever the package row was written". It is, in
 * order of preference:
 *
 *   1. Shopify's `evidenceSentOn` — when the evidence was actually forwarded.
 *   2. The package's own `submitted_at` — when we handed it to Shopify.
 *
 * Everything that existed at or before that instant is "available"; everything
 * after is "arrived after". Get this wrong by a few hours and approved evidence
 * legitimately captured post-filing becomes a phantom omission.
 */

import {
  computeSnapshotHash,
  SNAPSHOT_CONTRACT_VERSION,
  validateSnapshotContract,
  type PostOutcomeSourceSnapshot,
  type SnapshotAssertion,
  type SnapshotCaseStrength,
  type SnapshotEvidenceItem,
} from "./snapshotContract";
import {
  noConnectorCapabilities,
  providerAccessLevelFor,
  resolveAnalysisLevel,
  shopifyPaymentsCapabilities,
  type AnalysisLevelDecision,
} from "./analysisLevel";
import { isBankIncludedFact } from "@/lib/defence/bankInclusion";
import type {
  AnalyzableOutcome,
  CardNetwork,
  PackageEvidenceTie,
  PaymentProvider,
  SubmissionConfirmationSource,
} from "./taxonomy";

/* ───────────────────────────── Raw input rows ─────────────────────────────── */

export interface RawDisputeRow {
  id: string;
  shop_id: string;
  phase: string | null;
  reason: string | null;
  network_reason_code: string | null;
  amount: string | number | null;
  currency_code: string | null;
  initiated_at: string | null;
  closed_at: string | null;
  final_outcome: string | null;
  outcome_source: string | null;
  submission_state: string | null;
  submitted_at: string | null;
  evidence_saved_to_shopify_at: string | null;
  due_at: string | null;
  dispute_evidence_gid: string | null;
  order_gid: string | null;
  raw_snapshot: Record<string, unknown> | null;
}

export interface RawPackageRow {
  id: string;
  dispute_id: string;
  version: number;
  content_revision: number | null;
  status: string | null;
  submitted_at: string | null;
  generated_at: string | null;
  pdf_path: string | null;
  evidence_hash: string | null;
  prompt_version: string | null;
  validator_version: number | null;
  reason_code_module: string | null;
  facts_json: unknown;
  narrative_json: Record<string, unknown> | null;
  shopify_response: Record<string, unknown> | null;
}

export interface RawGorgiasRow {
  id: string;
  dispute_id: string;
  evidence_category: string | null;
  review_status: string | null;
  approved_at: string | null;
  created_at: string | null;
  sent_at: string | null;
  approved_excerpt: string | null;
}

export interface RawEventRow {
  event_type: string;
  event_at: string;
  description: string | null;
}

export interface SnapshotInputs {
  dispute: RawDisputeRow;
  /** Every submitted package on the dispute — ambiguity is detected, not hidden. */
  submittedPackages: RawPackageRow[];
  gorgias: RawGorgiasRow[];
  events: RawEventRow[];
  /** `shopify_orders.payment_gateway` for the disputed order, when resolvable. */
  paymentGateway: string | null;
  cardNetwork: CardNetwork;
  caseStrengthAtSubmission: SnapshotCaseStrength;
}

export interface SnapshotBuildResult {
  snapshot: PostOutcomeSourceSnapshot;
  hash: string;
  level: AnalysisLevelDecision;
  contractErrors: string[];
}

/* ─────────────────────────────── Derivations ──────────────────────────────── */

/**
 * Provider from the gateway string. `null` gateway means we could not resolve
 * the order, which is UNKNOWN — never silently Shopify Payments just because
 * that is what everything else in prod happens to be.
 */
export function providerFromGateway(gateway: string | null): PaymentProvider {
  if (!gateway) return "UNKNOWN";
  const g = gateway.toLowerCase();
  if (g.includes("shopify_payments") || g === "shopify payments") {
    return "SHOPIFY_PAYMENTS";
  }
  if (g.includes("klarna")) return "KLARNA";
  if (g.includes("paypal")) return "PAYPAL";
  return "OTHER";
}

/** Shopify's own forwarding timestamp, when the snapshot recorded a real one. */
export function evidenceSentOn(dispute: RawDisputeRow): string | null {
  const raw = dispute.raw_snapshot;
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>).evidenceSentOn;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `shopify_response.verified === true` — storage confirmation, nothing more. */
export function platformSaveVerified(pkg: RawPackageRow | null): boolean {
  const response = pkg?.shopify_response;
  if (!response || typeof response !== "object") return false;
  return (response as Record<string, unknown>).verified === true;
}

export function responseEvidenceGid(pkg: RawPackageRow | null): string | null {
  const response = pkg?.shopify_response;
  if (!response || typeof response !== "object") return null;
  const gid = (response as Record<string, unknown>).evidenceGid;
  return typeof gid === "string" ? gid : null;
}

/**
 * Provenance of any forwarding claim.
 *
 * The ordering is the decision of 2026-08-30 in code form. A verified save is
 * reported as `PLATFORM_SAVE_ONLY` — a positive statement that we have storage
 * confirmation and nothing more — rather than falling through to `NONE`, so the
 * admin detail can distinguish "saved, never forwarded" from "we know nothing".
 */
export function resolveConfirmationSource(
  dispute: RawDisputeRow,
  pkg: RawPackageRow | null,
): SubmissionConfirmationSource {
  const sentOn = evidenceSentOn(dispute);
  if (dispute.submission_state === "submitted_confirmed" && sentOn) {
    return "SHOPIFY_EVIDENCE_SENT_ON";
  }
  if (dispute.submission_state === "manual_submission_reported") {
    return "MANUAL_MERCHANT_REPORT";
  }
  if (platformSaveVerified(pkg) || dispute.evidence_saved_to_shopify_at) {
    return "PLATFORM_SAVE_ONLY";
  }
  return "NONE";
}

/**
 * Which package was forwarded, and can we prove it?
 *
 * More than one submitted package means we cannot say which one Shopify
 * actually sent. Guessing "the newest" would be a plausible-sounding fabrication
 * — the whole analysis then hangs off an assumption nobody recorded. Two real
 * prod disputes are in this state.
 */
export function resolvePackageTie(
  dispute: RawDisputeRow,
  packages: RawPackageRow[],
): { tie: PackageEvidenceTie; pkg: RawPackageRow | null } {
  if (packages.length === 0) return { tie: "NONE", pkg: null };
  if (packages.length > 1) {
    return { tie: "AMBIGUOUS_MULTIPLE_PACKAGES", pkg: null };
  }
  const pkg = packages[0];
  const gid = responseEvidenceGid(pkg);
  const tie: PackageEvidenceTie =
    gid && dispute.dispute_evidence_gid && gid === dispute.dispute_evidence_gid
      ? "EVIDENCE_GID_MATCH"
      : "NONE";
  return { tie, pkg };
}

/**
 * The instant the record is reconstructed against. See the module header.
 *
 * `disputes.submitted_at` sits between the two package-independent sources
 * deliberately: it carries the same Shopify provenance as `evidenceSentOn`
 * (measured non-null on exactly the 49 confirmed cases and null on all 4
 * saved-only ones), and it survives when the package is ambiguous. Without it,
 * a multi-package dispute loses its instant entirely and every piece of its
 * evidence falls into `availabilityUnknown` — discarding a date we hold.
 */
export function resolveSubmissionInstant(
  dispute: RawDisputeRow,
  pkg: RawPackageRow | null,
): string | null {
  return evidenceSentOn(dispute) ?? dispute.submitted_at ?? pkg?.submitted_at ?? null;
}

/* ───────────────────────────── Evidence mapping ───────────────────────────── */

interface ParsedFact {
  id: string;
  category: string | null;
  source: string;
  bankEligible: boolean;
  includeInBankNarrative: boolean;
  submissionRisk: boolean;
  internalOnly: boolean;
}

/** Defensive parse — `facts_json` is stored JSON, not a validated type. */
export function parseFacts(factsJson: unknown): ParsedFact[] {
  if (!Array.isArray(factsJson)) return [];
  const out: ParsedFact[] = [];
  for (const raw of factsJson) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    if (typeof f.id !== "string") continue;
    out.push({
      id: f.id,
      category: typeof f.category === "string" ? f.category : null,
      source: typeof f.source === "string" ? f.source : "facts_json",
      bankEligible: f.bankEligible === true,
      includeInBankNarrative: f.includeInBankNarrative === true,
      submissionRisk: f.submissionRisk === true,
      internalOnly: f.internalOnly === true,
    });
  }
  return out;
}

/**
 * Facts carried by the submitted package.
 *
 * These were, by construction, both available before submission and present in
 * the package — they are the package. `inclusionEligible` reflects whether the
 * fact was allowed into bank-facing content: an internal-only fact sitting in
 * `facts_json` was correctly withheld, and must never later be scored as an
 * omission for not appearing in the narrative.
 */
function factsToEvidence(
  facts: ParsedFact[],
  submissionInstant: string | null,
): SnapshotEvidenceItem[] {
  return facts.map((f) => ({
    id: `fact:${f.id}`,
    source: f.source,
    category: f.category,
    availableAt: submissionInstant,
    approvedAt: submissionInstant,
    // THE bank-inclusion predicate, not a fifth spelling of it. An earlier
    // draft wrote `bankEligible && !internalOnly` here, which silently admitted
    // facts carrying submissionRisk — the exact class of divergence
    // lib/defence/bankInclusion.ts exists to prevent (C-1).
    inclusionEligible: isBankIncludedFact(f),
    // "Present" means it reached the ISSUER-FACING content, not merely that it
    // sits in facts_json. An internal-only or submission-risk fact is recorded
    // in the package and deliberately withheld from the bank; calling it
    // present would claim the issuer saw evidence we intentionally held back.
    presentInSubmittedPackage: isBankIncludedFact(f),
  }));
}

/**
 * Gorgias passages, split by when they were approved relative to submission.
 *
 * This is the only place `AVAILABLE_BUT_OMITTED` can originate today, and it is
 * where a careless comparison does the most damage. A passage approved AFTER we
 * filed is not an omission — the pipeline cannot include what did not yet
 * exist. Only 3 of 50 prod disputes have an approved-pre-submission passage, so
 * the rule fires rarely and must be right when it does.
 */
function gorgiasToEvidence(
  rows: RawGorgiasRow[],
  submissionInstant: string | null,
): {
  before: SnapshotEvidenceItem[];
  after: SnapshotEvidenceItem[];
  unknown: SnapshotEvidenceItem[];
} {
  const before: SnapshotEvidenceItem[] = [];
  const after: SnapshotEvidenceItem[] = [];
  const unknown: SnapshotEvidenceItem[] = [];

  for (const row of rows) {
    const approved = row.review_status === "approved";
    const item: SnapshotEvidenceItem = {
      id: `gorgias:${row.id}`,
      source: "gorgias",
      category: row.evidence_category,
      availableAt: row.created_at,
      approvedAt: row.approved_at,
      // Only an approved passage was ever eligible for the package. A pending
      // one absent from the PDF is correct behaviour, not a defect.
      inclusionEligible: approved,
      // Always false, and deliberately so: a passage enters a package as ONE
      // aggregate `customer_communication` fact with `sourceRef: null`, so no
      // per-passage inclusion flag can be derived. Stage 3 reads the absence of
      // a linkage as INCLUSION_UNVERIFIABLE rather than as an omission —
      // claiming inclusion here would be inventing the link.
      presentInSubmittedPackage: false,
    };

    if (!submissionInstant) {
      unknown.push(item);
      continue;
    }
    // Anchor on approval when we have it: an unapproved message existing early
    // is not evidence we could have used.
    const anchor = row.approved_at ?? row.created_at;
    if (!anchor) {
      unknown.push(item);
    } else if (Date.parse(anchor) <= Date.parse(submissionInstant)) {
      before.push(item);
    } else {
      after.push(item);
    }
  }

  return { before, after, unknown };
}

/**
 * Narrative sections become assertions carrying their declared fact references.
 *
 * `usedFactIds` is the package's own claim about what supports each section, so
 * Stage 4 can check the claim rather than infer support from proximity.
 */
export function narrativeToAssertions(
  narrativeJson: Record<string, unknown> | null,
  knownFactIds: ReadonlySet<string>,
): SnapshotAssertion[] {
  if (!narrativeJson) return [];
  const assertions: SnapshotAssertion[] = [];

  for (const [key, value] of Object.entries(narrativeJson)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const section = value as Record<string, unknown>;
    const text = section.text;
    if (typeof text !== "string" || text.trim().length === 0) continue;

    const usedFactIds = Array.isArray(section.usedFactIds)
      ? section.usedFactIds.filter((v): v is string => typeof v === "string")
      : [];

    assertions.push({
      id: `section:${key}`,
      text,
      // Reference only facts the snapshot actually holds. A dangling id is a
      // finding for Stage 4, not a reason to fail contract validation here.
      supportingEvidenceIds: usedFactIds
        .map((id) => `fact:${id}`)
        .filter((id) => knownFactIds.has(id)),
      ruleRef: null,
      presentInSubmittedPdf: true,
    });
  }

  return assertions;
}

/* ──────────────────────────────── Assembler ───────────────────────────────── */

export function assembleSnapshot(inputs: SnapshotInputs): SnapshotBuildResult {
  const { dispute } = inputs;
  const reconstructionGaps: string[] = [];

  const { tie, pkg } = resolvePackageTie(dispute, inputs.submittedPackages);
  if (tie === "AMBIGUOUS_MULTIPLE_PACKAGES") {
    reconstructionGaps.push(
      `${inputs.submittedPackages.length} submitted packages exist; the forwarded one is not identifiable.`,
    );
  }

  const submissionInstant = resolveSubmissionInstant(dispute, pkg);
  if (!submissionInstant) {
    reconstructionGaps.push(
      "No submission instant could be resolved; evidence availability is unknown.",
    );
  }

  const confirmationSource = resolveConfirmationSource(dispute, pkg);
  if (confirmationSource === "PLATFORM_SAVE_ONLY") {
    reconstructionGaps.push(
      "Evidence was saved and verified, but the platform never reported forwarding it.",
    );
  }

  const provider = providerFromGateway(inputs.paymentGateway);
  if (provider === "UNKNOWN") {
    reconstructionGaps.push("Payment provider could not be resolved from the order.");
  }

  const forwardingConfirmed =
    confirmationSource === "SHOPIFY_EVIDENCE_SENT_ON" ||
    confirmationSource === "PROVIDER_LOG";
  const saveConfirmed = platformSaveVerified(pkg);

  const capabilities =
    provider === "SHOPIFY_PAYMENTS"
      ? shopifyPaymentsCapabilities({ forwardingConfirmed, saveConfirmed })
      : noConnectorCapabilities({ outcomeAccess: true });
  const accessLevel = providerAccessLevelFor(provider, capabilities);

  const facts = parseFacts(pkg?.facts_json);
  const factEvidence = factsToEvidence(facts, submissionInstant);
  const factIds = new Set(factEvidence.map((e) => e.id));

  const gorgias = gorgiasToEvidence(inputs.gorgias, submissionInstant);

  // The outcome must be a real won/lost. `outcome_source` being absent does not
  // by itself make it unreliable — Shopify is the source for every prod case —
  // but a non-analyzable value does.
  const outcomeValue = dispute.final_outcome;
  const outcomeReliable = outcomeValue === "won" || outcomeValue === "lost";
  if (!outcomeReliable) {
    reconstructionGaps.push(`final_outcome ${outcomeValue ?? "null"} is not analyzable.`);
  }

  const level = resolveAnalysisLevel({
    provider,
    providerAccessLevel: accessLevel,
    exactPackageReconstructable:
      pkg !== null && pkg.pdf_path !== null && pkg.evidence_hash !== null,
    packageEvidenceTie: tie,
    submissionConfirmationSource: confirmationSource,
    outcomeReliable,
    hasSubmittedPackage: inputs.submittedPackages.length > 0,
  });

  const snapshot: PostOutcomeSourceSnapshot = {
    contractVersion: SNAPSHOT_CONTRACT_VERSION,
    dispute: {
      id: dispute.id,
      shopId: dispute.shop_id,
      phase: dispute.phase,
      reason: dispute.reason,
      networkReasonCode: dispute.network_reason_code,
      amount: dispute.amount === null ? null : String(dispute.amount),
      currencyCode: dispute.currency_code,
      initiatedAt: dispute.initiated_at,
    },
    outcome: {
      // Safe: a non-analyzable outcome yields NOT_ANALYZABLE above and the
      // caller never persists it as an analysis.
      finalOutcome: (outcomeReliable ? outcomeValue : "lost") as AnalyzableOutcome,
      finalizedAt: dispute.closed_at,
      reliable: outcomeReliable,
    },
    provider: {
      paymentProvider: provider,
      providerAccountRef: null,
      cardNetwork: inputs.cardNetwork,
      capabilities,
      accessLevel,
      submissionConfirmationSource: confirmationSource,
      packageEvidenceTie: tie,
    },
    lifecycle: {
      submissionState: dispute.submission_state,
      // Only a platform-originated forwarding time belongs here, and only when
      // one of OUR packages could have been the thing forwarded.
      //
      // Shopify auto-files its own scrape, so `disputes.submitted_at` is set on
      // 688 decided disputes while only 50 have a package of ours. With no
      // package, that timestamp records Shopify forwarding something we did not
      // build — attributing it to our submission would be a false claim, and
      // would put a forwarding time on ~888 historical imports.
      submittedAt:
        forwardingConfirmed && inputs.submittedPackages.length > 0
          ? submissionInstant
          : null,
      evidenceSavedToShopifyAt: dispute.evidence_saved_to_shopify_at,
      platformSaveVerified: saveConfirmed,
      evidenceGid: responseEvidenceGid(pkg),
      disputeEvidenceGid: dispute.dispute_evidence_gid,
      evidenceDeadlineAt: dispute.due_at,
      events: inputs.events.map((e) => ({
        type: e.event_type,
        at: e.event_at,
        detail: e.description,
      })),
    },
    submittedPackage: pkg
      ? {
          packageId: pkg.id,
          version: pkg.version,
          submittedToPlatformAt: pkg.submitted_at,
          contentRevision: pkg.content_revision,
          pdfSha256: null,
          pdfPath: pkg.pdf_path,
          evidenceHash: pkg.evidence_hash,
          promptVersion: pkg.prompt_version,
          validatorVersion: pkg.validator_version,
          reasonCodeModule: pkg.reason_code_module,
        }
      : null,
    caseStrengthAtSubmission: inputs.caseStrengthAtSubmission,
    availableBeforeSubmission: [...factEvidence, ...gorgias.before],
    arrivedAfterSubmission: gorgias.after,
    availabilityUnknown: gorgias.unknown,
    assertions: narrativeToAssertions(pkg?.narrative_json ?? null, factIds),
    reconstructionGaps,
  };

  return {
    snapshot,
    hash: computeSnapshotHash(snapshot),
    level,
    contractErrors: validateSnapshotContract(snapshot),
  };
}
