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

/* ── The detectors ───────────────────────────────────────────────────────
 *
 * Pure functions over source text, so the same code that scans the repo can
 * be fed the exact defect shapes it must catch. A green invariant proves
 * nothing unless the detector is itself proven to bite — the first version of
 * this file passed while three consumers were still interpreting letters.
 */

const AVS_LETTERS = ["Y", "A", "W", "X", "D", "M", "Z", "N", "C"];

/** A `new Set([...])` holding three or more AVS response letters. */
export function findMatchSetLiterals(text: string): string[] {
  const out: string[] = [];
  for (const match of text.match(/new Set\(\s*\[[^\]]*\]\s*\)/g) ?? []) {
    const letters = (match.match(/["']([A-Z])["']/g) ?? []).map((s) => s.replace(/["']/g, ""));
    if (letters.filter((l) => AVS_LETTERS.includes(l)).length >= 3) out.push(match);
  }
  return out;
}

/** A re-declared, named code set. */
export function findNamedCodeSets(text: string): string[] {
  return (text.match(/const\s+(AVS|CVV)_[A-Z_]*(MATCH|CODES)/g) ?? []);
}

/**
 * A branch on a raw code. Covers the property forms the first version missed:
 * `v.avs.code === "A"` and `verification.cvv.code === "M"` as well as
 * `avsResult === "Y"` / `payload.cvvResultCode !== "M"`.
 */
export function findRawCodeBranches(text: string): string[] {
  const RAW_BRANCH =
    /\b(avs|cvv)[A-Za-z]*(?:\.code)?\s*(?:\.toUpperCase\(\))?\s*[!=]==\s*["'][A-Za-z]["']/gi;
  return text.match(RAW_BRANCH) ?? [];
}

/**
 * An object literal keyed by AVS letters — a label map, a tone map, a lookup
 * of any kind. This is how a UI acquires its own opinion about what `Z`
 * means. Detected by proximity: three or more distinct AVS letters used as
 * keys within one small span of text.
 */
export function findLetterKeyedMaps(text: string): string[] {
  const hits: Array<{ index: number; letter: string }> = [];
  const KEY = /[{,]\s*([A-Z])\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = KEY.exec(text)) !== null) {
    if (AVS_LETTERS.includes(m[1])) hits.push({ index: m.index, letter: m[1] });
  }
  const out: string[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const window = hits.filter((h) => h.index >= hits[i].index && h.index - hits[i].index < 400);
    const distinct = new Set(window.map((h) => h.letter));
    if (distinct.size >= 3) {
      out.push(text.slice(hits[i].index, hits[i].index + 80).replace(/\s+/g, " "));
      break;
    }
  }
  return out;
}

/**
 * A raw-code rule restated inside a string — the shape that hid in the
 * strategy prompt: `"…(avsResult='Y' AND cvvResult='M')…"`. Prompt policy is
 * policy; a letter in it is a second definition of the rule that nothing
 * keeps in step with the map.
 */
export function findRawCodeRulesInStrings(text: string): string[] {
  return text.match(/(avs|cvv)Result(?:Code)?\s*=\s*["'][A-Za-z]["']/gi) ?? [];
}

const DETECTORS: Array<{ name: string; run: (text: string) => string[] }> = [
  { name: "match-set literal", run: findMatchSetLiterals },
  { name: "named code set", run: findNamedCodeSets },
  { name: "raw-code branch", run: findRawCodeBranches },
  { name: "letter-keyed map", run: findLetterKeyedMaps },
  { name: "raw-code rule in a string", run: findRawCodeRulesInStrings },
];

describe("AVS / CVV match rules have exactly one definition", () => {
  it("no source file outside the owner interprets a raw code, in any shape", () => {
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      for (const detector of DETECTORS) {
        for (const hit of detector.run(text)) {
          offenders.push(`${rel} [${detector.name}]: ${hit.slice(0, 70)}`);
        }
      }
    }
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

/**
 * THE DETECTORS MUST BITE.
 *
 * Each case below is a verbatim shape that was live in this repo and passed
 * the first version of this invariant. A detector that cannot catch the defect
 * it was written for is worse than no detector: it reports the class closed.
 */
describe("the invariant catches the shapes that slipped through", () => {
  it("catches the line-item copy branching on a letter (evidenceLineItem.ts)", () => {
    const shape = `
      if (v.addressVerified) {
        if (v.avs.code === "A") return { key: \`\${REASONS_NS}.avsCvv.streetMatched\` };
        if (v.avs.code === "W") return { key: \`\${REASONS_NS}.avsCvv.postalMatched\` };
        return { key: \`\${REASONS_NS}.avsCvv.addressMatched\` };
      }`;
    expect(findRawCodeBranches(shape).length).toBeGreaterThanOrEqual(2);
  });

  it("catches a UI label map keyed by AVS letters (EvidenceContentViewer.tsx)", () => {
    const shape = `
      const map: Record<string, string> = {
        Y: "Full match",
        A: "Address match only",
        Z: "ZIP match only",
        N: "No match",
        U: "Unavailable",
      };`;
    expect(findLetterKeyedMaps(shape)).not.toEqual([]);
  });

  it("catches a raw-code rule embedded in prompt policy (auth_signal_stack)", () => {
    const shape =
      `"When AVS+CVV both match (avsResult='Y' AND cvvResult='M'), describe them as the verification credentials."`;
    expect(findRawCodeRulesInStrings(shape)).not.toEqual([]);
  });

  it("still catches the shapes it caught before", () => {
    expect(findMatchSetLiterals('const S = new Set(["Y", "A", "W", "X", "D", "M"]);')).not.toEqual([]);
    expect(findNamedCodeSets("const AVS_MATCH_CODES = x;")).not.toEqual([]);
    expect(findRawCodeBranches('if (avsResult === "Y") {}')).not.toEqual([]);
    expect(findRawCodeBranches('if (payload.cvvResultCode !== "M") {}')).not.toEqual([]);
  });

  it("does not fire on legitimate canonical usage", () => {
    const clean = `
      const v = readPaymentVerification(payload);
      if (v.addressVerified) {
        switch (v.avs.normalized) {
          case "street_match": return streetMatched;
          case "postal_match": return postalMatched;
          default: return addressMatched;
        }
      }
      const words: Record<AvsNormalizedResult, string> = {
        full_match: "Full match",
        street_match: "Street address matched",
        no_match: "No match",
      };
      if (v.network === "visa" && v.citableAddressVerified) cite();`;
    for (const detector of DETECTORS) {
      expect({ [detector.name]: detector.run(clean) }).toEqual({ [detector.name]: [] });
    }
  });
});
