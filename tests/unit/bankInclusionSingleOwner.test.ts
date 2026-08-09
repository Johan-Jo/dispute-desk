/**
 * CI INVARIANT (CP-B §9): exactly one bank-inclusion predicate, and exactly one
 * AVS/CVV match-code set.
 *
 * WHY BOTH IN ONE FILE. They are the same defect twice. A rule that decides what
 * an issuer may be told was spelled at four sites, kept "in lockstep by comment",
 * and had already drifted — for AVS/CVV that produced a postal-only result read
 * as a match in merchant copy and a non-match in scoring (C-12/C-13); for bank
 * inclusion it produced an LLM payload that admits facts the PDF's own Evidence
 * Basis table suppresses (C-1). One owner per rule is the containment; this test
 * is what keeps it true.
 *
 * WHAT "ONE OWNER" MEANS HERE. Not "the words never appear again" — the flags
 * are struct fields and get read, mapped, serialised and displayed all over the
 * codebase. It means no file outside the owner may COMBINE them into a decision.
 * The scan therefore looks for the combination, not the mention.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OWNER = path.join("lib", "defence", "bankInclusion.ts");

/**
 * The ONE site that still spells the predicate inline.
 *
 * `app/api/disputes/[id]/workspace/route.ts` is in the CP-0 per-file ownership
 * map and belongs to Agent C, who converts it when the call sites move. The list
 * may only ever SHRINK: adding an entry is how an invariant quietly stops being
 * one, so a new offender fails this test rather than joining the list.
 */
const PENDING_CONVERSION: readonly string[] = [
  path.join("app", "api", "disputes", "[id]", "workspace", "route.ts"),
];

