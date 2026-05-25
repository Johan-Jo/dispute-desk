#!/usr/bin/env node
/**
 * i18n locale-parity guardrail.
 *
 * Walks `messages/en.json` (the canonical catalog) and asserts every
 * leaf-string key path exists as a leaf string in the other five
 * locale files (`de.json`, `es.json`, `fr.json`, `pt.json`,
 * `sv.json`).
 *
 * Exit code 0 when clean, 1 when any leaf is missing or non-string.
 *
 * Wired into `scripts/release-verify.mjs` immediately after
 * "i18n: keys". The structural-i18n migration (2026-05-24) removed
 * the silent en.json fallback in `lib/i18n/getMessages.ts` — a
 * missing key now renders the key path verbatim in production, so a
 * pre-merge parity check is the only defence.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const LOCALES = ["de", "es", "fr", "pt", "sv"];

function readCatalog(locale) {
  const p = path.join(repoRoot, "messages", `${locale}.json`);
  if (!fs.existsSync(p)) {
    return { ok: false, error: `missing file: messages/${locale}.json` };
  }
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (err) {
    return { ok: false, error: `parse error in messages/${locale}.json: ${err.message}` };
  }
}

/** Yield every leaf-string key path in the en catalog as a dotted string. */
function* leafKeys(node, prefix = []) {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    yield prefix.join(".");
    return;
  }
  if (typeof node !== "object") return;
  if (Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node)) {
    yield* leafKeys(v, [...prefix, k]);
  }
}

/** Walk a dotted key into a catalog. Returns { found, value }. */
function lookupLeaf(catalog, dotted) {
  const parts = dotted.split(".");
  let node = catalog;
  for (const p of parts) {
    if (node === null || typeof node !== "object" || Array.isArray(node) || !(p in node)) {
      return { found: false, value: undefined };
    }
    node = node[p];
  }
  return { found: typeof node === "string", value: node };
}

function main() {
  const en = readCatalog("en");
  if (!en.ok) {
    console.error(`i18n parity: cannot read en.json — ${en.error}`);
    process.exit(1);
  }

  /** locale → list of { dotted, problem } */
  const failures = new Map();
  let scanned = 0;
  let missing = 0;

  // Collect all en leaf keys once.
  const allKeys = [...leafKeys(en.data)];
  scanned = allKeys.length;

  for (const locale of LOCALES) {
    const cat = readCatalog(locale);
    if (!cat.ok) {
      failures.set(locale, [{ dotted: "<file>", problem: cat.error }]);
      continue;
    }
    const localeFailures = [];
    for (const dotted of allKeys) {
      const { found, value } = lookupLeaf(cat.data, dotted);
      if (!found) {
        localeFailures.push({
          dotted,
          problem: value === undefined ? "missing" : `non-string (type: ${typeof value})`,
        });
        missing++;
      }
    }
    if (localeFailures.length > 0) failures.set(locale, localeFailures);
  }

  if (failures.size === 0) {
    console.log(
      `i18n parity: clean — ${scanned} keys × ${LOCALES.length} locales = ${
        scanned * LOCALES.length
      } leaf-string assertions all pass`,
    );
    process.exit(0);
  }

  console.error(
    `i18n parity: ${missing} missing leaf string(s) across ${failures.size} locale(s)`,
  );
  console.error("");
  for (const [locale, items] of failures) {
    console.error(`  messages/${locale}.json`);
    // Cap output so a fresh locale doesn't bury the report under
    // thousands of lines.
    const SHOW = 40;
    for (const item of items.slice(0, SHOW)) {
      console.error(`    ${item.problem.padEnd(12)} ${item.dotted}`);
    }
    if (items.length > SHOW) {
      console.error(`    ... and ${items.length - SHOW} more`);
    }
    console.error("");
  }
  console.error(
    "Fix by adding the missing leaf string(s) to the offending locale file(s).",
  );
  console.error(
    "Lib code emits I18nTokens that reference these keys — a missing leaf",
  );
  console.error(
    "renders the raw key path to the merchant since the silent en fallback",
  );
  console.error("was removed in the structural-i18n migration (2026-05-24).");
  process.exit(1);
}

main();
