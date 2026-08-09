import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ONE OWNER for AVS / CVV semantics — the class-closing invariant of PR-C2,
 * extended by PR-C3 to the (network, code) map.
 *
 * The defect this test exists to prevent is not "a bug in the match set". It
 * is a SECOND match set. Before the split there were six, kept aligned by
 * comments that said "keep these in lockstep", and two had already drifted.
 *
 * A per-site fix would have corrected the drift and left the class open. This
 * fails the build the next time anyone re-derives the rules locally — in any
 * of the shapes a rule can take: a set, a membership list, an `if`, a
 * `switch`, a lookup map, or a sentence in prompt policy.
 *
 * INTERPRETATION IS BANNED; DISPLAY IS NOT. A raw code may still be shown to a
 * merchant for audit (`Full match (Y)`), interpolated into a diagnostic, or
 * matched by a validator's character class. What it may not do is DECIDE
 * anything outside the canonical layer.
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
 * this file passed while three consumers were still interpreting letters, and
 * the second missed a two-letter citation set.
 */

const AVS_LETTERS = ["Y", "A", "W", "X", "D", "M", "Z", "N", "C", "U", "S", "R", "G", "E"];

function isAvsLetter(letter: string): boolean {
  return AVS_LETTERS.includes(letter);
}

/**
 * A duplicate code SET. TWO letters is already a set — `new Set(["Y", "M"])`
 * is exactly what someone reaches for when they want "just the citable codes"
 * without asking the map, and it is wrong the moment the map gains a network.
 */
export function findMatchSetLiterals(text: string): string[] {
  const out: string[] = [];
  for (const match of text.match(/new Set\(\s*\[[^\]]*\]\s*\)/g) ?? []) {
    const letters = (match.match(/["']([A-Z])["']/g) ?? []).map((s) => s.replace(/["']/g, ""));
    if (letters.filter(isAvsLetter).length >= 2) out.push(match);
  }
  return out;
}

/** A re-declared, named code set. */
export function findNamedCodeSets(text: string): string[] {
  return text.match(/const\s+(AVS|CVV)_[A-Z_]*(MATCH|CODES)/g) ?? [];
}

/**
 * Membership against a letter list — `["Y", "M"].includes(v.avs.code)`. A set
 * spelled as an array is still a set.
 */
