/**
 * Canonicaliser tests.
 *
 * The first block is the important one: it pins that extracting this routine
 * out of `computeEvidenceHash` (2026-08-30) did not move a single hash. Every
 * `evidence_hash` in `defence_packages` was produced by the pre-extraction
 * implementation, and `enqueueDefencePackage` compares against those values to
 * decide whether a package is stale. A one-character drift here marks live
 * packages stale and rebuilds them for no reason — silently, since the hash is
 * never displayed. So the old implementation is reproduced verbatim below and
 * asserted equal, rather than trusted.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  DROP_NOTHING,
  sha256Canonical,
  VOLATILE_TIMESTAMP_KEYS,
} from "../canonicalJson";

/** Verbatim copy of the pre-extraction canonicaliser. Do not "improve" this. */
const LEGACY_VOLATILE_KEYS = new Set([
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "uploaded_at",
  "uploadedAt",
  "generated_at",
  "generatedAt",
]);

function legacyCanonicalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(legacyCanonicalise);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((k) => !LEGACY_VOLATILE_KEYS.has(k))
      .sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === null || v === undefined) continue;
      out[k] = legacyCanonicalise(v);
    }
    return out;
  }
  return null;
}

function legacyHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(legacyCanonicalise(value)))
    .digest("hex");
}

const SAMPLES: unknown[] = [
  {
    reasonCode: "FRAUDULENT",
    facts: [{ category: "a", value: 1, created_at: "x", nested: { z: 1, a: [1, "2", null] } }],
    manual: [],
  },
  { reasonCode: null, facts: [], manual: [{ evidence_item_id: "q", bank_eligible: true, updated_at: "t" }] },
  { reasonCode: "X", facts: [{ a: undefined, b: null, c: 0, d: false, e: "" }], manual: [] },
  { deep: { arr: [{ updatedAt: "v", k: 3 }], num: 42, s: "42" } },
  { emptyObj: {}, emptyArr: [], nestedNulls: { a: { b: null } } },
  [1, "1", true, null, { generatedAt: "drop me", keep: "me" }],
];

describe("extraction equivalence with the pre-2026-08-30 implementation", () => {
  it.each(SAMPLES.map((s, i) => [i, s] as const))(
    "sample %i hashes identically",
    (_i, sample) => {
      expect(sha256Canonical(sample, { dropKeys: VOLATILE_TIMESTAMP_KEYS })).toBe(
        legacyHash(sample),
      );
    },
  );

  it("treats a Date as {} exactly as the legacy routine did", () => {
    // Special-casing Date here would move every evidence_hash that ever saw
    // one. Callers pass ISO strings; this pins the decision not to change it.
    const withDate = { at: new Date("2026-01-01T00:00:00.000Z") };
    expect(sha256Canonical(withDate, { dropKeys: VOLATILE_TIMESTAMP_KEYS })).toBe(
      legacyHash(withDate),
    );
    expect(canonicalJson(withDate)).toBe('{"at":{}}');
  });
});

describe("canonicalisation rules", () => {
  it("sorts keys recursively so insertion order cannot move the hash", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("normalises numbers to strings", () => {
    expect(canonicalJson({ n: 1 })).toBe(canonicalJson({ n: "1" }));
  });

  it("treats an absent key and a null value as the same", () => {
    expect(canonicalJson({ a: 1, b: null })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("preserves array order — order is content, not incidental", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("drop-set policy", () => {
  it("defaults to dropping nothing", () => {
    // Snapshots depend on this: created_at distinguishes an omission from a
    // late arrival (plan §5).
    expect(canonicalJson({ created_at: "t", a: 1 })).toContain("created_at");
    expect(canonicalJson({ created_at: "t", a: 1 }, { dropKeys: DROP_NOTHING })).toContain(
      "created_at",
    );
  });

  it("drops volatile timestamps only when asked", () => {
    expect(
      canonicalJson({ created_at: "t", a: 1 }, { dropKeys: VOLATILE_TIMESTAMP_KEYS }),
    ).toBe('{"a":"1"}');
  });

  it("drops at every depth, not just the root", () => {
    expect(
      canonicalJson({ x: { updatedAt: "t", k: 1 } }, { dropKeys: VOLATILE_TIMESTAMP_KEYS }),
    ).toBe('{"x":{"k":"1"}}');
  });
});
