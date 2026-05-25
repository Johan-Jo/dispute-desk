#!/usr/bin/env node
/**
 * Term-equivalence guardrail.
 *
 * Reads `scripts/i18n/term-equivalences.json`, which lists groups of
 * i18n key paths that describe the same concept (e.g. FRAUDULENT,
 * the strong/moderate/weak strength label, etc.). For each group, the
 * script asserts that all paths resolve to the SAME string within
 * each locale.
 *
 * Catches the "Bedräglig vs Obehörig transaktion vs Bedräglig
 * transaktion" class of bug — three different translations of the
 * same concept across three namespaces — that the parity guardrail
 * cannot detect (parity only checks key presence + leaf-string typeof).
 *
 * Exit code 0 when clean, 1 when any group diverges. Wired into
 * `scripts/release-verify.mjs`.
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const LOCALES = ["en", "sv", "de", "es", "fr", "pt"];

const equivPath = path.join(
  repoRoot,
  "scripts",
  "i18n",
  "term-equivalences.json",
);
const equiv = JSON.parse(fs.readFileSync(equivPath, "utf8"));

const cats = {};
for (const l of LOCALES) {
  cats[l] = JSON.parse(
    fs.readFileSync(path.join(repoRoot, `messages/${l}.json`), "utf8"),
  );
}

function lookup(obj, dotted) {
  const parts = dotted.split(".");
  let n = obj;
  for (const p of parts) {
    if (n === null || typeof n !== "object" || !(p in n)) return undefined;
    n = n[p];
  }
  return n;
}

const failures = [];

for (const [concept, spec] of Object.entries(equiv)) {
  if (concept.startsWith("$")) continue;
  const paths = spec.paths;
  if (!Array.isArray(paths) || paths.length < 2) continue;

  for (const locale of LOCALES) {
    const values = paths.map((p) => ({
      path: p,
      value: lookup(cats[locale], p),
    }));
    const present = values.filter((v) => typeof v.value === "string");
    if (present.length === 0) continue;
    const distinct = new Set(present.map((v) => v.value));
    if (distinct.size > 1) {
      failures.push({ concept, locale, values: present });
    }
  }
}

if (failures.length === 0) {
  const n = Object.keys(equiv).filter((k) => !k.startsWith("$")).length;
  console.log(
    `i18n equivalences: clean — ${n} concept groups consistent across ${LOCALES.length} locales`,
  );
  process.exit(0);
}

console.error(
  `i18n equivalences: ${failures.length} divergence(s) — same concept rendered differently within a locale`,
);
console.error("");
for (const f of failures) {
  console.error(`  ${f.concept}  (${f.locale})`);
  for (const v of f.values) {
    console.error(`    ${v.path.padEnd(60)} ${JSON.stringify(v.value)}`);
  }
  console.error("");
}
console.error(
  "Fix by reconciling each group to a single canonical term per locale.",
);
console.error(
  "Group definitions: scripts/i18n/term-equivalences.json",
);
process.exit(1);
