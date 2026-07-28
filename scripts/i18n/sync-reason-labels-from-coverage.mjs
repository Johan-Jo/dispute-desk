#!/usr/bin/env node
/**
 * Make `coverage.family*` the single source of truth for the
 * reason-code labels. Copies each canonical family string to:
 *   - disputeReasons.<CODE>
 *   - packs.disputeTypeLabel.<CODE>  (incl. aliases FRAUD, PNR,
 *     NOT_AS_DESCRIBED, SUBSCRIPTION, REFUND)
 *   - disputes.workspaceShell.merchantReasonLabel.<CODE>
 *
 * For every locale. The user explicitly said "same lingo across the
 * site" — the Coverage page is the reference point and every other
 * surface must match it.
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const LOCALES = ["en", "sv", "de", "es", "fr", "pt"];

// coverage.family* key → list of reason codes to sync.
const FAMILY_TO_CODES = {
  familyFraud: ["FRAUDULENT", "FRAUD"],
  familyUnrecognized: ["UNRECOGNIZED"],
  familyPnr: ["PRODUCT_NOT_RECEIVED", "PNR"],
  familyNotAsDescribed: ["PRODUCT_UNACCEPTABLE", "NOT_AS_DESCRIBED"],
  familySubscription: ["SUBSCRIPTION_CANCELLED", "SUBSCRIPTION"],
  familyRefund: ["CREDIT_NOT_PROCESSED", "REFUND"],
  familyDuplicate: ["DUPLICATE"],
  familyGeneral: ["GENERAL"],
};

const NAMESPACES = [
  { path: ["disputeReasons"], aliasOk: false },
  { path: ["packs", "disputeTypeLabel"], aliasOk: true },
  { path: ["disputes", "workspaceShell", "merchantReasonLabel"], aliasOk: false },
];

function getDeep(obj, keys) {
  let n = obj;
  for (const k of keys) {
    if (n === null || typeof n !== "object" || !(k in n)) return undefined;
    n = n[k];
  }
  return n;
}

function setDeep(obj, keys, value) {
  let n = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (n[k] === undefined || typeof n[k] !== "object") n[k] = {};
    n = n[k];
  }
  n[keys[keys.length - 1]] = value;
}

let total = 0;
for (const locale of LOCALES) {
  const file = path.join(repoRoot, `messages/${locale}.json`);
  const cat = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = 0;
  for (const [familyKey, codes] of Object.entries(FAMILY_TO_CODES)) {
    const canonical = getDeep(cat, ["coverage", familyKey]);
    if (typeof canonical !== "string") {
      console.error(`${locale}: missing coverage.${familyKey}, skipping`);
      continue;
    }
    for (const ns of NAMESPACES) {
      for (const code of codes) {
        if (!ns.aliasOk && code.length < 7) continue; // skip short alias codes for namespaces that don't carry them
        const fullPath = [...ns.path, code];
        const current = getDeep(cat, fullPath);
        if (typeof current !== "string") continue; // path doesn't exist in this locale
        if (current === canonical) continue;
        setDeep(cat, fullPath, canonical);
        changed++;
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(cat, null, 2) + "\n");
  console.log(`${locale}: ${changed} updates`);
  total += changed;
}
console.log(`done. total ${total} updates`);