export function findMembershipChecks(text: string): string[] {
  const out: string[] = [];
  const MEMBERSHIP =
    /\[\s*(?:["'][A-Za-z]["']\s*,\s*)*["'][A-Za-z]["']\s*\]\s*\.\s*(?:includes|indexOf|some)\s*\(/g;
  for (const match of text.match(MEMBERSHIP) ?? []) {
    const letters = (match.match(/["']([A-Z])["']/g) ?? []).map((s) => s.replace(/["']/g, ""));
    if (letters.some(isAvsLetter)) out.push(match);
  }
  return out;
}

/**
 * A branch on a raw code — `v.avs.code === "A"`, `avsResult === "Y"`,
 * `payload.cvvResultCode !== "M"`.
 */
export function findRawCodeBranches(text: string): string[] {
  const RAW_BRANCH =
    /\b(avs|cvv)[A-Za-z]*(?:\.code)?\s*(?:\.toUpperCase\(\))?\s*[!=]==\s*["'][A-Za-z]["']/gi;
  return text.match(RAW_BRANCH) ?? [];
}

/**
 * A `switch` whose subject is a raw code. Its `case "Y":` arms are the same
 * interpretation as an `if`, wearing different syntax. Switching on the
 * NORMALIZED result is the correct shape and does not match.
 */
export function findCodeSwitches(text: string): string[] {
  const SWITCH = /switch\s*\(\s*[^)]*\b(?:avs|cvv)[A-Za-z]*(?:\.code|Result(?:Code)?)\b[^)]*\)/gi;
  return text.match(SWITCH) ?? [];
}

/**
 * An object literal keyed by code letters — a label map, a tone map, any
 * lookup. TWO keys is enough: `{ Y: "cite", M: "cite" }` is a citation table.
 * Quoted keys count; that is the same map with different punctuation.
 */
export function findLetterKeyedMaps(text: string): string[] {
  // A letter-keyed map is an AVS map only when it sits NEXT TO AVS/CVV
  // context. Unrelated single-letter keys are common (content tiers keyed
  // A/B/C, grade bands), and flagging those would earn this invariant an
  // exemption list — which is how a rule quietly stops being enforced.
  const context: number[] = [];
  const MENTION = /avs|cvv/gi;
  let mention: RegExpExecArray | null;
  while ((mention = MENTION.exec(text)) !== null) context.push(mention.index);
  if (context.length === 0) return [];

  const hits: Array<{ index: number; letter: string }> = [];
  const KEY = /[{,]\s*["']?([A-Z])["']?\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = KEY.exec(text)) !== null) {
    if (isAvsLetter(m[1])) hits.push({ index: m.index, letter: m[1] });
  }
  for (let i = 0; i < hits.length; i += 1) {
    const window = hits.filter((h) => h.index >= hits[i].index && h.index - hits[i].index < 400);
    if (new Set(window.map((h) => h.letter)).size < 2) continue;
    const near = context.some((c) => Math.abs(c - hits[i].index) < 600);
    if (near) return [text.slice(hits[i].index, hits[i].index + 80).replace(/\s+/g, " ")];
  }
  return [];
}

/**
 * A raw-code RULE written in prose — prompt policy, a predicate description, a
 * comment that restates the rule. Both the terse syntax (`avsResult='Y'`) and
 * the sentence form ("full AVS match (Y) AND CVV match (M)") are the same
 * defect: a second definition of the rule, somewhere nothing keeps in step
 * with the map.
 *
 * DISPLAY IS NOT INTERPRETATION. An interpolated code (`AVS ${a}`), an i18n
 * placeholder (`AVS {avs}`) and a validator's character class (`[YNXAZW]`)
 * all pass — they show or police what the gateway returned without deciding
 * what it means. Only a BARE literal letter next to AVS/CVV matches.
 */
export function findRawCodePolicyStrings(text: string): string[] {
  const out: string[] = [];
  out.push(...(text.match(/(avs|cvv)Result(?:Code)?\s*=\s*["'][A-Za-z]["']/gi) ?? []));

  const PROSE = /\b(?:AVS|CVV)\b[^\n]{0,40}?[('" ]([A-Z])[)'" ,.]/g;
  let m: RegExpExecArray | null;
  while ((m = PROSE.exec(text)) !== null) {
    if (isAvsLetter(m[1])) out.push(m[0].trim());
  }
  return out;
}

/**
 * Structural detectors run over ALL of `lib/`, `app/`, `components/`: a code
 * set, a membership list, a branch, a switch or a lookup map is an
 * interpretation wherever it lives.
 */
const STRUCTURAL_DETECTORS: Array<{ name: string; run: (text: string) => string[] }> = [
  { name: "match-set literal", run: findMatchSetLiterals },
  { name: "named code set", run: findNamedCodeSets },
  { name: "membership check", run: findMembershipChecks },
  { name: "raw-code branch", run: findRawCodeBranches },
  { name: "code switch", run: findCodeSwitches },
  { name: "letter-keyed map", run: findLetterKeyedMaps },
];

/**
 * The prose detector is scoped to the layers where AVS meaning DECIDES
 * something — evidence, defence, packs, automation, and the merchant/portal
 * surfaces that render their output. Deliberately out: `lib/resources`
 * (Resources-Hub article generation, which writes ABOUT chargebacks) and
 * `app/admin` (analytics legends displaying Shopify's raw code distribution).
 * Those describe or display; they decide nothing about a case. Scoping the
 * rule once, in the open, is honest where per-file exemptions would not be.
 */
const POLICY_ROOTS = [
  path.join("lib", "argument"),
  path.join("lib", "defence"),
  path.join("lib", "evidence"),
  path.join("lib", "packs"),
  path.join("lib", "automation"),
  path.join("app", "(embedded)"),
  path.join("components", "packs"),
];

function isPolicyLayer(rel: string): boolean {
  return POLICY_ROOTS.some((root) => rel.startsWith(root));
}

describe("AVS / CVV match rules have exactly one definition", () => {
  it("no source file outside the owner interprets a raw code, in any shape", () => {
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      for (const detector of STRUCTURAL_DETECTORS) {
        for (const hit of detector.run(text)) {
          offenders.push(`${rel} [${detector.name}]: ${hit.slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no decision-layer prose restates a raw-code rule", () => {
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      if (!isPolicyLayer(rel)) continue;
      for (const hit of findRawCodePolicyStrings(text)) {
        offenders.push(`${rel}: ${hit.slice(0, 70)}`);
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
      if (/normalizeAvsCode\(\s*"/.test(text)) offenders.push(`${rel}: literal network`);
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
    expect(owner).toContain("CVV_SCORING_MATCH");
    expect(owner).not.toContain("AVS_SCORING_MATCH");
    expect(map).toContain("BASE_AVS_TABLE");
    expect(map).toContain("CE_ITEM_3_CODES");
  });
});

/**
 * THE DETECTORS MUST BITE.
 *
 * Every case below is a shape that was live in this repo, or the near-miss
 * variant of one, and passed an earlier version of this invariant. A detector
 * that cannot catch the defect it was written for is worse than no detector:
 * it reports the class closed.
 */
describe("the invariant catches the shapes that slipped through", () => {
  it("catches a TWO-letter citation set", () => {
    expect(findMatchSetLiterals('const CITABLE = new Set(["Y", "M"]);')).not.toEqual([]);
    expect(findMatchSetLiterals("const CITABLE = new Set(['Y', 'M']);")).not.toEqual([]);
  });

  it("catches a membership check against a letter list", () => {
    expect(findMembershipChecks('if (["Y", "M"].includes(v.avs.code)) cite();')).not.toEqual([]);
    expect(findMembershipChecks('if (["Y"].includes(code)) cite();')).not.toEqual([]);
    expect(findMembershipChecks('["Y", "M"].indexOf(code) >= 0')).not.toEqual([]);
  });

  it("catches a switch on a raw code", () => {
    const shape = `
      switch (v.avs.code) {
        case "Y":
        case "M":
          return "citable";
        default:
          return "internal";
      }`;
    expect(findCodeSwitches(shape)).not.toEqual([]);
    expect(findCodeSwitches("switch (payload.avsResultCode) { case \"Y\": break; }")).not.toEqual([]);
  });

  it("catches the line-item copy branching on a letter (evidenceLineItem.ts)", () => {
    const shape = `
      if (v.addressVerified) {
        if (v.avs.code === "A") return { key: \`\${REASONS_NS}.avsCvv.streetMatched\` };
        if (v.avs.code === "W") return { key: \`\${REASONS_NS}.avsCvv.postalMatched\` };
      }`;
    expect(findRawCodeBranches(shape).length).toBeGreaterThanOrEqual(2);
  });

  it("catches a letter-keyed map — five keys, two keys, and quoted keys", () => {
    // The detector only looks at files that mention AVS/CVV at all, so an
    // unrelated single-letter map elsewhere in the app is not a false
    // positive. These fixtures carry that context, as the real sites did.
    expect(
      findLetterKeyedMaps(`
      function avsLabel(code: string | undefined): string {
        const map: Record<string, string> = {
          Y: "Full match",
          A: "Address match only",
          Z: "ZIP match only",
          N: "No match",
          U: "Unavailable",
        };
        return map[code] ?? code;
      }`),
    ).not.toEqual([]);
    expect(findLetterKeyedMaps('// avs citation table\nconst citable = { Y: true, M: true };')).not.toEqual(
      [],
    );
    expect(
      findLetterKeyedMaps('// avs citation table\nconst citable = { "Y": true, "M": true };'),
    ).not.toEqual([]);
  });

  it("does not read an unrelated single-letter map as a code table", () => {
    // Content tiers, grade bands, anything keyed A/B/C in a file that has
    // nothing to do with card verification.
    const unrelated = `
      const TIERS = {
        A: { base: [3500, 5000], ceiling: 6000 },
        B: { base: [2000, 3000], ceiling: 4000 },
        C: { base: [1200, 1800], ceiling: 2400 },
      };`;
    expect(findLetterKeyedMaps(unrelated)).toEqual([]);
  });

  it("catches a raw-code rule in prompt policy — terse AND sentence form", () => {
    expect(
      findRawCodePolicyStrings(
        `"When AVS+CVV both match (avsResult='Y' AND cvvResult='M'), describe them."`,
      ),
    ).not.toEqual([]);
    expect(
      findRawCodePolicyStrings(
        '"payment_authentication with a full AVS match (Y) AND a CVV match (M)"',
      ),
    ).not.toEqual([]);
    expect(findRawCodePolicyStrings('// the rule requires an AVS match of Y or M')).not.toEqual([]);
    expect(findRawCodePolicyStrings(`// patterns match "AVS Y" and "AVS result of 'Y'"`)).not.toEqual(
      [],
    );
  });

  it("still catches the shapes it caught before", () => {
    expect(findMatchSetLiterals('const S = new Set(["Y", "A", "W", "X", "D", "M"]);')).not.toEqual(
      [],
    );
    expect(findNamedCodeSets("const AVS_MATCH_CODES = x;")).not.toEqual([]);
    expect(findRawCodeBranches('if (avsResult === "Y") {}')).not.toEqual([]);
    expect(findRawCodeBranches('if (payload.cvvResultCode !== "M") {}')).not.toEqual([]);
  });

  it("does not fire on canonical usage, or on audit DISPLAY of a raw code", () => {
    const clean = `
      const v = readPaymentVerification(payload);
      switch (v.avs.normalized) {
        case "street_match": return streetMatched;
        case "postal_match": return postalMatched;
        default: return addressMatched;
      }
      const words: Record<AvsNormalizedResult, string> = {
        full_match: "Full match",
        street_match: "Street address matched",
        no_match: "No match",
      };
      if (v.network === "visa" && v.citableAddressVerified) cite();
      // Audit display: the code is SHOWN, and decides nothing.
      const label = \`\${words[v.avs.normalized]} (\${v.avs.code})\`;
      const sentence = t("internalSignals.avsCvvMismatch.resultAvsFailCvvMatch", {
        avs: v.avs.code ?? "",
        cvv: v.cvv.code ?? "",
      });
      // A validator policing raw codes in prose uses a character class.
      const FORBIDDEN = /\\bAVS\\s+['"]?[YNXAZWPSGIMNCDU]['"]?\\b/i;`;

    for (const detector of [...STRUCTURAL_DETECTORS, { name: "prose", run: findRawCodePolicyStrings }]) {
      expect({ [detector.name]: detector.run(clean) }).toEqual({ [detector.name]: [] });
    }
  });
});
