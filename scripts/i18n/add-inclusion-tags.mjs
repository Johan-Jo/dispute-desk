#!/usr/bin/env node
/**
 * One-shot: add `groupTags` + `outsideDataCallout` to the inclusion
 * review block across all 5 non-English locales. Mirrors what the new
 * design's color-coded status pills + "data lives outside DisputeDesk"
 * callout require on the embedded HTML view.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TRANSLATIONS = {
  "es.json": {
    groupTags: {
      usedAsBankArgument: "Argumento decisivo",
      contextOnly: "De apoyo",
      keptInternal: "Oculto al banco",
      notIncluded: "Excluido",
      excludedByMerchant: "Excluido",
    },
    outsideDataCallout:
      "Los datos están fuera de DisputeDesk: en la pasarela de pago, el transportista o el motor de riesgo de Shopify.",
  },
  "fr.json": {
    groupTags: {
      usedAsBankArgument: "Argument décisif",
      contextOnly: "Contexte",
      keptInternal: "Masqué pour la banque",
      notIncluded: "Exclu",
      excludedByMerchant: "Exclu",
    },
    outsideDataCallout:
      "Les données se trouvent en dehors de DisputeDesk — chez la passerelle de paiement, le transporteur ou le moteur de risque de Shopify.",
  },
  "pt.json": {
    groupTags: {
      usedAsBankArgument: "Argumento decisivo",
      contextOnly: "Apoio",
      keptInternal: "Oculto do banco",
      notIncluded: "Excluído",
      excludedByMerchant: "Excluído",
    },
    outsideDataCallout:
      "Os dados estão fora do DisputeDesk — no gateway de pagamento, na transportadora ou no motor de risco do Shopify.",
  },
  "sv.json": {
    groupTags: {
      usedAsBankArgument: "Avgörande argument",
      contextOnly: "Stödjande",
      keptInternal: "Dolt för banken",
      notIncluded: "Uteslutet",
      excludedByMerchant: "Uteslutet",
    },
    outsideDataCallout:
      "Datan ligger utanför DisputeDesk — i betalningsgatewayen, hos transportören eller i Shopifys riskmotor.",
  },
  "de.json": {
    groupTags: {
      usedAsBankArgument: "Entscheidendes Argument",
      contextOnly: "Unterstützend",
      keptInternal: "Vor Bank verborgen",
      notIncluded: "Ausgeschlossen",
      excludedByMerchant: "Ausgeschlossen",
    },
    outsideDataCallout:
      "Die Daten liegen außerhalb von DisputeDesk — beim Zahlungsdienstleister, beim Carrier oder bei Shopifys Risikomotor.",
  },
};

for (const [filename, t] of Object.entries(TRANSLATIONS)) {
  const path = resolve(process.cwd(), "messages", filename);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const inclusion = json.disputes?.reviewTab?.inclusion;
  if (!inclusion) {
    console.error(`  ${filename}: inclusion block missing, skipping`);
    continue;
  }
  if (!inclusion.groupTags) inclusion.groupTags = t.groupTags;
  if (!inclusion.outsideDataCallout)
    inclusion.outsideDataCallout = t.outsideDataCallout;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`  filled ${filename}`);
}
