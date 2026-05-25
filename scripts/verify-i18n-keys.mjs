#!/usr/bin/env node
/**
 * i18n key-resolution guardrail.
 *
 * Fails the build when a `t("...")` call references an i18n key path
 * that does not exist in `messages/en.json`. Catches the bug where the
 * UI renders the raw key path (e.g. "disputes.sourceCaption.auto_shopify")
 * because the key was never added to the locale file.
 *
 * Also fails on lazy `// i18n-allow TODO` markers — the original i18n
 * guardrail allows escape-hatching with `// i18n-allow`, but TODO-
 * tagged hatches are deferrals, not real fixes. Banning them at
 * release-verify time prevents "I'll do it later" from shipping.
 *
 * Scope: scans .ts/.tsx files under `app/(embedded)/app` for two
 * patterns:
 *   1. `useTranslations("namespace.path")` — defines the scope.
 *   2. `t("key.path", ...)` — resolves against that scope.
 * For each `t("...")`, resolves the full key path and checks that
 * `messages/en.json` has a leaf string at that path.
 *
 * Limitations: the scope resolver is heuristic — it picks the LAST
 * `useTranslations(...)` declaration that appears above the `t(...)`
 * call in the same file (works for the file's main translator). When
 * a file has multiple translators with different scopes, each `t...`
 * variable should match a distinct name (`tDisputes`, `tEvidence`,
 * `tSignal`) — we track those too.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SCAN_DIRS = ["app/(embedded)/app"];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(ent.name)) out.push(full);
  }
  return out;
}

function loadEn() {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "messages/en.json"), "utf8"),
  );
}

/** Check whether a dotted key path resolves to a leaf string in the en
 *  catalog. Returns:
 *   - "ok"      — leaf string found
 *   - "missing" — path does not exist
 *   - "branch"  — path exists but resolves to an object (caller used
 *                 the wrong scope, e.g. forgot to add `.label`)
 *
 *  Numeric segments are also accepted (next-intl `{count, plural, …}`). */
function resolveKey(en, dottedPath) {
  const parts = dottedPath.split(".");
  let cur = en;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return "missing";
    if (!(part in cur)) return "missing";
    cur = cur[part];
  }
  if (typeof cur === "string") return "ok";
  if (typeof cur === "object") return "branch";
  return "missing";
}

/** Extract every `(t-name, scope)` declaration from a source file.
 *  Returns:
 *    { primary: Map<name, scope> — last declaration wins (for
 *      function-scope inference),
 *      all: Set<scope> — every scope ever declared in this file
 *      (for shadowing-tolerant key resolution). }
 *  Example:
 *    `const tSignal = useTranslations("disputes.signalLabel");`
 *  When `useTranslations()` is called with no arg, scope is "". */
function findScopes(src) {
  const primary = new Map();
  const all = new Set();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useTranslations\s*\(\s*(?:["']([^"']*)["'])?\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const scope = m[2] ?? "";
    primary.set(name, scope);
    all.add(scope);
  }
  return { primary, all };
}

/** Find every `t("key", ...)` call (or `tNamed("key", ...)`) in the
 *  source. Returns [{ varName, key, line, col }]. Skips calls where
 *  the first arg is not a string literal (e.g. `t(dynamicVar)`). */
function findTCalls(src, scopes) {
  const out = [];
  // We only look at variables that were declared via useTranslations.
  if (scopes.primary.size === 0) return out;
  const varAlternation = [...scopes.primary.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`\\b(${varAlternation})\\s*\\(\\s*["']([^"']+)["']`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    const upto = src.slice(0, m.index);
    const line = upto.split(/\r?\n/).length;
    const col = m.index - upto.lastIndexOf("\n");
    out.push({ varName: m[1], key: m[2], line, col });
  }
  return out;
}

/** Detect lazy escape hatches: `// i18n-allow TODO` or
 *  `// i18n-allow TODO(...)`. Returns matches with file/line. */
