#!/usr/bin/env node
/**
 * Phase 0 of the locale consolidation: deep-merge each regional message
 * file (messages/en-US.json, de-DE.json, …) INTO its short-code sibling
 * (messages/en.json, de.json, …), with the regional version winning on
 * any key conflict. The merged short-code files become the new source
 * of truth in Phase 8 when the regional files get deleted.
 *
 * Run: node scripts/merge-locales.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PAIRS = [
  { short: "en", regional: "en-US" },
  { short: "de", regional: "de-DE" },
  { short: "es", regional: "es-ES" },
  { short: "fr", regional: "fr-FR" },
  { short: "pt", regional: "pt-BR" },
  { short: "sv", regional: "sv-SE" },
];

const MESSAGES_DIR = path.resolve(process.cwd(), "messages");

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `regional` onto `short`. Regional wins on every conflict,
 * including primitive overrides and array replacement (we never merge
 * arrays — translation arrays are atomic). Keys present only in `short`
 * are preserved.
 */
function mergeRegionalWins(short, regional) {
  if (!isPlainObject(short) || !isPlainObject(regional)) return regional;
  const out = { ...short };
  for (const [key, regionalVal] of Object.entries(regional)) {
    const shortVal = out[key];
    if (isPlainObject(regionalVal) && isPlainObject(shortVal)) {
      out[key] = mergeRegionalWins(shortVal, regionalVal);
    } else {
      out[key] = regionalVal;
    }
  }
  return out;
}

function countLeafKeys(obj, prefix = "") {
  let n = 0;
  if (!isPlainObject(obj)) return prefix ? 1 : 0;
  for (const [k, v] of Object.entries(obj)) {
    n += isPlainObject(v) ? countLeafKeys(v, `${prefix}.${k}`) : 1;
  }
  return n;
}

function topLevelKeys(obj) {
  return Object.keys(obj).sort();
}

const summary = [];
let exitCode = 0;

for (const { short, regional } of PAIRS) {
  const shortPath = path.join(MESSAGES_DIR, `${short}.json`);
  const regionalPath = path.join(MESSAGES_DIR, `${regional}.json`);

  let shortContent;
  let regionalContent;
  try {
    shortContent = JSON.parse(readFileSync(shortPath, "utf8"));
    regionalContent = JSON.parse(readFileSync(regionalPath, "utf8"));
  } catch (err) {
    console.error(`[merge] FAIL ${short}↔${regional}:`, err.message);
    exitCode = 1;
    continue;
  }

  const beforeShortKeys = countLeafKeys(shortContent);
  const beforeRegionalKeys = countLeafKeys(regionalContent);
  const beforeShortTop = topLevelKeys(shortContent);
  const beforeRegionalTop = topLevelKeys(regionalContent);
  const addedTopLevel = beforeRegionalTop.filter((k) => !beforeShortTop.includes(k));

  const merged = mergeRegionalWins(shortContent, regionalContent);
  const afterKeys = countLeafKeys(merged);

  writeFileSync(shortPath, JSON.stringify(merged, null, 2) + "\n", "utf8");

  summary.push({
    pair: `${short} ← ${regional}`,
    shortKeysBefore: beforeShortKeys,
    regionalKeys: beforeRegionalKeys,
    keysAfter: afterKeys,
    keysGained: afterKeys - beforeShortKeys,
    newTopLevel: addedTopLevel,
  });
}

console.log("\nMerge summary (regional → short, regional wins on conflict):\n");
for (const row of summary) {
  console.log(`  ${row.pair}`);
  console.log(`    short keys before: ${row.shortKeysBefore}`);
  console.log(`    regional keys:     ${row.regionalKeys}`);
  console.log(`    short keys after:  ${row.keysAfter}  (+${row.keysGained})`);
  if (row.newTopLevel.length > 0) {
    console.log(`    new top-level:     ${row.newTopLevel.join(", ")}`);
  }
  console.log();
}

process.exit(exitCode);
