/**
 * Invariant: we never hardcode a dispute reason code Shopify doesn't have.
 *
 * On 2026-07-28 we found `SUBSCRIPTION_CANCELED` (single L) keyed into 22
 * source files, 6 message bundles and two DB tables. Shopify's
 * `ShopifyPaymentsDisputeReason` enum only ever contained the double-L
 * spelling. Nothing failed loudly: every consumer degrades with `?? "general"`
 * / `?? REASON_TEMPLATES.GENERAL`, so 17 real prod disputes were scored as
 * `general` and given the wrong evidence checklist in silence.
 *
 * Two guards below, because the bug had two halves:
 *
 *   1. The master list drifted from Shopify's enum.  → pinned snapshot.
 *   2. A near-miss spelling was keyed into modules.  → edit-distance scan.
 *
 * A near-miss is any ALL_CAPS_TOKEN within edit distance 2 of a real enum
 * value that is not itself a real enum value (or a declared legacy alias).
 * That is precisely the shape of this class of bug — CANCELED/CANCELLED,
 * UNRECOGNIZED/UNRECOGNISED, FRAUDULENT/FRAUDULANT — and it is what a plain
 * "is it in the enum" check cannot see, because the token never reaches the
 * enum in the first place.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import {
  ALL_DISPUTE_REASONS,
  DISPUTE_REASONS_ORDER,
  LEGACY_REASON_ALIASES,
  canonicalReasonCode,
} from "../disputeReasons";
import { DISPUTE_TYPES, normalizeDisputeType } from "../disputeTypes";
import { readAllDisputeReasons } from "../../../scripts/lib/allDisputeReasons.mjs";

/**
 * Verbatim from
 * https://shopify.dev/docs/api/admin-graphql/latest/enums/ShopifyPaymentsDisputeReason
 * (checked 2026-07-28). The live check that keeps this honest against the API
 * is `lib/shopify/checkReasonEnumDrift.ts`, run daily by
 * /api/cron/check-shopify-reasons; this snapshot is the offline guard so a
 * drift can't merge in the first place.
 */
const SHOPIFY_DISPUTE_REASON_ENUM = [
  "BANK_CANNOT_PROCESS",
  "CREDIT_NOT_PROCESSED",
  "CUSTOMER_INITIATED",
  "DEBIT_NOT_AUTHORIZED",
  "DUPLICATE",
  "FRAUDULENT",
  "GENERAL",
  "INCORRECT_ACCOUNT_DETAILS",
  "INSUFFICIENT_FUNDS",
  "NONCOMPLIANT",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION_CANCELLED",
  "UNRECOGNIZED",
] as const;

const REPO_ROOT = join(__dirname, "..", "..", "..");

describe("Shopify dispute-reason enum — master list", () => {
  it("ALL_DISPUTE_REASONS is exactly Shopify's enum", () => {
    expect([...ALL_DISPUTE_REASONS].sort()).toEqual(
      [...SHOPIFY_DISPUTE_REASON_ENUM].sort(),
    );
  });

  it("the wizard's short list is a subset of the enum", () => {
    for (const reason of DISPUTE_REASONS_ORDER) {
      expect(SHOPIFY_DISPUTE_REASON_ENUM).toContain(reason);
    }
  });

  it("pack_templates dispute types are enum values plus DIGITAL", () => {
    for (const type of DISPUTE_TYPES) {
      if (type === "DIGITAL") continue; // product signal, no Shopify equivalent
      expect(SHOPIFY_DISPUTE_REASON_ENUM).toContain(type);
    }
  });

  it("node scripts read the same list instead of keeping a copy", () => {
    expect(readAllDisputeReasons()).toEqual([...ALL_DISPUTE_REASONS]);
  });
});

