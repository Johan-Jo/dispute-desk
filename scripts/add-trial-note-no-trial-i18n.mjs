#!/usr/bin/env node
/**
 * One-shot: add `billing.trialNoteNoTrial` to every locale and fix
 * the pre-existing `billing.trialNote` "playbooks" typo (should be
 * "packs"). The page renders trialNote when the shop is eligible
 * for a trial, trialNoteNoTrial when it has already trialed.
 *
 *   node scripts/add-trial-note-no-trial-i18n.mjs
 *
 * Idempotent.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STRINGS = {
  en: {
    trialNote:
      "Paid plans include a 14-day trial with 25 packs. Downgrades take effect at the next billing cycle. Your data is always retained.",
    trialNoteNoTrial:
      "Plan changes take effect today at the new price. Downgrades take effect at the next billing cycle. Your data is always retained.",
  },
  de: {
    trialNote:
      "Bezahlte Pläne enthalten eine 14-tägige Testphase mit 25 Packs. Downgrades werden zum nächsten Abrechnungszyklus wirksam. Ihre Daten bleiben stets erhalten.",
    trialNoteNoTrial:
      "Planänderungen werden heute zum neuen Preis wirksam. Downgrades werden zum nächsten Abrechnungszyklus wirksam. Ihre Daten bleiben stets erhalten.",
  },
  es: {
    trialNote:
      "Los planes de pago incluyen una prueba de 14 días con 25 packs. Los downgrades surten efecto en el siguiente ciclo de facturación. Tus datos siempre se conservan.",
    trialNoteNoTrial:
      "Los cambios de plan surten efecto hoy al nuevo precio. Los downgrades surten efecto en el siguiente ciclo de facturación. Tus datos siempre se conservan.",
  },
  fr: {
    trialNote:
      "Les plans payants incluent un essai de 14 jours avec 25 packs. Les rétrogradations prennent effet au prochain cycle de facturation. Vos données sont toujours conservées.",
    trialNoteNoTrial:
      "Les changements de plan prennent effet aujourd'hui au nouveau prix. Les rétrogradations prennent effet au prochain cycle de facturation. Vos données sont toujours conservées.",
  },
  pt: {
    trialNote:
      "Os planos pagos incluem um período de teste de 14 dias com 25 packs. Os downgrades entram em vigor no próximo ciclo de cobrança. Seus dados são sempre preservados.",
    trialNoteNoTrial:
      "As mudanças de plano entram em vigor hoje pelo novo preço. Os downgrades entram em vigor no próximo ciclo de cobrança. Seus dados são sempre preservados.",
  },
  sv: {
    trialNote:
      "Betalplaner inkluderar en 14-dagars provperiod med 25 packs. Nedgraderingar träder i kraft vid nästa faktureringscykel. Din data sparas alltid.",
    trialNoteNoTrial:
      "Planändringar träder i kraft idag till det nya priset. Nedgraderingar träder i kraft vid nästa faktureringscykel. Din data sparas alltid.",
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
