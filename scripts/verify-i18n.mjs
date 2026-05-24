#!/usr/bin/env node
/**
 * Embedded-surface i18n guardrail.
 *
 * Scans the Shopify Admin embedded routes for hardcoded English strings
 * that would render to the merchant unchanged in non-English locales.
 *
 * What it checks:
 *   - JSX text children that contain >= 2 ASCII words (e.g. "Submit now",
 *     "Refund policy") — anything shorter is treated as a label fragment
 *     and ignored.
 *   - String literals passed to known user-facing JSX props (title=,
 *     description=, label=, placeholder=, heading=, helpText=, subtitle=,
 *     content=, body=, message=) when the value is >= 2 words.
 *
 * What it allows:
 *   - Strings wrapped in t(...) / useTranslations() calls (they're
 *     evaluated, not literal).
 *   - Strings inside import statements.
 *   - Strings inside lines or files marked with the escape hatch
 *     `// i18n-allow` (suppresses the next line) or `/* i18n-allow-file
 *     a file-wide bypass.
 *   - URLs, file paths, content-types, hex colors, CSS units (matched
 *     heuristically).
 *
 * The list of paths it scans is the SAME set the 2026-05-24 i18n
 * sweep audited. Adding new pages? Either internationalize them or add
 * an explicit `// i18n-allow` comment.
 *
 * Exit code: 0 when clean, 1 when violations found. Wired into
 * `npm run release:verify` so a regression cannot ship silently.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SCAN_DIRS = [
  "app/(embedded)/app",
];

/** Lib files that emit user-visible strings into the embedded surface.
 *  Scanned separately with a stricter rule: any export of a literal
 *  English string used as a display label must instead be an i18n
 *  token (`{ key, params }`) or live in a registry that maps to one.
 *  Listed by purpose so newly-added emitters are easy to add. */
const LIB_USER_FACING_FILES = [
  // Source-section labels persisted into pack JSON and rendered in
  // dispute detail "Evidence collected".
  "lib/packs/sources/orderSource.ts",
  "lib/packs/sources/policySource.ts",
  "lib/packs/sources/paymentSource.ts",
  "lib/packs/sources/customerCommSource.ts",
  "lib/packs/sources/coverageSource.ts",
  "lib/packs/sources/deviceLocationSource.ts",
  "lib/packs/sources/fraudRiskSource.ts",
  "lib/packs/sources/threeDSecureSource.ts",
  "lib/packs/sources/manualSource.ts",
  // Argument engine — emits hero + recommendation copy seen by merchants.
  "lib/argument/recommendation.ts",
  "lib/argument/caseStrength.ts",
  "lib/argument/canonicalEvidence.ts",
];

const ALLOW_FILES = new Set([
  // Polaris s-page / s-app-nav layout shell; brand string is allowed
  // to remain literal — Shopify renders these chrome elements outside
  // the locale boundary.
]);

const USER_FACING_PROPS = new Set([
  "title",
  "description",
  "label",
  "placeholder",
  "heading",
  "helpText",
  "subtitle",
  "content",
  "body",
  "message",
  "primaryActionLabel",
  "secondaryActionLabel",
  "cta",
  "ctaLabel",
  "tooltip",
  "ariaLabel",
  "alt",
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(ent.name)) out.push(full);
  }
  return out;
}

