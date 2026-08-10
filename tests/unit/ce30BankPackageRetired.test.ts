/**
 * P-4, enforced: the dormant CE 3.0 BANK-PACKAGE route is retired; CE 3.0
 * QUALIFICATION is retained as merchant insight.
 *
 * WHY A TEST AND NOT JUST A DELETION. A deletion is a moment; an invariant is a
 * rule. The retired route had no caller for months — that is exactly the state
 * in which someone re-imports a builder because it looks useful, and the CE 3.0
 * package is the one flagged by C-8 for raw IP addresses, an ungated merchant
 * attestation and a hard-coded reason code. This test makes reintroduction a
 * deliberate act with a red build attached.
 *
 * WHAT P-4 DOES NOT TOUCH. Qualification — whether a dispute meets Visa's
 * Compelling Evidence 3.0 criteria — is a merchant-facing insight and stays. The
 * second block asserts that, so a future reader cannot mistake this retirement
 * for "we dropped CE 3.0".
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RETIRED_FILES = [
  path.join("lib", "liabilityShift", "packageTemplates.ts"),
  path.join("lib", "liabilityShift", "submissionRouter.ts"),
  path.join("lib", "packs", "pdf", "CE30PackDocument.tsx"),
];

/** Symbols that only ever existed to build or route the bank package. */
const RETIRED_SYMBOLS = [
  "buildCE30PackageData",
  "CE30PackageData",
  "CE30_TEMPLATE_VERSION",
  "CE30PackDocument",
  "activateSubmissionChannels",
  "upsertSubmissionLog",
];

const ROOTS = ["lib", "app", "components", "scripts", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs"]);
const SELF = path.join("tests", "unit", "ce30BankPackageRetired.test.ts");

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(path.join(process.cwd(), r))).map((f) =>
  path.relative(process.cwd(), f),
);

describe("P-4 — the CE 3.0 bank-package route is retired", () => {
  it("none of the retired modules exists", () => {
    for (const rel of RETIRED_FILES) {
      expect(fs.existsSync(path.join(process.cwd(), rel)), `${rel} is back`).toBe(false);
    }
  });

  it("no symbol from the retired route is referenced anywhere", () => {
    const offenders: string[] = [];
    for (const rel of FILES) {
      if (rel === SELF) continue;
      const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      for (const symbol of RETIRED_SYMBOLS) {
        if (new RegExp(`\\b${symbol}\\b`).test(text)) offenders.push(`${rel}: ${symbol}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("P-4 — CE 3.0 qualification is RETAINED as merchant insight", () => {
  const RETAINED = [
    path.join("lib", "liabilityShift", "qualifyCE30.ts"),
    path.join("lib", "liabilityShift", "evaluateQualification.ts"),
    path.join("lib", "liabilityShift", "autoQualified.ts"),
    path.join("app", "api", "disputes", "[id]", "qualification", "route.ts"),
  ];

  it("the qualification engine and its merchant surface are untouched", () => {
    for (const rel of RETAINED) {
      expect(fs.existsSync(path.join(process.cwd(), rel)), `${rel} must be retained`).toBe(true);
    }
  });

  it("the Visa 10.4 CE 3.0 anchor is still recognised in the reason-code catalog", () => {
    const catalog = fs.readFileSync(
      path.join(process.cwd(), "lib", "disputes", "reasonCodeCatalog.ts"),
      "utf8",
    );
    expect(catalog).toContain("ce30_eligible");
    expect(catalog).toMatch(/export function isCE30AnchorCode\b/);
  });
});

/**
 * The 2026-08-04 decision this retirement must NOT reopen.
 *
 * `reasonCodeModule.allowedFactCategories` stays. It is why P4-as-specced was
 * stopped (0 of 76 packs identical), and the argument plan CONSUMES it rather
 * than replacing it. Asserted here because P-4 and that decision are one
 * paragraph apart in the epic brief and are easy to conflate.
 */
describe("the allowedFactCategories decision is not reopened", () => {
  it("every reason-code module still declares an allow-list", () => {
    const registry = path.join(process.cwd(), "lib", "defence", "reasonCodes");
    const modules = fs
      .readdirSync(registry)
      .filter((f) => f.endsWith(".ts") && f !== "registry.ts" && f !== "familyRegistry.ts");
    expect(modules.length).toBeGreaterThan(0);
    for (const file of modules) {
      const text = fs.readFileSync(path.join(registry, file), "utf8");
      expect(text, `${file} lost its allow-list`).toContain("allowedFactCategories");
    }
  });

  it("the argument plan consumes the allow-list rather than declaring its own", () => {
    const plan = fs.readFileSync(
      path.join(process.cwd(), "lib", "argument", "plan", "deriveArgumentPlan.ts"),
      "utf8",
    );
    expect(plan).toContain("allowedFactCategories");
    expect(plan).toMatch(/does\s*\n?\s*\*?\s*not replace it/);
  });
});