describe("canonicalReasonCode", () => {
  it("folds the legacy single-L spelling onto Shopify's", () => {
    expect(canonicalReasonCode("SUBSCRIPTION_CANCELED")).toBe(
      "SUBSCRIPTION_CANCELLED",
    );
    expect(canonicalReasonCode("subscription canceled")).toBe(
      "SUBSCRIPTION_CANCELLED",
    );
  });

  it("passes canonical values through and rejects unknowns", () => {
    expect(canonicalReasonCode("FRAUDULENT")).toBe("FRAUDULENT");
    expect(canonicalReasonCode("NOT_A_REASON")).toBeNull();
    expect(canonicalReasonCode(null)).toBeNull();
    expect(canonicalReasonCode("")).toBeNull();
  });

  it("keeps the legacy pack_templates spelling resolvable", () => {
    expect(normalizeDisputeType("SUBSCRIPTION_CANCELED")).toBe(
      "SUBSCRIPTION_CANCELLED",
    );
  });
});

// ---------------------------------------------------------------------------
// Near-miss scan
// ---------------------------------------------------------------------------

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const carry = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = carry;
    }
  }
  return prev[b.length];
}

const SCAN_DIRS = ["lib", "app", "components", "messages", "scripts"];
const SCAN_EXTENSIONS = [".ts", ".tsx", ".mjs", ".json"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage"]);

/** Files that document the bug itself and therefore name the bad spelling. */
const SKIP_FILES = new Set(
  [
    "lib/rules/disputeReasons.ts",
    "lib/rules/disputeTypes.ts",
    "lib/rules/helpers.ts",
    "lib/coverage/deriveCoverage.ts",
    "lib/coverage/deriveLifecycleCoverage.ts",
    "lib/db/packs.ts",
    "lib/rules/__tests__/shopifyReasonEnum.test.ts",
    "scripts/check-shopify-reasons.mjs",
    "scripts/lib/allDisputeReasons.mjs",
  ].map((p) => p.split("/").join(sep)),
);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Two kinds of entry live in `LEGACY_REASON_ALIASES`, and they get opposite
 * treatment here:
 *
 *   - A SANCTIONED ALIAS is a distinct short vocabulary word (`NOT_AS_DESCRIBED`)
 *     used deliberately in deep links, pack categories and i18n keys. It reads
 *     nothing like the enum value it maps to, so nobody confuses the two.
 *     Allowed anywhere.
 *   - A QUARANTINED SPELLING is a near-copy of a real enum value
 *     (`SUBSCRIPTION_CANCELED`, one L away from `SUBSCRIPTION_CANCELLED`).
 *     It is a typo we are stuck reading from old rows, and it must appear in
 *     exactly one place: the alias table that folds it away. Anywhere else it
 *     is this bug, again.
 *
 * The split is computed, not curated, so a future typo alias is quarantined
 * automatically. Listing every alias as "allowed" is what made the first
 * version of this test pass against the very bug it exists to catch.
 */
const QUARANTINED_SPELLINGS = Object.keys(LEGACY_REASON_ALIASES).filter((alias) =>
  ALL_DISPUTE_REASONS.some((reason) => editDistance(alias, reason) <= 2),
);

const ALLOWED = new Set<string>([
  ...ALL_DISPUTE_REASONS,
  ...Object.keys(LEGACY_REASON_ALIASES).filter(
    (alias) => !QUARANTINED_SPELLINGS.includes(alias),
  ),
]);

describe("no near-miss reason spellings anywhere in the codebase", () => {
  it("every reason-code-shaped token is a real enum value or a declared alias", () => {
    const offenders: string[] = [];
    const tokenPattern = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,4}\b/g;

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file);
        if (SKIP_FILES.has(rel)) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          for (const [token] of line.matchAll(tokenPattern)) {
            if (ALLOWED.has(token)) continue;
            const nearMiss = ALL_DISPUTE_REASONS.some(
              (reason) => editDistance(token, reason) <= 2,
            );
            if (nearMiss) {
              offenders.push(`${rel}:${index + 1} → ${token}`);
            }
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
