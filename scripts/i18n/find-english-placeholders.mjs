#!/usr/bin/env node
/**
 * Find keys where a non-en locale's value exactly equals the en value.
 * These are likely English placeholders left over from the fill-script
 * backfill (2026-05-24) — not real translations.
 *
 * Caveats:
 *   - Some keys legitimately have the same value across locales
 *     (proper nouns, brand names, "OK", "PDF", etc.). The script
 *     filters out short values (≤2 chars), ASCII-only single-word
 *     values that look like enum tags, and common loanwords.
 *   - Manual review still required — the output is a punch list, not
 *     a definitive bug list.
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const LOCALES = ["sv", "de", "es", "fr", "pt"];

const en = JSON.parse(fs.readFileSync(path.join(repoRoot, "messages/en.json"), "utf8"));

const loanwords = new Set([
  "OK", "Pack", "PDF", "URL", "ID", "API", "AVS", "CVV", "IP", "ZIP", "AI",
  "Shopify", "DisputeDesk", "Stripe", "Klarna", "Adyen", "Mollie",
]);

function* leafs(node, prefix = []) {
  if (typeof node === "string") {
    yield { path: prefix.join("."), value: node };
    return;
  }
  if (node === null || typeof node !== "object" || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node)) {
    yield* leafs(v, [...prefix, k]);
  }
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

/** Heuristic: a value is "likely English copy" (so a match across
 *  locales is suspicious) if it has multiple words, contains spaces,
 *  and isn't a brand/acronym. */
function looksLikeEnglishCopy(s) {
  if (typeof s !== "string") return false;
  if (s.length <= 2) return false;
  if (loanwords.has(s.trim())) return false;
  // Multi-word required
  const words = s.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length < 2) return false;
  return /\s/.test(s);
}

const enKeys = [...leafs(en)];

const byLocale = {};
for (const locale of LOCALES) {
  const cat = JSON.parse(fs.readFileSync(path.join(repoRoot, `messages/${locale}.json`), "utf8"));
  const hits = [];
  for (const { path: p, value } of enKeys) {
    if (!looksLikeEnglishCopy(value)) continue;
    const v = lookup(cat, p);
    if (typeof v === "string" && v === value) {
      hits.push({ path: p, value: v });
    }
  }
  byLocale[locale] = hits;
}

let total = 0;
for (const locale of LOCALES) {
  const hits = byLocale[locale];
  if (hits.length === 0) {
    console.log(`${locale}: no English placeholders found`);
    continue;
  }
  console.log(`\n${locale}: ${hits.length} suspected English placeholder(s)`);
  total += hits.length;
  for (const h of hits.slice(0, 100)) {
    console.log(`  ${h.path.padEnd(70)} ${JSON.stringify(h.value)}`);
  }
  if (hits.length > 100) console.log(`  ... and ${hits.length - 100} more`);
}
console.log(`\ntotal: ${total} placeholder hits across ${LOCALES.length} locales`);
