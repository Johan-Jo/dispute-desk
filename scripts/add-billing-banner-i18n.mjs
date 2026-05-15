#!/usr/bin/env node
/**
 * One-shot: add `billing.banners.{grace,expired,lowCredits}` keys to
 * every locale file under messages/. Idempotent — running twice
 * leaves the file unchanged (a deep-merge would clobber comments
 * but JSON has none).
 *
 * Run via: node scripts/add-billing-banner-i18n.mjs
 *
 * Kept in scripts/ for audit + reproducibility; the resulting JSON
 * diff is what gets committed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TRANSLATIONS = {
  en: {
    grace: {
      title: "Payment failed — short grace period",
      body: "Shopify couldn't charge your card. Auto-build still runs while Shopify retries — for up to 3 days. Update your payment method to avoid interruption.",
      cta: "Update payment",
    },
    expired: {
      title: "Auto-build paused",
      body: "Your DisputeDesk subscription is inactive. Historical disputes and packs stay fully readable; new automation is on hold until you reactivate.",
      cta: "Reactivate",
    },
    lowCredits: {
      title: "Almost out of packs",
      body: "You're below 10% of your monthly pack allotment. Buy a top-up or upgrade your plan to keep auto-build running for the rest of the cycle.",
      cta: "Buy top-up",
    },
  },
  de: {
    grace: {
      title: "Zahlung fehlgeschlagen — kurze Kulanzfrist",
      body: "Shopify konnte Ihre Karte nicht belasten. Auto-Build läuft weiter, während Shopify es erneut versucht — bis zu 3 Tage. Aktualisieren Sie Ihre Zahlungsmethode, um Unterbrechungen zu vermeiden.",
      cta: "Zahlung aktualisieren",
    },
    expired: {
      title: "Auto-Build pausiert",
      body: "Ihr DisputeDesk-Abonnement ist inaktiv. Historische Disputes und Packs bleiben vollständig lesbar; neue Automatisierung pausiert bis zur Reaktivierung.",
      cta: "Reaktivieren",
    },
    lowCredits: {
      title: "Fast keine Packs mehr",
      body: "Sie haben weniger als 10 % Ihres monatlichen Pack-Kontingents übrig. Kaufen Sie ein Top-up oder upgraden Sie, um Auto-Build für den Rest des Zyklus aktiv zu halten.",
      cta: "Top-up kaufen",
    },
  },
  es: {
    grace: {
      title: "Pago fallido — período de gracia corto",
      body: "Shopify no pudo cobrar tu tarjeta. Auto-build sigue funcionando mientras Shopify lo reintenta — hasta 3 días. Actualiza tu método de pago para evitar interrupciones.",
      cta: "Actualizar pago",
    },
    expired: {
      title: "Auto-build en pausa",
      body: "Tu suscripción a DisputeDesk está inactiva. Los disputes y packs históricos siguen siendo legibles; la nueva automatización está en pausa hasta que reactives.",
      cta: "Reactivar",
    },
    lowCredits: {
      title: "Casi sin packs",
      body: "Tienes menos del 10 % de tu asignación mensual de packs. Compra un top-up o haz upgrade del plan para mantener auto-build activo el resto del ciclo.",
      cta: "Comprar top-up",
    },
  },
  fr: {
    grace: {
      title: "Échec du paiement — courte période de grâce",
      body: "Shopify n'a pas pu débiter votre carte. Auto-build continue de fonctionner pendant que Shopify réessaye — jusqu'à 3 jours. Mettez à jour votre moyen de paiement pour éviter toute interruption.",
      cta: "Mettre à jour le paiement",
    },
    expired: {
      title: "Auto-build en pause",
      body: "Votre abonnement DisputeDesk est inactif. Les disputes et packs historiques restent entièrement lisibles ; la nouvelle automatisation est en pause jusqu'à la réactivation.",
      cta: "Réactiver",
    },
    lowCredits: {
      title: "Presque à court de packs",
      body: "Il vous reste moins de 10 % de votre allocation mensuelle de packs. Achetez un top-up ou passez à un plan supérieur pour maintenir auto-build actif jusqu'à la fin du cycle.",
      cta: "Acheter un top-up",
    },
  },
  pt: {
    grace: {
      title: "Pagamento falhou — período de carência curto",
      body: "O Shopify não conseguiu cobrar seu cartão. O auto-build continua funcionando enquanto o Shopify tenta novamente — por até 3 dias. Atualize seu método de pagamento para evitar interrupções.",
      cta: "Atualizar pagamento",
    },
    expired: {
      title: "Auto-build pausado",
      body: "Sua assinatura do DisputeDesk está inativa. Disputes e packs históricos permanecem totalmente legíveis; a nova automação está pausada até a reativação.",
      cta: "Reativar",
    },
    lowCredits: {
      title: "Quase sem packs",
      body: "Você está abaixo de 10% da sua cota mensal de packs. Compre um top-up ou faça upgrade do plano para manter o auto-build rodando pelo resto do ciclo.",
      cta: "Comprar top-up",
    },
  },
  sv: {
    grace: {
      title: "Betalningen misslyckades — kort respit",
      body: "Shopify kunde inte debitera ditt kort. Auto-build fortsätter köra medan Shopify försöker igen — i upp till 3 dagar. Uppdatera din betalningsmetod för att undvika avbrott.",
      cta: "Uppdatera betalning",
    },
    expired: {
      title: "Auto-build pausad",
      body: "Din DisputeDesk-prenumeration är inaktiv. Historiska disputes och packs förblir fullt läsbara; ny automatisering är pausad tills du återaktiverar.",
      cta: "Återaktivera",
    },
    lowCredits: {
      title: "Nästan slut på packs",
      body: "Du har mindre än 10 % av din månadskvot kvar. Köp en top-up eller uppgradera planen för att hålla auto-build igång resten av cykeln.",
      cta: "Köp top-up",
    },
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
  const t = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
  json.billing.banners = t;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`updated ${path}`);
}

for (const locale of LOCALES) {
  applyToLocale(locale);
}
console.log(`done — ${LOCALES.length} locales updated`);
