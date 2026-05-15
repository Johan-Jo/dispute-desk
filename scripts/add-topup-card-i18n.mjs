#!/usr/bin/env node
/**
 * One-shot: split the cluttered top-up labels into separate
 * pack-count / price / CTA strings so the billing card can render
 * each piece distinctly. Adds these keys per locale:
 *
 *   billing.topUp25Packs   — pack-count line (e.g. "+25 packs")
 *   billing.topUp100Packs  — pack-count line (e.g. "+100 packs")
 *   billing.topUpBuyCta    — short CTA, e.g. "Buy"
 *
 * Existing `topUp25` / `topUp100` keys are left in place for
 * back-compat with any non-billing surface that may render them.
 *
 *   node scripts/add-topup-card-i18n.mjs
 *
 * Idempotent.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STRINGS = {
  en: {
    topUp25Packs: "+25 packs",
    topUp100Packs: "+100 packs",
    topUpBuyCta: "Buy",
  },
  de: {
    topUp25Packs: "+25 Pakete",
    topUp100Packs: "+100 Pakete",
    topUpBuyCta: "Kaufen",
  },
  es: {
    topUp25Packs: "+25 packs",
    topUp100Packs: "+100 packs",
    topUpBuyCta: "Comprar",
  },
  fr: {
    topUp25Packs: "+25 packs",
    topUp100Packs: "+100 packs",
    topUpBuyCta: "Acheter",
  },
  pt: {
    topUp25Packs: "+25 pacotes",
    topUp100Packs: "+100 pacotes",
    topUpBuyCta: "Comprar",
  },
  sv: {
    topUp25Packs: "+25 paket",
    topUp100Packs: "+100 paket",
    topUpBuyCta: "Köp",
  },
};

const LOCALES = ["en", "en-US", "de", "de-DE", "es", "es-ES", "fr", "fr-FR", "pt", "pt-BR", "sv", "sv-SE"];

function langOf(locale) {
  return locale.split("-")[0];
}

function applyToLocale(locale) {
  const path = join("messages", `${locale}.json`);
  const json = JSON.parse(readFileSync(path, "utf8"));
  if (!json.billing) json.billing = {};
  const lang = langOf(locale);
  const t = STRINGS[lang] ?? STRINGS.en;
  for (const [key, value] of Object.entries(t)) {
    json.billing[key] = value;
  }
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`updated ${path}`);
}

for (const locale of LOCALES) {
  applyToLocale(locale);
}
console.log(`done — ${LOCALES.length} locales updated`);
