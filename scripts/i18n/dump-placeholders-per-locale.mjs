#!/usr/bin/env node
/**
 * Per-locale dump: writes /tmp/placeholders-{locale}.txt for each
 * non-en locale, listing every key path where the locale value still
 * equals the English source. Used to feed translation agents one
 * locale at a time.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const LOCALES = ["de", "es", "fr", "pt"];
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

function looksLikeEnglishCopy(s) {
  if (typeof s !== "string") return false;
  if (s.length <= 2) return false;
  if (loanwords.has(s.trim())) return false;
  const words = s.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length < 2) return false;
  return /\s/.test(s);
}

const enKeys = [...leafs(en)];

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
  const out = process.argv[2] || "/tmp";
  const outPath = path.join(out, `placeholders-${locale}.tsv`);
  const lines = hits.map((h) => `${h.path}\t${JSON.stringify(h.value)}`);
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`${locale}: wrote ${hits.length} entries to ${outPath}`);
}
