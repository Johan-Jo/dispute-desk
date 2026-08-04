/**
 * P1 of the canonical-evidence-model migration: the divergence manifest.
 *
 * WHAT THIS IS. `docs/evidence-model/divergence-manifest.json` is the
 * checked-in, machine-generated list of every place the evidence consumers
 * disagree today. It is the audit that proves the data-flow map is real
 * rather than asserted, and it is the migration's definition of done: each
 * later phase closes entries until the file is empty.
 *
 * WHY IT IS A MANIFEST AND NOT A RED TEST SUITE. The obvious approach —
 * write the contract tests now and let them fail until each is fixed — means
 * committing a deliberately red suite, so CI stops meaning anything and a
 * genuine regression hides among the expected failures. Instead:
 *   - this test CHARACTERIZES today's behaviour (green now, and red the
 *     moment behaviour changes without the manifest being updated);
 *   - the contract tests in later phases assert the canonical answer only
 *     for entries marked `"status": "closed"`.
 * CI is green at every commit.
 *
 * THE DIVERGENCE IT DETECTS. A field is *collected* when some collector puts
 * it in `fieldsProvided`; every collector runs on every dispute regardless of
 * reason (`buildPack.ts:410-422`). A field is *visible and scorable* only if
 * the reason template gave it a checklist row — `reconcileChecklistWithCollected
 * Fields` can flip `missing → available` but never appends
 * (`checklistReconcile.ts:90-94`), and `caseStrength.ts:511-513` skips any
 * field with no row. So a collected field with no row is cited to the issuer
 * by `factClassifier` (which reads `sections` directly) while being invisible
 * to the merchant and absent from scoring. That is blume-box #352552, and the
 * two `refund_record` incidents before it.
 *
 * Regenerate after an intentional change:
 *   UPDATE_EVIDENCE_MANIFEST=1 npx vitest run tests/unit/evidenceDivergenceManifest.test.ts
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  REASON_TEMPLATES_V2,
  evaluateCompletenessV2,
  type OrderContext,
} from "@/lib/automation/completeness";
import { reconcileChecklistWithCollectedFields } from "@/lib/packs/checklistReconcile";
import { EVIDENCE_FIELD_KEYS } from "@/lib/evidence/model/domains";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";

const MANIFEST_PATH = join(
  process.cwd(),
  "docs",
  "evidence-model",
  "divergence-manifest.json",
);

/**
 * Permissive order context: fulfilled, card payment, AVS/CVV present,
 * refunded. Conditional requirement modes then resolve to `missing`
 * (and, once collected, `available`) rather than `unavailable`, so the
 * detector measures TEMPLATE MEMBERSHIP and not order circumstance.
 * Understating membership would hide divergences; this cannot.
 */
const PERMISSIVE: OrderContext = {
  isFulfilled: true,
  hasCardPayment: true,
  avsCvvAvailable: true,
  hasShippingEvidence: true,
  hasRefund: true,
};

/** `null` exercises the GENERAL fallback that `getTemplateV2` applies. */
const REASONS: (string | null)[] = [...Object.keys(REASON_TEMPLATES_V2), null];

interface ManifestEntry {
  id: string;
  property: "visibility";
  fieldKey: string;
  reason: string;
  /**
   * Which collector actually emits this field. A divergence is only real if
   * something collects the field — otherwise "invisible" is just "absent",
   * and reporting it would inflate the manifest with hypotheticals.
   */
  collectedBy: string;
  /**
   * `never_in_any_template` — the field has no checklist row under ANY
   *   reason, so it is invisible on every dispute. Unambiguous defect.
   * `absent_for_this_reason` — the field IS in some templates but not this
   *   one, while its collector still runs on every dispute. Real, but the
   *   fix may be "declare it not_applicable" rather than "make it visible":
   *   the canonical model must still carry the record with
   *   `relevance: "not_applicable"` so it is explicit rather than missing.
   */
  class: "never_in_any_template" | "absent_for_this_reason";
  current: {
    citedToIssuer: string;
    merchantSurfaces: string;
    scoring: string;
    completeness: string;
  };
  canonical: string;
  authority: string;
  justification: string;
  phase: string;
  status: "open" | "closed";
}

