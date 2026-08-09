/**
 * The domain boundary must cover every collector output — no discard path.
 *
 * INCIDENTS THIS EXISTS FOR:
 *   - 2026-08-02, blume-box #352552: `tds_authentication` was collected and
 *     cited to the issuer while invisible on every merchant surface and
 *     unscored, because both pipelines drop unregistered keys with a silent
 *     `if (!spec) continue` (`factClassifier.ts:583`, `caseStrength.ts:513`).
 *   - 2026-08-01, blume-box 162042cd: `refund_record` on a fraud claim,
 *     same shape (`lib/automation/completeness.ts:116-123`).
 *   - 2026-07-07: `refund_record` on CREDIT_NOT_PROCESSED, same shape again.
 *
 * Three instances of one class. Prose did not stop the third. This does.
 *
 * The scan walks `lib/packs/sources/*.ts` for the literal strings the
 * collectors put in `fieldsProvided`. It deliberately OVER-approximates
 * (any quoted string that is a registered key counts, including entries in
 * maps like `POLICY_FIELD_MAP`): over-approximation demands more coverage,
 * never less, so it cannot hide a gap.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  CANONICAL_DOMAIN,
  EVIDENCE_FIELD_KEYS,
  canonicalEvidenceKeysMissingADomain,
  domainOf,
  unregisteredCollectorFields,
} from "../domains";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";

const SOURCES_DIR = join(process.cwd(), "lib", "packs", "sources");

/** Strip comments so a key named only in prose does not count as emitted. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function collectorEmittedFields(): { field: string; file: string }[] {
  const registered = new Set(Object.keys(CANONICAL_DOMAIN));
  const out: { field: string; file: string }[] = [];
  for (const file of readdirSync(SOURCES_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const src = stripComments(readFileSync(join(SOURCES_DIR, file), "utf-8"));
    for (const m of src.matchAll(/["']([a-z][a-z0-9_]{3,})["']/g)) {
      if (registered.has(m[1])) out.push({ field: m[1], file });
    }
  }
  return out;
}

describe("domain registry — guard the guard", () => {
  it("the scan finds a non-trivial number of collector emissions", () => {
    // A broken walk or a broken regex would make every assertion below
    // vacuous. 11 collectors emit ≥ 18 distinct keys between them.
    const emitted = collectorEmittedFields();
    expect(emitted.length).toBeGreaterThan(20);
    expect(new Set(emitted.map((e) => e.field)).size).toBeGreaterThanOrEqual(15);
  });

  it("registers at least the 20 canonical evidence fields plus coverage", () => {
    expect(Object.keys(CANONICAL_DOMAIN).length).toBeGreaterThanOrEqual(21);
    // 19 since PR-C4 retired `billing_address_match` (was 20). It stays in
    // CANONICAL_DOMAIN as `operational`, so the registry count above is
    // unchanged — a retirement is reported, never dropped.
    expect(EVIDENCE_FIELD_KEYS.length).toBeGreaterThanOrEqual(19);
  });
});

describe("every collector output belongs to a registered domain", () => {
  it("no collector emits a field with no domain", () => {
    // Re-scan without the registered-key filter so a NEW unregistered key is
    // caught. We look only at strings that appear inside a `fieldsProvided`
    // array literal, which is the one place a collector declares its output.
    const offenders: string[] = [];
    for (const file of readdirSync(SOURCES_DIR)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const src = stripComments(readFileSync(join(SOURCES_DIR, file), "utf-8"));
      for (const decl of src.matchAll(/fieldsProvided:\s*\[([^\]]*)\]/g)) {
        for (const lit of decl[1].matchAll(/["']([^"']+)["']/g)) {
          if (domainOf(lit[1]) === null) offenders.push(`${file} → "${lit[1]}"`);
        }
      }
    }
    expect(
      offenders,
      `Collector fields with no entry in CANONICAL_DOMAIN: ${offenders.join(", ")}. ` +
        `Add each to lib/evidence/model/domains.ts under the domain it belongs to — ` +
        `"evidence" only if it can be scored or cited. Never leave it unregistered: ` +
        `both pipelines drop unknown keys silently, which is how #352552 happened.`,
    ).toEqual([]);
  });

  it("every field the legacy evidence registry knows has a domain", () => {
    const missing = canonicalEvidenceKeysMissingADomain();
    expect(
      missing,
      `In CANONICAL_EVIDENCE but absent from CANONICAL_DOMAIN: ${missing.join(", ")}. ` +
        `The model would be blind to a field today's scorer can already see.`,
    ).toEqual([]);
  });
});

describe("the boundary is a boundary, not a copy of the evidence registry", () => {
  it("coverage is registered but is NOT an evidence field", () => {
    // The deliberate exclusion must be expressible. Before this registry,
    // `shopify_protect_coverage` was dropped by the same silent `continue`
    // that hid `tds_authentication` — deliberate and accidental looked alike.
    expect(domainOf("shopify_protect_coverage")).toBe("coverage");
    expect(EVIDENCE_FIELD_KEYS).not.toContain("shopify_protect_coverage");
    expect(Object.keys(CANONICAL_EVIDENCE)).not.toContain(
      "shopify_protect_coverage",
    );
  });

  it("device_session_consistency stays scorable evidence, not a risk_signal", () => {
    // It is never bank-facing, but `caseStrength.ts` scores its `device_session`
    // signal. Moving it out of `evidence` would drop it from `model.fields` and
    // silently stop scoring it — the exact class of bug being closed.
    expect(domainOf("device_session_consistency")).toBe("evidence");
    expect(CANONICAL_EVIDENCE.device_session_consistency?.signalId).toBe(
      "device_session",
    );
  });

  it("reports unregistered fields instead of dropping them", () => {
    expect(unregisteredCollectorFields(["delivery_proof", "made_up_key"])).toEqual([
      "made_up_key",
    ]);
    expect(unregisteredCollectorFields(["delivery_proof"])).toEqual([]);
  });
});
