/**
 * The immutable submission-time source snapshot — plan §5, §7 Stage 1.
 *
 * This type is the contract for "what DisputeDesk knew when the package was
 * submitted". Everything the analyzer concludes is derived from an instance of
 * it, and nothing else. That is the whole discipline of the feature: current
 * Gorgias messages, current product pages, revised policies, late carrier
 * records and regenerated packages must never silently stand in for the
 * historical state.
 *
 * ── The three-way split that matters ──
 *
 * `availableBeforeSubmission`, `arrivedAfterSubmission` and
 * `availabilityUnknown` are separate fields rather than one list with a flag,
 * because the most valuable finding in the taxonomy (AVAILABLE_EVIDENCE_OMITTED,
 * plan §9's canonical DEFINITE) and its most dangerous false positive are
 * distinguished by exactly this. Evidence that arrived after we filed is not an
 * omission; calling it one blames the pipeline for a time-travel failure.
 *
 * ── Why the source is `defence_packages`, not `defence_evidence_facts` ──
 *
 * The plan assumed a structured evidence inventory in `defence_evidence_facts`.
 * That table holds ZERO rows for all 50 analyzable disputes (audit, plan §25.4).
 * What does exist is better: every submitted package on a decided dispute
 * carries `facts_json` (53/53, avg 10.8 facts), `narrative_json`,
 * `evidence_hash` and `pdf_path`. That JSON is already frozen at build time,
 * which is precisely the immutability this contract needs — a snapshot built
 * from it cannot drift when the live tables move.
 *
 * `submission_logs` and `submission_attempts` are empty platform-wide and are
 * not referenced here.
 */

import { sha256Canonical } from "@/lib/hashing/canonicalJson";
import type {
  AnalyzableOutcome,
  CardNetwork,
  EvidenceClassification,
  PackageEvidenceTie,
  PaymentProvider,
  ProviderAccessLevel,
  ProviderCapabilities,
  SubmissionConfirmationSource,
} from "./taxonomy";

/** Canonical case-strength vocabulary at submission time (plan §7 Stage 1). */
export type SnapshotCaseStrength = "strong" | "moderate" | "weak" | "not_assessed";

/**
 * One piece of evidence as it stood at submission. `classification` is assigned
 * by the Stage 3 comparator, not by the snapshot builder — the builder records
 * facts, the comparator judges them.
 */
export interface SnapshotEvidenceItem {
  /** Stable identity within the snapshot; used for ordering and provenance refs. */
  id: string;
  /** Where it came from: `facts_json`, `gorgias`, `manual`, `order`, … */
  source: string;
  category: string | null;
  /** ISO 8601. When DisputeDesk first held this. Null when unreconstructable. */
  availableAt: string | null;
  /** ISO 8601. When it became approved/eligible, if it ever did. */
  approvedAt: string | null;
  /** Was it eligible for inclusion in a bank-facing package at submission? */
  inclusionEligible: boolean;
  /** Did it appear in the exact submitted package? */
  presentInSubmittedPackage: boolean;
  /** Assigned in Stage 3. Absent on a freshly built snapshot. */
  classification?: EvidenceClassification;
}

/** A material claim made in the submitted package, for Stage 4 integrity checks. */
export interface SnapshotAssertion {
  id: string;
  /** The claim as rendered. Checked against FORBIDDEN_CAUSAL_PATTERNS downstream. */
  text: string;
  /** Evidence item ids the assertion depends on, if determinable. */
  supportingEvidenceIds: string[];
  /** Rule identifier + version when the statement is rule-generated. */
  ruleRef: { id: string; version: number } | null;
  /** Did it survive into the exact submitted PDF, or only the draft narrative? */
  presentInSubmittedPdf: boolean;
}

/** Lifecycle facts Stage 2 tests against. Full coverage on all 50 prod cases. */
export interface SnapshotLifecycle {
  submissionState: string | null;
  /** Shopify-originated forwarding time. Null when never forwarded. */
  submittedAt: string | null;
  /** Storage confirmation only — never read as forwarding. */
  evidenceSavedToShopifyAt: string | null;
  /** `shopify_response.verified === true` plus the readback identifiers. */
  platformSaveVerified: boolean;
  evidenceGid: string | null;
  disputeEvidenceGid: string | null;
  evidenceDeadlineAt: string | null;
  /** Package build/save/submit events relevant to Stage 2. */
  events: Array<{ type: string; at: string; detail: string | null }>;
}

/** The exact package that was submitted, identified beyond dispute. */
export interface SnapshotSubmittedPackage {
  packageId: string;
  version: number;
  /**
   * When WE handed the package to the platform. Distinct from
   * `lifecycle.submittedAt`, which is when the PLATFORM forwarded it onward.
   *
   * Conflating the two is not a nicety. Measured on prod 2026-08-30: we
   * submitted a median 6 days before the evidence deadline and were late zero
   * times out of 53, while Shopify's own forwarding lagged us by an average of
   * 47 hours and landed after the deadline in 41 of those 53. A deadline check
   * reading the platform's timestamp as ours reports 41 late filings that
   * never happened.
   */
  submittedToPlatformAt: string | null;
  contentRevision: number | null;
  /** SHA-256 of the PDF bytes. Distinct from `evidenceHash`. */
  pdfSha256: string | null;
  pdfPath: string | null;
  evidenceHash: string | null;
  promptVersion: string | null;
  validatorVersion: number | null;
  reasonCodeModule: string | null;
}

/**
 * The complete immutable input. Hashed via `computeSnapshotHash`; the hash is
 * half of the idempotency key and the thing that makes "same inputs, same
 * conclusion" checkable rather than asserted.
 */
