#!/usr/bin/env node
/**
 * One-shot: add the four `billing.topup*` strings the top-up UX fix
 * needs (success/failure banner copy + the in-button "Processing…"
 * label + a generic failure fallback). Run after the code change so
 * the strings exist in every locale before next-intl renders them.
 *
 *   node scripts/add-topup-feedback-i18n.mjs
 *
 * Idempotent — adds missing keys, leaves existing ones untouched.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STRINGS = {
  en: {
    topupSuccessTitle: "{count} packs added",
    topupSuccessBody:
      "The top-up cleared. Your extra packs are available now and expire 30 days from purchase, independent of your billing cycle.",
    topupFailedTitle: "Top-up didn't go through",
    topupFailedGeneric:
      "We couldn't complete the top-up. Try again in a moment or contact support if the issue persists.",
    topupProcessing: "Processing…",
  },
  de: {
    topupSuccessTitle: "{count} Packs hinzugefügt",
    topupSuccessBody:
      "Das Top-up wurde verbucht. Die zusätzlichen Packs sind jetzt verfügbar und laufen 30 Tage nach dem Kauf ab — unabhängig von Ihrem Abrechnungszyklus.",
    topupFailedTitle: "Top-up fehlgeschlagen",
    topupFailedGeneric:
      "Das Top-up konnte nicht abgeschlossen werden. Versuchen Sie es gleich erneut oder wenden Sie sich an den Support, falls das Problem bestehen bleibt.",
    topupProcessing: "Wird verarbeitet…",
  },
  es: {
    topupSuccessTitle: "{count} packs añadidos",
    topupSuccessBody:
      "El top-up se completó. Los packs extra ya están disponibles y caducan 30 días después de la compra, independientemente de tu ciclo de facturación.",
    topupFailedTitle: "El top-up no se completó",
    topupFailedGeneric:
      "No pudimos completar el top-up. Vuelve a intentarlo o contacta a soporte si el problema persiste.",
    topupProcessing: "Procesando…",
  },
  fr: {
    topupSuccessTitle: "{count} packs ajoutés",
    topupSuccessBody:
      "Le top-up est validé. Vos packs supplémentaires sont disponibles dès maintenant et expirent 30 jours après l'achat, indépendamment de votre cycle de facturation.",
    topupFailedTitle: "Le top-up n'a pas abouti",
    topupFailedGeneric:
      "Nous n'avons pas pu finaliser le top-up. Réessayez dans un instant ou contactez le support si le problème persiste.",
    topupProcessing: "Traitement…",
  },
  pt: {
    topupSuccessTitle: "{count} packs adicionados",
    topupSuccessBody:
      "O top-up foi confirmado. Os packs extras já estão disponíveis e expiram 30 dias após a compra, independentemente do seu ciclo de cobrança.",
    topupFailedTitle: "O top-up não foi concluído",
    topupFailedGeneric:
      "Não foi possível concluir o top-up. Tente novamente ou entre em contato com o suporte se o problema persistir.",
    topupProcessing: "Processando…",
  },
  sv: {
    topupSuccessTitle: "{count} packs tillagda",
    topupSuccessBody:
      "Top-up:en gick igenom. Dina extra packs är tillgängliga nu och löper ut 30 dagar efter köpet — oberoende av din faktureringscykel.",
    topupFailedTitle: "Top-up gick inte igenom",
    topupFailedGeneric:
      "Vi kunde inte slutföra top-up:en. Försök igen om en stund eller kontakta supporten om problemet kvarstår.",
    topupProcessing: "Bearbetar…",
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
