// Injects the `compare` i18n namespace into each messages/<locale>.json from the
// per-locale source modules in this folder, preserving the files' existing
// CRLF line endings and 2-space indentation (so the diff stays minimal).
//
// Usage:  node scripts/compare-i18n/inject.mjs            # all locales
//         node scripts/compare-i18n/inject.mjs de es      # selected locales
//
// Each scripts/compare-i18n/<locale>.mjs default-exports the translated
// `compare` object. en.mjs is the source of truth.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

const ALL_LOCALES = ["en", "de", "es", "fr", "pt", "sv"];

const locales = process.argv.slice(2);
const targets = locales.length ? locales : ALL_LOCALES;

/** Serialize an object as a top-level JSON property block with CRLF + 2-space indent. */
function propertyBlock(key, value) {
  const body = JSON.stringify({ [key]: value }, null, 2);
  // Strip the wrapping `{` / `}` lines, keep the inner indented property.
  const inner = body.split("\n").slice(1, -1).join("\n");
  return inner.replace(/\n/g, "\r\n");
}

for (const locale of targets) {
  const srcUrl = new URL(`./${locale}.mjs`, import.meta.url);
  const { default: compare } = await import(srcUrl.href);
  const file = join(repoRoot, "messages", `${locale}.json`);
  const raw = readFileSync(file, "utf8");

  // Validate current JSON and detect whether `compare` already exists.
  const parsed = JSON.parse(raw);
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = raw.endsWith("\n");

  const block = propertyBlock("compare", compare).replace(
    /\r\n/g,
    eol === "\r\n" ? "\r\n" : "\n"
  );

  let out;
  if ("compare" in parsed) {
    // Replace the existing block: re-stringify the whole object (rare path).
    parsed.compare = compare;
    out = JSON.stringify(parsed, null, 2).replace(/\n/g, eol);
  } else {
    // Insert before the final closing brace, after the last property.
    const lastBrace = raw.lastIndexOf("}");
    const head = raw.slice(0, lastBrace).replace(/\s+$/, "");
    out = `${head},${eol}${block}${eol}}`;
  }
  if (trailingNewline && !out.endsWith("\n")) out += eol;

  // Final validation.
  JSON.parse(out);
  writeFileSync(file, out, "utf8");
  console.log(`✓ ${locale}: injected compare (${out.length} bytes)`);
}