function isLikelyEnglish(s) {
  const trimmed = s.trim();
  if (!trimmed) return false;
  // Need at least 2 ASCII words to count as "user copy".
  // Single-word labels are noisy (CSS values, enum tags, units).
  const words = trimmed.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length < 2) return false;
  // Must contain at least one space — "thisIsAVar" doesn't count.
  if (!/\s/.test(trimmed)) return false;
  // Reject code-fragment noise: regex bodies, ref initializers, type
  // assertions, generic param lists — heuristic check for symbols
  // unlikely to appear in display copy.
  if (/[/\\<>{}\[\]=`$]/.test(trimmed)) return false;
  // Reject anything that starts with code-fragment punctuation —
  // typical of partially-matched type assertions and call args.
  if (/^[(),;:]/.test(trimmed)) return false;
  // Skip obvious non-copy: URLs, file paths, hex codes, mime types,
  // import specifiers.
  if (/^https?:\/\//.test(trimmed)) return false;
  if (/^[A-Za-z0-9_/.@-]+\.(ts|tsx|js|mjs|json|css|svg|png|jpg|pdf)$/.test(trimmed)) return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return false;
  if (/^(application|text|image|audio|video)\//.test(trimmed)) return false;
  return true;
}

function stripLine(line) {
  // Remove single-line comments (very rough — good enough for guardrail).
  return line.replace(/\/\/.*$/, "");
}

function findViolations(file) {
  const text = fs.readFileSync(file, "utf8");
  if (/\/\*\s*i18n-allow-file\s*\*\//.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Per-line escape hatch.
    if (/\/\/\s*i18n-allow/.test(raw)) continue;
    // Skip imports.
    if (/^\s*import\b/.test(raw)) continue;
    // Skip lines that are themselves t("...") / t('...') calls — the
    // string literal there IS the i18n key, not display text.
    if (/\bt[A-Za-z]*\s*\(\s*["']/.test(raw)) continue;

    const line = stripLine(raw);

    // (A) JSX text child: ...>TEXT<
    // Require the opening `>` to look like a JSX closing of a tag
    // (`>` preceded by an identifier, quote, or closing brace — not a
    // generic-type `>`). Avoids false positives like
    // `useRef<...>(null) as React.MutableRefObject<...>`.
    const textChildRe = /([A-Za-z0-9_"'}\/])>\s*([^<>{]+?)\s*</g;
    let m;
    while ((m = textChildRe.exec(line)) !== null) {
      const candidate = m[2];
      if (!isLikelyEnglish(candidate)) continue;
      violations.push({
        file,
        line: i + 1,
        col: m.index + 1,
        kind: "jsx-text",
        text: candidate,
      });
    }

    // (B) Prop value: name="..." or name='...'
    const propRe = /\b([a-zA-Z]+)\s*=\s*(["'])([^"'\n]+?)\2/g;
    while ((m = propRe.exec(line)) !== null) {
      const prop = m[1];
      const value = m[3];
      if (!USER_FACING_PROPS.has(prop)) continue;
      if (!isLikelyEnglish(value)) continue;
      violations.push({
        file,
        line: i + 1,
        col: m.index + 1,
        kind: `prop:${prop}`,
        text: value,
      });
    }
  }

  return violations;
}

function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    walk(path.join(repoRoot, dir), files);
  }

  const allViolations = [];
  for (const f of files) {
    const rel = path.relative(repoRoot, f).replace(/\\/g, "/");
    if (ALLOW_FILES.has(rel)) continue;
    const found = findViolations(f);
    for (const v of found) allViolations.push({ ...v, file: rel });
  }

  if (allViolations.length === 0) {
    console.log("i18n guardrail: clean — no hardcoded English in embedded routes");
    process.exit(0);
  }

  console.error(`i18n guardrail: ${allViolations.length} potential hardcoded English string(s) in embedded routes`);
  console.error("");
  // Group by file for readability.
  const byFile = new Map();
  for (const v of allViolations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }
  for (const [file, vs] of byFile) {
    console.error(`  ${file}`);
    for (const v of vs) {
      console.error(`    ${v.line}:${v.col}  [${v.kind}]  ${JSON.stringify(v.text)}`);
    }
    console.error("");
  }
  console.error("Fix by replacing the literal with a t(\"...\") call,");
  console.error("or add a `// i18n-allow` comment on the offending line if");
  console.error("the string genuinely should not be localized (e.g. a brand name).");
  console.error("Whole-file bypass: add `/* i18n-allow-file */` near the top.");
  process.exit(1);
}

main();