export interface PostOutcomeSourceSnapshot {
  /** Bumped when the SHAPE of this contract changes, invalidating old hashes. */
  contractVersion: number;

  dispute: {
    id: string;
    shopId: string;
    phase: string | null;
    reason: string | null;
    networkReasonCode: string | null;
    amount: string | null;
    currencyCode: string | null;
    initiatedAt: string | null;
  };

  outcome: {
    finalOutcome: AnalyzableOutcome;
    finalizedAt: string | null;
    /** False when the outcome record is contradictory or unsourced. */
    reliable: boolean;
  };

  provider: {
    paymentProvider: PaymentProvider;
    providerAccountRef: string | null;
    cardNetwork: CardNetwork;
    capabilities: ProviderCapabilities;
    accessLevel: ProviderAccessLevel;
    submissionConfirmationSource: SubmissionConfirmationSource;
    packageEvidenceTie: PackageEvidenceTie;
  };

  lifecycle: SnapshotLifecycle;

  /** Null when no package was submitted — the case is then metadata-only. */
  submittedPackage: SnapshotSubmittedPackage | null;

  caseStrengthAtSubmission: SnapshotCaseStrength;

  /** Evidence DisputeDesk held at or before submission. */
  availableBeforeSubmission: SnapshotEvidenceItem[];
  /** Obtained later. Informs future process, never scored as an omission. */
  arrivedAfterSubmission: SnapshotEvidenceItem[];
  /** Existence at submission time could not be reconstructed. */
  availabilityUnknown: SnapshotEvidenceItem[];

  assertions: SnapshotAssertion[];

  /** Machine-readable notes on what could NOT be reconstructed (plan §20 Phase 0). */
  reconstructionGaps: string[];
}

/**
 * Current shape version. Bump when a field is added, removed, or re-meant.
 *
 * v2 — added `submittedToPlatformAt`, separating our submission from the
 *      platform's forwarding. See the field's own note.
 */
export const SNAPSHOT_CONTRACT_VERSION = 2;

/**
 * Deterministic identity of a snapshot.
 *
 * Drops nothing — unlike `computeEvidenceHash`, every timestamp here is
 * load-bearing. Two snapshots with identical content hash identically
 * regardless of key order or numeric representation, so a retry resumes the
 * same analysis (plan §13) and a genuine source repair produces a new one.
 *
 * Array order is preserved rather than sorted: the builder emits evidence in a
 * stable order, and re-sorting here would hide a builder that had started
 * emitting a different order for the same inputs.
 */
export function computeSnapshotHash(snapshot: PostOutcomeSourceSnapshot): string {
  return sha256Canonical(snapshot);
}

/**
 * Structural check before persisting. Not a schema validator for findings —
 * that is a separate concern — but it catches the contract violations that
 * would silently corrupt every conclusion drawn from the snapshot.
 */
export function validateSnapshotContract(
  snapshot: PostOutcomeSourceSnapshot,
): string[] {
  const errors: string[] = [];

  if (snapshot.contractVersion !== SNAPSHOT_CONTRACT_VERSION) {
    errors.push(
      `contractVersion ${snapshot.contractVersion} != ${SNAPSHOT_CONTRACT_VERSION}`,
    );
  }

  // An evidence item may appear in exactly one availability bucket. Overlap
  // would let the same item be both an omission and a late arrival.
  const seen = new Map<string, string>();
  const buckets: Array<[string, SnapshotEvidenceItem[]]> = [
    ["availableBeforeSubmission", snapshot.availableBeforeSubmission],
    ["arrivedAfterSubmission", snapshot.arrivedAfterSubmission],
    ["availabilityUnknown", snapshot.availabilityUnknown],
  ];
  for (const [bucket, items] of buckets) {
    for (const item of items) {
      const prior = seen.get(item.id);
      if (prior) {
        errors.push(
          `evidence ${item.id} appears in both ${prior} and ${bucket}`,
        );
      } else {
        seen.set(item.id, bucket);
      }
    }
  }

  // Forwarding confirmation without a package is incoherent — EXCEPT when the
  // package is ambiguous. "Shopify forwarded evidence on this dispute at time
  // T, and we cannot say which of several submitted packages went" is a real
  // state, not a contradiction: the forwarding fact is about the dispute, the
  // ambiguity is about the package. One prod dispute (3 submitted packages) is
  // exactly this, and rejecting it would discard a true timestamp.
  if (
    snapshot.submittedPackage === null &&
    snapshot.lifecycle.submittedAt !== null &&
    snapshot.provider.packageEvidenceTie !== "AMBIGUOUS_MULTIPLE_PACKAGES"
  ) {
    errors.push(
      "lifecycle.submittedAt is set but no submitted package was captured",
    );
  }

  // A save confirmation must never be recorded as a forwarding source.
  if (
    snapshot.provider.submissionConfirmationSource === "PLATFORM_SAVE_ONLY" &&
    snapshot.provider.capabilities.submissionConfirmationAccess
  ) {
    errors.push(
      "submissionConfirmationAccess is true while the source is PLATFORM_SAVE_ONLY",
    );
  }

  // Assertions must reference evidence that exists in the snapshot.
  const evidenceIds = new Set(seen.keys());
  for (const assertion of snapshot.assertions) {
    for (const ref of assertion.supportingEvidenceIds) {
      if (!evidenceIds.has(ref)) {
        errors.push(
          `assertion ${assertion.id} references unknown evidence ${ref}`,
        );
      }
    }
  }

  return errors;
}
