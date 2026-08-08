import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ONE OWNER for AVS / CVV semantics — the class-closing invariant of PR-C2.
 *
 * The defect this test exists to prevent is not "a bug in the match set". It
 * is a SECOND match set. Before the split there were six, kept aligned by
 * comments that said "keep these in lockstep", and two of them had already
 * drifted from the scoring rule they claimed to mirror.
 *
 * A per-site fix would have corrected the drift and left the class open. This
 * fails the build the next time anyone re-derives the rules locally.
 */

const OWNER = path.join("lib", "argument", "paymentVerification.ts");

/**
 * Scope: the application code that decides evidence semantics. `scripts/` is
 * deliberately out — it is plain `.mjs` ops and preview tooling with no import
 * path to a TypeScript module, it reaches neither a merchant surface nor an
 * issuer, and pretending otherwise would mean weakening the rule with
 * per-file exemptions instead of stating the boundary once.
 */
const ROOTS = ["lib", "app", "components"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

/** Test files legitimately assert against literal codes. */
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
  return FILES.filter((rel) => rel !== OWNER && !isTestFile(rel)).map((rel) => ({
    rel,
    text: fs.readFileSync(path.join(process.cwd(), rel), "utf8"),
  }));
}

describe("AVS / CVV match rules have exactly one definition", () => {
  it("no second match-code set exists outside the owner", () => {
    // A `new Set([...])` holding three or more AVS response letters is a
    // re-declaration of the scoring set, whatever it is named.
    const SET_LITERAL = /new Set\(\s*\[[^\]]*\]\s*\)/g;
    const offenders: string[] = [];

    for (const { rel, text } of sourceFiles()) {
      for (const match of text.match(SET_LITERAL) ?? []) {
        const letters = (match.match(/"([A-Z])"/g) ?? []).map((s) => s.replace(/"/g, ""));
        const avsish = letters.filter((l) => ["Y", "A", "W", "X", "D", "M", "Z", "N", "C"].includes(l));
        if (avsish.length >= 3) offenders.push(`${rel}: ${match}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no module re-declares the named code sets", () => {
    const offenders = sourceFiles()
      .filter(({ text }) => /const\s+(AVS|CVV)_[A-Z_]*(MATCH|CODES)/.test(text))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it("no consumer branches on a raw AVS or CVV code", () => {
    // `avsResult === "Y"` / `cvvResultCode !== "M"` and the upper-cased
    // variants. Reading a code is fine; DECIDING on one is the owner's job.
    const RAW_BRANCH =
      /(avs|cvv)(_?[Rr]esult(_?[Cc]ode)?)?\s*(\)|\.toUpperCase\(\))?\s*[!=]==\s*"[A-Za-z]"/;
    const offenders = sourceFiles()
      .filter(({ text }) => RAW_BRANCH.test(text))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it("the owner is the only file that names the codes as rules", () => {
    const owner = fs.readFileSync(path.join(process.cwd(), OWNER), "utf8");
    expect(owner).toContain("AVS_SCORING_MATCH");
    expect(owner).toContain("CVV_SCORING_MATCH");
  });
});
