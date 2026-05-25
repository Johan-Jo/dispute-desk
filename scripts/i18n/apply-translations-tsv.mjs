#!/usr/bin/env node
/**
 * Apply a translated TSV (one row per line: dotted-path TAB JSON-encoded-value)
 * into messages/{locale}.json safely.
 *
 * Usage: node scripts/i18n/apply-translations-tsv.mjs <locale> <tsvPath>
 *
 * Safety:
 *   - Reads + parses the JSON catalog first; bails if the file is invalid.
 *   - Only updates leaf-string paths that currently exist in the catalog.
 *   - JSON-encodes/decodes the new value so embedded quotes are handled
 *     correctly (TSV rows look like:  path\t"translated value")
 *   - Reports the count of applied/skipped rows.
 */

import fs from "node:fs";
import path from "node:path";

const [, , locale, tsvPath] = process.argv;
if (!locale || !tsvPath) {
  console.error("usage: apply-translations-tsv.mjs <locale> <tsvPath>");
  process.exit(2);
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const catalogPath = path.join(repoRoot, `messages/${locale}.json`);

const cat = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

function setDeep(obj, dotted, value) {
  const parts = dotted.split(".");
  let n = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (n[p] === undefined || typeof n[p] !== "object" || Array.isArray(n[p])) {
      return false;
    }
    n = n[p];
  }
  const leaf = parts[parts.length - 1];
  if (typeof n[leaf] !== "string") return false;
  n[leaf] = value;
  return true;
}

const lines = fs.readFileSync(tsvPath, "utf8").split(/\r?\n/);
let applied = 0;
let skipped = 0;
for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  const tab = line.indexOf("\t");
  if (tab < 0) {
    console.error(`malformed line (no tab): ${line.slice(0, 80)}`);
    skipped++;
    continue;
  }
  const dotted = line.slice(0, tab);
  const encoded = line.slice(tab + 1);
  let value;
  try {
    value = JSON.parse(encoded);
  } catch (err) {
    console.error(`bad JSON value for ${dotted}: ${err.message}`);
    skipped++;
    continue;
  }
  if (typeof value !== "string") {
    console.error(`non-string value for ${dotted}: ${typeof value}`);
    skipped++;
    continue;
  }
  if (setDeep(cat, dotted, value)) {
    applied++;
  } else {
    console.error(`path not found / not a leaf string: ${dotted}`);
    skipped++;
  }
}

fs.writeFileSync(catalogPath, JSON.stringify(cat, null, 2) + "\n");
console.log(`${locale}: applied ${applied}, skipped ${skipped} (total ${applied + skipped})`);
