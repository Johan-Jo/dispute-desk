#!/usr/bin/env node
/**
 * Patches dashboard redesign i18n keys into every locale file.
 * Inserts the new keys after the existing "overdue" entry inside the "dashboard" namespace.
 * English placeholder values are written for non-English locales as a starting point;
 * translators can refine later.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MESSAGES_DIR = path.join(ROOT, "messages");

const NEW_KEYS = {
  "en": {
    attentionBannerMessage: "{count, plural, =1 {# dispute needs attention} other {# disputes need attention}}",
    attentionBannerCta: "Review now",
    actionNeededDesc: "Needs manual review",
    readyToSubmitDesc: "Evidence complete",
    waitingOnIssuerDesc: "Submitted to bank",
    closedInPeriodDesc: "Historical cases",
    reviewCases: "Review cases",
    submitNow: "Submit now",
    insightsTitle: "Insights",
    insightsSubtitle: "Win rate and dispute categories",
    quickActionManageCases: "Manage cases",
    quickActionConfigurePacks: "Configure evidence packs",
    quickActionAutomationRules: "Automation rules",
  },
  "de": {
    attentionBannerMessage: "{count, plural, =1 {# Widerspruch erfordert Aufmerksamkeit} other {# Widersprüche erfordern Aufmerksamkeit}}",
    attentionBannerCta: "Jetzt prüfen",
    actionNeededDesc: "Manuelle Prüfung nötig",
    readyToSubmitDesc: "Beweise vollständig",
    waitingOnIssuerDesc: "An Bank gesendet",
    closedInPeriodDesc: "Historische Fälle",
    reviewCases: "Fälle prüfen",
    submitNow: "Jetzt einreichen",
    insightsTitle: "Insights",
    insightsSubtitle: "Gewinnrate und Streitkategorien",
    quickActionManageCases: "Fälle verwalten",
    quickActionConfigurePacks: "Beweispakete konfigurieren",
    quickActionAutomationRules: "Automatisierungsregeln",
  },
  "fr": {
    attentionBannerMessage: "{count, plural, =1 {# litige nécessite votre attention} other {# litiges nécessitent votre attention}}",
    attentionBannerCta: "Examiner maintenant",
    actionNeededDesc: "Examen manuel requis",
    readyToSubmitDesc: "Preuves complètes",
    waitingOnIssuerDesc: "Soumis à la banque",
    closedInPeriodDesc: "Cas historiques",
    reviewCases: "Examiner les cas",
    submitNow: "Soumettre maintenant",
    insightsTitle: "Insights",
    insightsSubtitle: "Taux de réussite et catégories de litiges",
    quickActionManageCases: "Gérer les cas",
    quickActionConfigurePacks: "Configurer les preuves",
    quickActionAutomationRules: "Règles d'automatisation",
  },
  "es": {
    attentionBannerMessage: "{count, plural, =1 {# disputa necesita atención} other {# disputas necesitan atención}}",
    attentionBannerCta: "Revisar ahora",
    actionNeededDesc: "Requiere revisión manual",
    readyToSubmitDesc: "Pruebas completas",
    waitingOnIssuerDesc: "Enviado al banco",
    closedInPeriodDesc: "Casos históricos",
    reviewCases: "Revisar casos",
    submitNow: "Enviar ahora",
    insightsTitle: "Insights",
    insightsSubtitle: "Tasa de éxito y categorías de disputas",
    quickActionManageCases: "Gestionar casos",
    quickActionConfigurePacks: "Configurar pruebas",
    quickActionAutomationRules: "Reglas de automatización",
  },
  "pt": {
    attentionBannerMessage: "{count, plural, =1 {# disputa precisa de atenção} other {# disputas precisam de atenção}}",
    attentionBannerCta: "Revisar agora",
    actionNeededDesc: "Requer revisão manual",
    readyToSubmitDesc: "Evidências completas",
    waitingOnIssuerDesc: "Enviado ao banco",
    closedInPeriodDesc: "Casos históricos",
    reviewCases: "Revisar casos",
    submitNow: "Enviar agora",
    insightsTitle: "Insights",
    insightsSubtitle: "Taxa de sucesso e categorias de disputas",
    quickActionManageCases: "Gerenciar casos",
    quickActionConfigurePacks: "Configurar evidências",
    quickActionAutomationRules: "Regras de automação",
  },
  "sv": {
    attentionBannerMessage: "{count, plural, =1 {# tvist behöver uppmärksamhet} other {# tvister behöver uppmärksamhet}}",
    attentionBannerCta: "Granska nu",
    actionNeededDesc: "Kräver manuell granskning",
    readyToSubmitDesc: "Bevis kompletta",
    waitingOnIssuerDesc: "Skickat till bank",
    closedInPeriodDesc: "Historiska fall",
    reviewCases: "Granska fall",
    submitNow: "Skicka in nu",
    insightsTitle: "Insights",
    insightsSubtitle: "Vinstgrad och tvistkategorier",
    quickActionManageCases: "Hantera fall",
    quickActionConfigurePacks: "Konfigurera bevispaket",
    quickActionAutomationRules: "Automatiseringsregler",
  },
};

function langOf(file) {
  // en.json -> en, en-US.json -> en, de-DE.json -> de
  const base = path.basename(file, ".json");
  return base.split("-")[0];
}

function patchOne(file) {
  const full = path.join(MESSAGES_DIR, file);
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  const lang = langOf(file);
  const additions = NEW_KEYS[lang] ?? NEW_KEYS["en"];

  if (!json.dashboard) {
    console.warn(`  skip ${file}: no dashboard namespace`);
    return;
  }

  let added = 0;
  for (const [k, v] of Object.entries(additions)) {
    if (!(k in json.dashboard)) {
      json.dashboard[k] = v;
      added++;
    }
  }
  fs.writeFileSync(full, JSON.stringify(json, null, 2) + "\n");
  console.log(`  ${file}: +${added} keys`);
}

const files = fs.readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
console.log(`Patching ${files.length} locale files...`);
for (const f of files) patchOne(f);
console.log("Done.");