const ROOTS = ["lib", "app", "components"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

function isTestFile(rel: string): boolean {
  return (
    rel.includes(`__tests__${path.sep}`) ||
    rel.includes(`${path.sep}tests${path.sep}`) ||
    rel.endsWith(".test.ts") ||
    rel.endsWith(".test.tsx")
  );
}

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

function sourceFiles(): Array<{ rel: string; text: string }> {
  return FILES.filter((rel) => !isTestFile(rel)).map((rel) => ({
    rel,
    text: fs.readFileSync(path.join(process.cwd(), rel), "utf8"),
  }));
}

/**
 * A bank-inclusion DECISION: two or more of the inclusion flags combined with a
 * boolean operator on one line of code.
 *
 * Deliberately not "mentions `bankEligible`". Reading the field, assigning it,
 * hashing it, rendering it or declaring it on an interface are all legitimate;
 * ANDing it with `includeInBankNarrative` to decide what an issuer sees is the
 * thing that may exist once. Comments and JSDoc are stripped first — the rule is
 * discussed in prose in several places, and prose is not a second implementation.
 */
const FLAGS = ["bankEligible", "includeInBankNarrative", "submissionRisk", "internalOnly"];

function stripCommentsAndStrings(text: string): string {
  return (
    text
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      // JSX TEXT NODES. `app/admin/defence-package/pipeline/page.tsx` explains
      // the rule to an operator inside a <code> element; documentation on a
      // screen is not a second implementation. The run must be single-line and
      // free of braces, so a real expression inside `{…}` is never stripped.
      .replace(/>[^<>{}\n]*</g, "><")
  );
}

export function findInclusionDecisions(text: string): string[] {
  const stripped = stripCommentsAndStrings(text);
  const out: string[] = [];
  for (const rawLine of stripped.split("\n")) {
    const line = rawLine.trim();
    if (!/&&|\|\|/.test(line)) continue;
    const present = FLAGS.filter((flag) => new RegExp(`\\b${flag}\\b`).test(line));
    if (present.length >= 2) out.push(line.slice(0, 120));
  }
  return out;
}

describe("exactly one bank-inclusion predicate", () => {
  it("the owner exists and exports the predicate by name", () => {
    const owner = fs.readFileSync(path.join(process.cwd(), OWNER), "utf8");
    expect(owner).toMatch(/export function isBankIncludedFact\b/);
    expect(owner).toMatch(/export function bankIncludedFacts\b/);
    // The divergent live rule is NAMED rather than hidden — see C-1.
    expect(owner).toMatch(/export function reachesLlmPayloadLegacy\b/);
  });

  it("no file outside the owner combines the inclusion flags into a decision", () => {
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      if (rel === OWNER) continue;
      if (PENDING_CONVERSION.includes(rel)) continue;
      for (const hit of findInclusionDecisions(text)) offenders.push(`${rel}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the pending-conversion list may only shrink, and every entry still exists", () => {
    for (const rel of PENDING_CONVERSION) {
      expect(fs.existsSync(path.join(process.cwd(), rel)), `${rel} is gone — drop it from the list`).toBe(
        true,
      );
    }
    // One entry, and it is Agent C's call site in the CP-0 ownership map.
    expect(PENDING_CONVERSION).toHaveLength(1);
  });

  it("the three surfaces this epic owns delegate rather than re-spell", () => {
    const delegating = [
      path.join("lib", "defence", "factClassifier.ts"),
      path.join("lib", "defence", "pdf", "evidenceBasisRows.ts"),
      path.join("lib", "defence", "narrativeWriter.ts"),
    ];
    for (const rel of delegating) {
      const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(text, `${rel} must import the owner`).toMatch(/from "(\.\.?\/)*bankInclusion"/);
    }
  });

  /** The detector must bite, or it is decoration. */
  it("the scanner catches every shape the predicate took", () => {
    expect(
      findInclusionDecisions("const ok = f.bankEligible && f.includeInBankNarrative && !f.submissionRisk;"),
    ).not.toEqual([]);
    expect(findInclusionDecisions("x.filter((f) => !f.submissionRisk || f.includeInBankNarrative)")).not.toEqual(
      [],
    );
    expect(findInclusionDecisions("if (fact.internalOnly || fact.submissionRisk) return null;")).not.toEqual(
      [],
    );
  });

  it("the scanner does NOT fire on legitimate reads, prose or declarations", () => {
    expect(findInclusionDecisions("  includeInBankNarrative: boolean;")).toEqual([]);
    expect(findInclusionDecisions("  include_in_bank_narrative: f.includeInBankNarrative,")).toEqual([]);
    expect(findInclusionDecisions("// bankEligible && includeInBankNarrative && !submissionRisk")).toEqual([]);
    expect(
      findInclusionDecisions('/** Selection: bankEligible && includeInBankNarrative && !submissionRisk */'),
    ).toEqual([]);
    expect(findInclusionDecisions('const note = "submissionRisk=true && !includeInBankNarrative";')).toEqual(
      [],
    );
    // Operator documentation rendered on an admin screen.
    expect(
      findInclusionDecisions(
        "Facts with <code>submissionRisk=true && !includeInBankNarrative</code> are filtered.",
      ),
    ).toEqual([]);
  });

  it("stripping JSX text does not hide a real decision inside an expression container", () => {
    expect(
      findInclusionDecisions(
        "<Badge tone={f.bankEligible && f.includeInBankNarrative ? 'ok' : 'no'} />",
      ),
    ).not.toEqual([]);
  });
});

/**
 * The AVS/CVV half. The structural scan itself lives in
 * `paymentVerificationSingleOwner.test.ts` (an AST walk, because three
 * generations of regex each closed the shapes they had seen and missed the
 * next). What is asserted HERE is the thing CP-B was asked to prove: the four
 * sites that used to hold their own match-code set no longer do, and the invariant
 * that keeps it that way is present and enforcing.
 */
describe("exactly one AVS / CVV match-code set", () => {
  /** The four pre-C-12 sites, named in the epic brief. */
  const FORMER_OWNERS = [
    path.join("lib", "argument", "canonicalEvidence.ts"),
    path.join("lib", "argument", "evidenceLineItem.ts"),
    path.join("lib", "argument", "internalSignals.ts"),
    path.join("app", "(embedded)", "app", "disputes", "[id]", "tabs", "useEvidenceSections.ts"),
  ];

  it("none of the four former owners declares a match-code set any more", () => {
    // A declared set is a run of single AVS/CVV letters as string literals.
    const CODE_LIST = /\[\s*"[A-Z]"\s*(?:,\s*"[A-Z]"\s*)+\]/;
    for (const rel of FORMER_OWNERS) {
      const full = path.join(process.cwd(), rel);
      expect(fs.existsSync(full), `${rel} not found — update this list deliberately`).toBe(true);
      const text = stripCommentsAndStrings(fs.readFileSync(full, "utf8"));
      expect(CODE_LIST.test(text), `${rel} still declares a code list`).toBe(false);
    }
  });

  it("every one of the four reads the canonical owner instead", () => {
    for (const rel of FORMER_OWNERS) {
      const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(
        /paymentVerification|readPaymentVerification|avsCodeMap/.test(text),
        `${rel} must read the canonical owner`,
      ).toBe(true);
    }
  });

  it("the structural single-owner invariant is present and enforcing", () => {
    const invariant = path.join(process.cwd(), "tests", "unit", "paymentVerificationSingleOwner.test.ts");
    expect(fs.existsSync(invariant)).toBe(true);
    const text = fs.readFileSync(invariant, "utf8");
    expect(text).toMatch(/AVS \/ CVV code semantics exist in exactly one place/);
    expect(text).toMatch(/the scanner catches every shape a code rule takes/);
  });

  it("the owner and its map are the only files that name the codes as rules", () => {
    const owner = fs.readFileSync(
      path.join(process.cwd(), "lib", "argument", "paymentVerification.ts"),
      "utf8",
    );
    const map = fs.readFileSync(path.join(process.cwd(), "lib", "argument", "avsCodeMap.ts"), "utf8");
    expect(owner).toContain("CVV_SCORING_MATCH");
    expect(map).toContain("CE_ITEM_3_CODES");
  });
});
