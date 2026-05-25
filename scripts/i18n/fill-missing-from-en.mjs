#!/usr/bin/env node
/**
 * One-shot: copy missing leaf-string keys from `messages/en.json`
 * into the 5 non-en locale files. Used to backfill the parity gap
 * the structural-i18n migration uncovered when the silent en
 * fallback in `getMessages.ts` was removed (2026-05-24).
 *
 * Idempotent: only inserts missing keys; never overwrites existing
 * translations.
 *
 * The copied values are English placeholders — the locale catalog
 * needs a native pass to translate them. They're acceptable as an
 * interim measure because the merchant would have rendered the same
 * English under the old silent-fallback behavior. The parity script
 * (scripts/verify-i18n-parity.mjs) now blocks any FUTURE gap.
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const LOCALES = ["de", "es", "fr", "pt", "sv"];

const en = JSON.parse(fs.readFileSync(path.join(repoRoot, "messages/en.json"), "utf8"));

/** Walk a dotted key into an object; return undefined if any segment
 *  is missing. */
function lookup(obj, dotted) {
  const parts = dotted.split(".");
  let n = obj;
  for (const p of parts) {
    if (n === null || typeof n !== "object" || Array.isArray(n) || !(p in n)) {
      return undefined;
    }
    n = n[p];
  }
  return n;
}

/** Set a dotted path in an object, creating intermediate objects as
 *  needed. */
function setDeep(obj, dotted, value) {
  const parts = dotted.split(".");
  let n = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (n[p] === undefined || typeof n[p] !== "object" || Array.isArray(n[p])) {
      n[p] = {};
    }
    n = n[p];
  }
  n[parts[parts.length - 1]] = value;
}

/** Yield every leaf-string dotted key path. */
function* leafKeys(node, prefix = []) {
  if (typeof node === "string") {
    yield prefix.join(".");
    return;
  }
  if (node === null || typeof node !== "object" || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node)) {
    yield* leafKeys(v, [...prefix, k]);
  }
}

let totalInserted = 0;
for (const locale of LOCALES) {
  const p = path.join(repoRoot, `messages/${locale}.json`);
  if (!fs.existsSync(p)) {
    console.error(`skipping: ${p} does not exist`);
    continue;
  }
  const cat = JSON.parse(fs.readFileSync(p, "utf8"));
  let inserted = 0;
  for (const key of leafKeys(en)) {
    const existing = lookup(cat, key);
    if (typeof existing === "string") continue;
    const enValue = lookup(en, key);
    if (typeof enValue !== "string") continue;
    setDeep(cat, key, enValue);
    inserted++;
  }
  if (inserted > 0) {
    fs.writeFileSync(p, JSON.stringify(cat, null, 2) + "\n");
    console.log(`${locale}: inserted ${inserted} keys`);
  } else {
    console.log(`${locale}: already complete`);
  }
  totalInserted += inserted;
}
console.log(`done. total inserted: ${totalInserted}`);