function findLazyAllows(src, file) {
  const out = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/\/\/\s*i18n-allow\s+TODO/.test(lines[i])) {
      out.push({ file, line: i + 1, text: lines[i].trim().slice(0, 200) });
    }
  }
  return out;
}

function main() {
  const en = loadEn();
  const files = [];
  for (const dir of SCAN_DIRS) walk(path.join(repoRoot, dir), files);

  const missing = [];
  const branches = [];
  const lazy = [];

  for (const file of files) {
    const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
    const src = fs.readFileSync(file, "utf8");

    // (1) Detect lazy `// i18n-allow TODO` markers.
    lazy.push(...findLazyAllows(src, rel));

    // (2) Resolve every t() call against en.json.
    // Note on function-parameter shadowing: when a helper function
    // takes a translator as a parameter named `t` (or any name that
    // happens to match a useTranslations declaration), my regex can't
    // tell which scope the parameter was bound to. To minimize false
    // positives, accept the call if the key resolves under ANY of the
    // file's translator scopes — that's safer than blanket flagging.
    const scopes = findScopes(src);
    const allScopes = [...scopes.all, ""];
    const calls = findTCalls(src, scopes);
    for (const c of calls) {
      const primaryScope = scopes.primary.get(c.varName) ?? "";
      const primaryKey = primaryScope ? `${primaryScope}.${c.key}` : c.key;
      const primaryVerdict = resolveKey(en, primaryKey);
      if (primaryVerdict === "ok") continue;
      // Try every other scope before giving up — if any resolves
      // cleanly, treat it as the (shadowed) intended scope.
      let resolvedSomewhere = false;
      for (const altScope of allScopes) {
        const altKey = altScope ? `${altScope}.${c.key}` : c.key;
        if (resolveKey(en, altKey) === "ok") {
          resolvedSomewhere = true;
          break;
        }
      }
      if (resolvedSomewhere) continue;
      if (primaryVerdict === "missing") missing.push({ file: rel, line: c.line, col: c.col, key: primaryKey });
      else if (primaryVerdict === "branch") branches.push({ file: rel, line: c.line, col: c.col, key: primaryKey });
    }
  }

  let failed = false;

  if (lazy.length > 0) {
    failed = true;
    console.error(`i18n key guardrail: ${lazy.length} lazy "// i18n-allow TODO" marker(s)`);
    console.error("");
    for (const l of lazy) {
      console.error(`  ${l.file}:${l.line}  ${l.text}`);
    }
    console.error("");
    console.error("Fix the i18n properly — don't defer with a TODO. The marker tells the");
    console.error("merchant their language doesn't work; that's not a TODO, that's a bug.");
    console.error("");
  }

  if (missing.length > 0) {
    failed = true;
    console.error(`i18n key guardrail: ${missing.length} t() call(s) reference key(s) not in messages/en.json`);
    console.error("");
    const byFile = new Map();
    for (const v of missing) {
      if (!byFile.has(v.file)) byFile.set(v.file, []);
      byFile.get(v.file).push(v);
    }
    for (const [file, vs] of byFile) {
      console.error(`  ${file}`);
      for (const v of vs) console.error(`    ${v.line}:${v.col}  ${JSON.stringify(v.key)}`);
      console.error("");
    }
    console.error("Add the missing key to messages/en.json (and sync via scripts/sync-i18n-new-keys.mjs).");
    console.error("");
  }

  if (branches.length > 0) {
    failed = true;
    console.error(`i18n key guardrail: ${branches.length} t() call(s) resolve to an OBJECT, not a leaf string`);
    console.error("");
    for (const v of branches) {
      console.error(`  ${v.file}:${v.line}:${v.col}  ${JSON.stringify(v.key)}`);
    }
    console.error("");
    console.error("These calls produce JSON-stringified objects in the UI. Either deepen the key");
    console.error("path or fix the namespace.");
    console.error("");
  }

  if (failed) process.exit(1);
  console.log("i18n key guardrail: clean — every t() call resolves to a leaf string in en.json");
}

main();
