import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ONE OWNER for AVS / CVV semantics — the class-closing invariant of PR-C2,
 * extended by PR-C3 to the (network, code) map.
 *
 * The defect this test exists to prevent is not "a bug in the match set". It
 * is a SECOND match set. Before the split there were six, kept aligned by
 * comments that said "keep these in lockstep", and two had already drifted.
 *
 * WHY AN AST, NOT MORE REGEX. Three regex generations each closed the shapes
 * they had seen and missed the next one: a typed `new Set<string>([...])`, a
 * named constant plus `.includes`, a reversed comparison, a switch on a
 * destructured alias. Every miss reported the class closed. A structural scan
 * asks what the code DOES — declares a code list, tests membership, compares a
 * code, switches on one, keys a map by letters — instead of how it happens to
 * be spelled.
 *
 * THE BOUNDARY, unchanged: decisions on the CANONICAL NORMALIZED result are
 * the correct shape and never fire. Raw codes may still be displayed to a
 * merchant, interpolated into a diagnostic, matched by a validator's character
 * class, or written out in test fixtures. What a raw code may not do is DECIDE
 * anything outside the canonical layer.
 */

const OWNER = path.join("lib", "argument", "paymentVerification.ts");
/** The AVS half of the owner: the canonical (network, code) map (PR-C3). */
const AVS_MAP = path.join("lib", "argument", "avsCodeMap.ts");

/**
 * Scope: the application code that decides evidence semantics. `scripts/` is
 * deliberately out — plain `.mjs` ops and preview tooling with no import path
 * to a TypeScript module, reaching neither a merchant surface nor an issuer.
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

/* ── The structural scanner ─────────────────────────────────────────────── */

const AVS_LETTERS = new Set(["Y", "A", "W", "X", "D", "M", "Z", "N", "C", "U", "S", "R", "G", "E"]);

/** Field names that hold a raw gateway code. */
const RAW_CODE_FIELD = /^(avs|cvv)Result(Code)?$/i;
/** An object path that is a verification subfact: `v.avs`, `verification.cvv`. */
const SUBFACT_PATH = /(^|\.)(avs|cvv)$/i;

export interface Finding {
  kind:
    | "code-list"
    | "membership"
    | "comparison"
    | "switch"
    | "letter-map";
  snippet: string;
  line: number;
}

function isSingleLetter(value: string): boolean {
  return value.length === 1 && AVS_LETTERS.has(value.toUpperCase());
}

function stringLiteralsOf(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** An array literal (possibly `as const`) of single code letters. */
function asCodeListLiteral(node: ts.Expression | undefined): string[] | null {
  if (!node) return null;
  let expr = node;
  while (ts.isAsExpression(expr) || ts.isParenthesizedExpression(expr)) expr = expr.expression;

  if (ts.isNewExpression(expr) && expr.expression.getText() === "Set") {
    // Covers `new Set([...])` AND `new Set<string>([...])` — the type
    // argument is a sibling of the argument list, not part of it.
    const arg = expr.arguments?.[0];
    return arg ? asCodeListLiteral(arg) : null;
  }
  if (!ts.isArrayLiteralExpression(expr)) return null;

  const letters = expr.elements.map((e) => (ts.isStringLiteralLike(e) ? e.text : null));
  if (letters.some((l) => l === null)) return null;
  const values = letters as string[];
  if (values.length === 0 || !values.every(isSingleLetter)) return null;
  return values;
}

/**
 * Does this expression read a RAW gateway code?
 *   `v.avs.code`, `verification.cvv.code`, `payload.avsResultCode`,
 *   `avsResult`, or a local alias of any of those.
 */
function isRawCodeAccess(expr: ts.Expression, aliases: ReadonlySet<string>): boolean {
  let node: ts.Expression = expr;
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) node = node.expression;

  if (ts.isIdentifier(node)) {
    return RAW_CODE_FIELD.test(node.text) || aliases.has(node.text);
  }
  if (ts.isPropertyAccessExpression(node)) {
    const name = node.name.text;
    if (RAW_CODE_FIELD.test(name)) return true;
    if (name === "code") return SUBFACT_PATH.test(node.expression.getText());
    return false;
  }
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    if (ts.isStringLiteralLike(arg) && RAW_CODE_FIELD.test(arg.text)) return true;
  }
  return false;
}

