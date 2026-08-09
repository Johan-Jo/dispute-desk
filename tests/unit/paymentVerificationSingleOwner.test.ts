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
/** The AVS half of the owner: the canonical (network, code) map (PR-C3). */
const AVS_MAP = path.join("lib", "argument", "avsCodeMap.ts");

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
  return FILES.filter((rel) => rel !== OWNER && rel !== AVS_MAP && !isTestFile(rel)).map((rel) => ({
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

  it("no AVS normalization omits the network (PR-C3)", () => {
    // `normalizeAvsCode` is network-first by signature, so the way to lose the
    // network is to call it with a literal, or to rebuild a payload holding
    // only a code. Both are bans: a bare code normalizes as unknown-network,
    // which silently downgrades a citable Visa result.
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      // normalizeAvsCode("visa", …) with a literal network, outside the map.
      if (/normalizeAvsCode\(\s*"/.test(text)) offenders.push(`${rel}: literal network`);
      // readPaymentVerification({ avsResultCode … }) with no network key —
      // the code-only shape the deleted bucket helpers used.
      const synthetic = text.match(/readPaymentVerification\(\{[^}]*\}/g) ?? [];
      for (const call of synthetic) {
        if (/avsResultCode|avsResult/.test(call) && !/network|cardCompany|cardBrand/.test(call)) {
          offenders.push(`${rel}: ${call.slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the code-only bucket helpers no longer exist", () => {
    const owner = fs.readFileSync(path.join(process.cwd(), OWNER), "utf8");
    expect(owner).not.toMatch(/export function avsBucket\b/);
    expect(owner).not.toMatch(/export function cvvBucket\b/);

    const callers = sourceFiles().filter(({ text }) => /\b(avsBucket|cvvBucket)\s*\(/.test(text));
    expect(callers.map(({ rel }) => rel)).toEqual([]);
  });

  it("the owner and its code map are the only files that name the codes as rules", () => {
    const owner = fs.readFileSync(path.join(process.cwd(), OWNER), "utf8");
    const map = fs.readFileSync(path.join(process.cwd(), AVS_MAP), "utf8");
    // PR-C3 moved AVS semantics into the (network, code) map; the owner keeps
    // the CVV set and stays the only PREDICATE surface.
    expect(owner).toContain("CVV_SCORING_MATCH");
    expect(owner).not.toContain("AVS_SCORING_MATCH");
    expect(map).toContain("BASE_AVS_TABLE");
    expect(map).toContain("CE_ITEM_3_CODES");
  });
});
