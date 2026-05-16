/**
 * Deterministic SHA-256 hash over the approved-facts + manual-evidence +
 * reason-code triple. Powers stale detection:
 *
 *   - `enqueueDefencePackage` computes this hash from the current pack +
 *     manual rows, then compares against the latest `final` defence_packages
 *     row's `evidence_hash`. Mismatch → mark old `final` stale (only via
 *     supersession after a new final exists; never direct UPDATE) and
 *     insert a new draft at version+1.
 *
 * Canonicalisation rules (avoid spurious hash drift):
 *   - Drop volatile timestamps (`created_at`, `updated_at`, `uploaded_at`,
 *     `generated_at`).
 *   - Sort all object keys recursively.
 *   - Normalise numeric ids to strings (so `1` and `"1"` hash the same).
 *   - Drop null / undefined values (presence sentinel handles nulls).
 *   - Skip the `confidence` numeric — it's a heuristic, not a fact.
 */

import { createHash } from "node:crypto";
import type {
  EvidenceFact,
  ManualEvidenceRecord,
} from "./types";

const VOLATILE_KEYS = new Set([
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "uploaded_at",
  "uploadedAt",
  "generated_at",
  "generatedAt",
]);

function canonicalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((k) => !VOLATILE_KEYS.has(k))
      .sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === null || v === undefined) continue;
      out[k] = canonicalise(v);
    }
    return out;
  }
  // function / symbol / bigint — should never appear in fact data.
  return null;
}

/** Stripped EvidenceFact projection — only the load-bearing properties.
 *  Hash never moves when label / confidence / merchant_visible drift. */
function projectFact(f: EvidenceFact): Record<string, unknown> {
  return {
    category: f.category,
    strength: f.strength,
    bank_eligible: f.bankEligible,
    internal_only: f.internalOnly,
    include_in_bank_narrative: f.includeInBankNarrative,
    submission_risk: f.submissionRisk,
    value: f.value,
    source: f.source,
  };
}

function projectManual(m: ManualEvidenceRecord): Record<string, unknown> {
  return {
    evidence_item_id: m.evidenceItemId,
    bank_eligible: m.bankEligible,
    include_in_package: m.includeInPackage,
    include_in_bank_narrative: m.includeInBankNarrative,
    evidence_category: m.evidenceCategory ?? null,
    file_type: m.fileType ?? null,
  };
}

export function computeEvidenceHash(input: {
  approvedFacts: EvidenceFact[];
  manualEvidence: ManualEvidenceRecord[];
  reasonCode: string | null;
}): string {
  // Stable ordering so deterministic re-builds produce identical hashes.
  const facts = [...input.approvedFacts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(projectFact);
  const manual = [...input.manualEvidence]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(projectManual);

  const canonical = canonicalise({
    reasonCode: input.reasonCode ?? null,
    facts,
    manual,
  });

  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json).digest("hex");
}