/**
 * Structural scan of one file.
 *
 * Pass 1 collects the two kinds of local binding that make a later
 * interpretation invisible to a textual scan: identifiers bound to a code
 * LIST, and identifiers that ALIAS a raw code (including the destructured
 * `const { code } = v.avs`).
 */
export function scanSource(text: string, fileName = "scan.ts"): Finding[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const codeLists = new Set<string>();
  const aliases = new Set<string>();

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name)) {
        if (asCodeListLiteral(node.initializer)) codeLists.add(node.name.text);
        else if (node.initializer && isRawCodeAccess(node.initializer, aliases)) {
          aliases.add(node.name.text);
        }
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        SUBFACT_PATH.test(node.initializer.getText())
      ) {
        // `const { code } = v.avs;`
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name;
          if (ts.isIdentifier(property) && property.text === "code" && ts.isIdentifier(element.name)) {
            aliases.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const findings: Finding[] = [];
  const add = (kind: Finding["kind"], node: ts.Node): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({
      kind,
      line: line + 1,
      snippet: node.getText(source).replace(/\s+/g, " ").slice(0, 90),
    });
  };

  /** AVS/CVV mentions, for the letter-map proximity rule. */
  const mentions: number[] = [];
  const MENTION = /avs|cvv/gi;
  let mention: RegExpExecArray | null;
  while ((mention = MENTION.exec(text)) !== null) mentions.push(mention.index);

  const visit = (node: ts.Node): void => {
    // 1. A declared code list — typed or untyped Set, array, `as const`, and
    //    any identifier whose NAME carries the AVS/CVV context.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const list = asCodeListLiteral(node.initializer);
      if (list && (list.length >= 2 || /avs|cvv/i.test(node.name.text))) {
        add("code-list", node);
      }
    }
    if (ts.isNewExpression(node) && node.expression.getText() === "Set") {
      const list = asCodeListLiteral(node);
      if (list && list.length >= 2) add("code-list", node);
    }

    // 2. Membership — on a literal list, on a declared code list, or with a
    //    raw code as the ARGUMENT (which makes any receiver an interpretation).
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (["includes", "indexOf", "some", "has"].includes(method)) {
        const receiver = node.expression.expression;
        const receiverIsCodeList =
          asCodeListLiteral(receiver as ts.Expression) !== null ||
          (ts.isIdentifier(receiver) && codeLists.has(receiver.text));
        const argIsRawCode = node.arguments.some(
          (a) => ts.isExpression(a) && isRawCodeAccess(a, aliases),
        );
        if (receiverIsCodeList || argIsRawCode) add("membership", node);
      }
    }

    // 3. Comparison against a code letter, in EITHER operand order.
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const isEquality =
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken;
      if (isEquality) {
        const sides = [node.left, node.right];
        const literal = sides.find((s) => ts.isStringLiteralLike(s) && isSingleLetter(s.text));
        const other = sides.find((s) => s !== literal);
        if (literal && other && isRawCodeAccess(other, aliases)) add("comparison", node);
      }
    }

    // 4. A switch whose subject is a raw code — direct or via an alias.
    if (ts.isSwitchStatement(node) && isRawCodeAccess(node.expression, aliases)) {
      add("switch", node.expression);
    }

    // 5. An object literal keyed by code letters. Requires AVS/CVV context
    //    NEARBY: unrelated single-letter maps (content tiers keyed A/B/C) are
    //    not code tables, and exempting those by path is how a rule quietly
    //    stops being enforced.
    if (ts.isObjectLiteralExpression(node)) {
      const keys = node.properties
        .map((p) => {
          const name = p.name;
          if (!name) return null;
          if (ts.isIdentifier(name)) return name.text;
          if (ts.isStringLiteralLike(name)) return name.text;
          return null;
        })
        .filter((k): k is string => k !== null && isSingleLetter(k));
      if (new Set(keys).size >= 2) {
        const start = node.getStart(source);
        if (mentions.some((m) => Math.abs(m - start) < 600)) add("letter-map", node);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return findings;
}

describe("AVS / CVV code semantics exist in exactly one place", () => {
  it("no source file outside the owner interprets a raw code", () => {
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      for (const finding of scanSource(text, rel)) {
        offenders.push(`${rel}:${finding.line} [${finding.kind}] ${finding.snippet}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no decision-layer prose restates a raw-code rule", () => {
    // The one textual check that remains: policy written in English. An AST
    // cannot see inside a prompt string, and a rule spelled out in a sentence
    // is still a second definition of the rule.
    const POLICY_ROOTS = [
      path.join("lib", "argument"),
      path.join("lib", "defence"),
      path.join("lib", "evidence"),
      path.join("lib", "packs"),
      path.join("lib", "automation"),
      path.join("app", "(embedded)"),
      path.join("components", "packs"),
    ];
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      if (!POLICY_ROOTS.some((root) => rel.startsWith(root))) continue;
      for (const hit of findRawCodePolicyStrings(text)) offenders.push(`${rel}: ${hit.slice(0, 70)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no AVS normalization omits the network (PR-C3)", () => {
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
 * A raw-code RULE written in prose — prompt policy, a predicate description, a
 * comment restating the rule. The terse form (`avsResult='Y'`) and the
 * sentence form ("full AVS match (Y) AND CVV match (M)") are the same defect.
 *
 * DISPLAY IS NOT INTERPRETATION: an interpolated code, an i18n placeholder and
 * a validator's character class all pass.
 */
export function findRawCodePolicyStrings(text: string): string[] {
  const out: string[] = [];
  out.push(...(text.match(/(avs|cvv)Result(?:Code)?\s*=\s*["'][A-Za-z]["']/gi) ?? []));

  const PROSE = /\b(?:AVS|CVV)\b[^\n]{0,40}?[('" ]([A-Z])[)'" ,.]/g;
  let m: RegExpExecArray | null;
  while ((m = PROSE.exec(text)) !== null) {
    if (AVS_LETTERS.has(m[1])) out.push(m[0].trim());
  }
  return out;
}

/**
 * THE SCANNER MUST BITE.
 *
 * Every shape below defeated an earlier generation of this invariant while it
 * reported the class closed. A detector that cannot catch the defect it was
 * written for is worse than none.
 */
describe("the scanner catches every shape a code rule takes", () => {
  const kinds = (src: string) => scanSource(src).map((f) => f.kind);

  it("catches a TYPED Set declaration", () => {
    expect(kinds('const CITABLE = new Set<string>(["Y", "M"]);')).toContain("code-list");
    expect(kinds('const CITABLE = new Set(["Y", "M"]);')).toContain("code-list");
    expect(kinds('const S: ReadonlySet<string> = new Set<string>(["Y"]);')).not.toContain(
      "membership",
    );
  });

  it("catches a named constant list plus membership", () => {
    const shape = `
      const CITABLE_AVS_CODES = ["Y", "M"] as const;
      if (CITABLE_AVS_CODES.includes(v.avs.code)) cite();`;
    const found = kinds(shape);
    expect(found).toContain("code-list");
    expect(found).toContain("membership");
  });

  it("catches a REVERSED comparison", () => {
    expect(kinds('if ("Y" === v.avs.code) cite();')).toContain("comparison");
    expect(kinds('if (v.avs.code === "Y") cite();')).toContain("comparison");
    expect(kinds('if ("M" !== payload.cvvResultCode) hold();')).toContain("comparison");
  });

  it("catches a switch on a DESTRUCTURED alias", () => {
    const shape = `
      const { code } = v.avs;
      switch (code) {
        case "Y":
          cite();
          break;
      }`;
    expect(kinds(shape)).toContain("switch");
  });

  it("catches a switch on a simple alias and on the direct property", () => {
    expect(kinds('const c = v.avs.code;\nswitch (c) { case "Y": cite(); }')).toContain("switch");
    expect(kinds('switch (v.avs.code) { case "Y": cite(); }')).toContain("switch");
    expect(kinds('switch (payload.avsResultCode) { case "M": cite(); }')).toContain("switch");
  });

  it("catches membership via indexOf, some and has", () => {
    expect(kinds('["Y", "M"].indexOf(v.avs.code) >= 0')).toContain("membership");
    expect(kinds('["Y", "M"].some((c) => c === v.avs.code)')).toContain("membership");
    expect(kinds('const S = new Set(["Y", "M"]);\nS.has(v.avs.code);')).toContain("membership");
  });

  it("catches an alias comparison and an aliased list", () => {
    expect(kinds('const c = v.avs.code;\nif (c === "Y") cite();')).toContain("comparison");
    expect(kinds('const codes = ["Y", "M"];\nif (codes.includes(x)) cite();')).toContain(
      "membership",
    );
  });

  it("catches a letter-keyed map — five keys, two keys, quoted keys", () => {
    expect(
      kinds(`
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
    ).toContain("letter-map");
    expect(kinds('// avs\nconst citable = { Y: true, M: true };')).toContain("letter-map");
    expect(kinds('// avs\nconst citable = { "Y": true, "M": true };')).toContain("letter-map");
  });

  it("catches a raw-code rule in prose — terse AND sentence form", () => {
    expect(
      findRawCodePolicyStrings(`"both match (avsResult='Y' AND cvvResult='M'), describe them."`),
    ).not.toEqual([]);
    expect(findRawCodePolicyStrings('"a full AVS match (Y) AND a CVV match (M)"')).not.toEqual([]);
    expect(findRawCodePolicyStrings("// requires an AVS match of Y or M")).not.toEqual([]);
  });

  /* ── Clean controls: the allowed shapes must never fire ── */

  it("allows decisions on the canonical NORMALIZED result", () => {
    expect(
      kinds(`
      const v = readPaymentVerification(payload);
      switch (v.avs.normalized) {
        case "street_match": return streetMatched;
        case "postal_match": return postalMatched;
        default: return addressMatched;
      }
      if (v.citableAddressVerified && v.securityCodeVerified) cite();
      if (v.avs.normalized === "no_match") warn();`),
    ).toEqual([]);
  });

  it("allows DISPLAY, interpolation and validation of a raw code", () => {
    expect(
      kinds(`
      const label = \`\${words[v.avs.normalized]} (\${v.avs.code})\`;
      const sentence = t("internalSignals.avsCvvMismatch.resultAvsFailCvvMatch", {
        avs: v.avs.code ?? "",
        cvv: v.cvv.code ?? "",
      });
      const FORBIDDEN = /\\bAVS\\s+['"]?[YNXAZWPSGIMNCDU]['"]?\\b/i;
      const words: Record<AvsNormalizedResult, string> = {
        full_match: "Full match",
        street_match: "Street address matched",
        no_match: "No match",
      };`),
    ).toEqual([]);
  });

  it("does not read an unrelated single-letter map as a code table", () => {
    expect(
      kinds(`
      const TIERS = {
        A: { base: [3500, 5000], ceiling: 6000 },
        B: { base: [2000, 3000], ceiling: 4000 },
        C: { base: [1200, 1800], ceiling: 2400 },
      };`),
    ).toEqual([]);
  });

  it("does not fire on unrelated string comparisons or lists", () => {
    expect(
      kinds(`
      if (network === "visa") cite();
      if (status === "delivered_confirmed") ok();
      const LOCALES = ["en", "de", "es"];
      if (LOCALES.includes(locale)) render();`),
    ).toEqual([]);
  });
});