const SOURCES_DIR = join(process.cwd(), "lib", "packs", "sources");

/**
 * Fields a collector genuinely emits, mapped to the collector file.
 *
 * SCAN SHAPE — deliberately over-approximating: any quoted registered
 * evidence key anywhere in a collector file (comments stripped) counts as
 * emitted. A narrower scan restricted to `fieldsProvided: [...]` literals was
 * tried first and UNDER-reported, because collectors build the array
 * imperatively — `fulfillmentSource.ts:554` pushes `shipping_tracking`,
 * `orderSource.ts:113` pushes `billing_address_match`, and `policySource.ts:84`
 * pushes values out of `POLICY_FIELD_MAP`. Under-reporting is the dangerous
 * direction here: it would silently shrink the manifest and make the audit
 * claim coverage it does not have. Over-approximation can only demand more
 * coverage than strictly necessary, and every entry names its file so a false
 * positive is cheap to check.
 *
 * This still EXCLUDES `product_description` and `duplicate_explanation`
 * (satisfied only by the merchant upload route) and
 * `device_session_consistency` (no collector exists yet). Nothing collects
 * them, so their absence from a checklist is not a divergence.
 */
function collectorEmittedFields(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of readdirSync(SOURCES_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const src = readFileSync(join(SOURCES_DIR, file), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const lit of src.matchAll(/["']([a-z][a-z0-9_]{3,})["']/g)) {
      const field = lit[1];
      if (!EVIDENCE_FIELD_KEYS.includes(field as never)) continue;
      const files = out.get(field) ?? [];
      if (!files.includes(file)) files.push(file);
      out.set(field, files);
    }
  }
  return out;
}

/**
 * Fields with a checklist row for `reason` when everything is collected.
 * This is exactly what the merchant surfaces render and what
 * `calculateCaseStrength` iterates.
 */
function visibleFields(reason: string | null, collected: Set<string>): Set<string> {
  const result = evaluateCompletenessV2(reason, collected, [], null, PERMISSIVE);
  const reconciled = reconcileChecklistWithCollectedFields(
    result.checklist,
    collected,
  );
  return new Set(reconciled.map((c) => c.field));
}

function buildManifest(): ManifestEntry[] {
  const emitters = collectorEmittedFields();
  const collectedFields = [...emitters.keys()].sort();
  const collected = new Set<string>(collectedFields);
  const entries: ManifestEntry[] = [];
  let n = 0;

  // A field with no checklist row under ANY reason is invisible on every
  // dispute — a strictly worse defect than one that is merely absent here.
  const visibleSomewhere = new Set<string>();
  for (const reason of REASONS) {
    for (const f of visibleFields(reason, collected)) visibleSomewhere.add(f);
  }

  for (const reason of REASONS) {
    const visible = visibleFields(reason, collected);
    for (const field of collectedFields) {
      if (visible.has(field)) continue;
      n += 1;
      entries.push({
        id: `DIV-${String(n).padStart(3, "0")}`,
        property: "visibility",
        fieldKey: field,
        reason: reason ?? "GENERAL(null)",
        collectedBy: (emitters.get(field) ?? []).join(", "),
        class: visibleSomewhere.has(field)
          ? "absent_for_this_reason"
          : "never_in_any_template",
        current: {
          citedToIssuer:
            "yes — factClassifier reads pack_json.sections directly (factClassifier.ts:577-647)",
          merchantSurfaces:
            "absent — no checklist row, so Overview and Evidence render nothing",
          scoring:
            "unscored — caseStrength.ts:511-513 skips fields with no checklist row",
          completeness:
            "not counted — deriveCompletenessMetrics iterates the checklist",
        },
        canonical: "collected ⇒ present in the model with explicit state flags",
        authority: "R1 — collection is fact",
        justification:
          "A collector emitted the field on this dispute; reason templates own " +
          "relevance and priority, not existence. Suppressing a collected field " +
          "from the merchant while citing it to the issuer is the #352552 defect.",
        phase: "P3 (visibility) / P2c (completeness weight)",
        status: "open",
      });
    }
  }
  return entries;
}

describe("evidence divergence manifest", () => {
  const generated = buildManifest();

  it("guard the guard — the detector examined a non-trivial matrix", () => {
    // A broken import or an empty template map would make every assertion
    // below vacuous. 7 reasons + the GENERAL fallback × 20 evidence fields.
    expect(REASONS.length).toBeGreaterThanOrEqual(8);
    expect(EVIDENCE_FIELD_KEYS.length).toBeGreaterThanOrEqual(20);
  });

  it("the detector still WORKS — it finds the incident against the pre-fix rule", () => {
    // The manifest is now empty, which is the goal. But an empty manifest and
    // a broken detector look identical, so this re-runs the detection against
    // the OLD flip-only reconcile rule and asserts it still reports the
    // original 76. Without this, deleting the detector would "close" the
    // migration.
    const emitters = collectorEmittedFields();
    const collected = new Set(emitters.keys());
    const legacyOffenders: string[] = [];
    for (const reason of REASONS) {
      const result = evaluateCompletenessV2(reason, collected, [], null, PERMISSIVE);
      // Pre-fix behaviour: flip existing rows, never append.
      const rowFields = new Set(result.checklist.map((c) => c.field));
      for (const field of collected) {
        if (!rowFields.has(field)) {
          legacyOffenders.push(`${reason ?? "GENERAL(null)"}:${field}`);
        }
      }
    }
    expect(
      legacyOffenders.length,
      "The detector no longer reproduces the original divergence against the " +
        "pre-fix rule, so an empty manifest proves nothing.",
    ).toBeGreaterThanOrEqual(70);
    expect(
      legacyOffenders.some((o) => o.endsWith(":tds_authentication")),
      "blume-box #352552 — tds_authentication — is no longer detectable.",
    ).toBe(true);
  });

  it("the incident is CLOSED: no collected field is invisible on any reason", () => {
    // The migration's definition of done for the `visibility` property.
    // `reconcileChecklistWithCollectedFields` now appends a row for any
    // collected canonical field the reason template omitted, so every field a
    // collector emits reaches the merchant surfaces and the scorer.
    expect(
      generated.map((e) => `${e.reason}:${e.fieldKey}`),
      "A collected field is still invisible. Each entry is a (reason, field) " +
        "pair the merchant cannot see while factClassifier can cite it.",
    ).toEqual([]);
  });

  it("every reported field is a real registry field", () => {
    const bogus = generated
      .map((e) => e.fieldKey)
      .filter((f) => !(f in CANONICAL_EVIDENCE));
    expect(bogus, `Not in CANONICAL_EVIDENCE: ${bogus.join(", ")}`).toEqual([]);
  });

  it("matches the checked-in manifest", () => {
    const payload = {
      $comment:
        "GENERATED — do not hand-edit entries. Run " +
        "UPDATE_EVIDENCE_MANIFEST=1 npx vitest run tests/unit/evidenceDivergenceManifest.test.ts. " +
        "Status flips to 'closed' as each migration phase lands; the migration " +
        "is done when `entries` is empty.",
      generatedBy: "tests/unit/evidenceDivergenceManifest.test.ts",
      openCount: generated.filter((e) => e.status === "open").length,
      entries: generated,
    };

    if (process.env.UPDATE_EVIDENCE_MANIFEST === "1") {
      mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    }

    expect(
      existsSync(MANIFEST_PATH),
      `Missing ${MANIFEST_PATH}. Generate it with UPDATE_EVIDENCE_MANIFEST=1.`,
    ).toBe(true);

    const onDisk = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    expect(
      onDisk.entries,
      "Behaviour changed without the manifest being regenerated. If the change " +
        "was intentional, rerun with UPDATE_EVIDENCE_MANIFEST=1 and review the " +
        "diff — a divergence disappearing is a phase closing; a NEW divergence " +
        "appearing is a regression of the class this migration is closing.",
    ).toEqual(payload.entries);
  });
});
