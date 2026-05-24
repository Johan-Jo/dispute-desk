#!/usr/bin/env node
/**
 * One-shot helper: copies the new `disputes.*` sub-namespaces I added
 * for the 2026-05-24 i18n sweep from `messages/en.json` into the other
 * locale files so next-intl has the keys to look up. Swedish (sv) is
 * already translated by hand. The other locales fall back to English
 * content as a translation placeholder — they still need a native pass.
 *
 * Idempotent: safe to re-run; only inserts missing keys, never
 * overwrites existing translations.
 *
 * The list of namespaces is the one this sweep added. Update it if
 * we add more new namespaces in a follow-up.
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const en = JSON.parse(fs.readFileSync(path.join(repoRoot, "messages/en.json"), "utf8"));

const NEW_DISPUTES_NAMESPACES = [
  "signalLabel",
  "familyLabel",
  "decisiveHint",
  "decisiveFamilies",
  "strengthReason",
  "improvementHint",
  "recommendation",
  "sourceCaption",
  "fieldAction",
  "whyText",
  "targetField",
  "workspaceHook",
  "workspaceShell",
  "overviewExtra",
  "evidenceTabExtra",
  "completeDefencePackage",
  "defencePackageHtml",
];

const TOP_LEVEL_NEW_KEYS = [
  ["team.description"],
  ["team.openInPortal"],
  ["settings.automationSectionHelp"],
  ["fraudIntel.weeklyChargebackRateAria"],
];

function getByPath(obj, p) {
  return p.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function setByPath(obj, p, value) {
  const parts = p.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  if (cur[parts[parts.length - 1]] == null) {
    cur[parts[parts.length - 1]] = value;
  }
}

const LOCALES = ["de", "es", "fr", "pt"];

for (const locale of LOCALES) {
  const file = path.join(repoRoot, "messages", `${locale}.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let added = 0;

  if (!data.disputes) data.disputes = {};
  for (const ns of NEW_DISPUTES_NAMESPACES) {
    const enValue = en.disputes?.[ns];
    if (enValue === undefined) continue;
    if (data.disputes[ns] === undefined) {
      data.disputes[ns] = JSON.parse(JSON.stringify(enValue));
      added += 1;
    }
  }

  for (const [keyPath] of TOP_LEVEL_NEW_KEYS) {
    const enValue = getByPath(en, keyPath);
    if (enValue === undefined) continue;
    if (getByPath(data, keyPath) === undefined) {
      setByPath(data, keyPath, enValue);
      added += 1;
    }
  }

  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`${locale}.json — added ${added} missing namespace(s)/key(s)`);
}
