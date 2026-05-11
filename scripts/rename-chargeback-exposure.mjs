// One-shot: rename "Risk Intelligence" → "Chargeback Exposure",
// soften gauge wording, and add nav.insights label across every
// locale file under messages/. Idempotent.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";

const COPY = {
  en: {
    pageTitleV2: "Chargeback Exposure",
    bannerHealth_at_risk: "Approaching monitoring band",
    bannerHealth_elevated: "In monitoring zone",
    navInsights: "Insights",
  },
  de: {
    pageTitleV2: "Rückbuchungs-Exposition",
    bannerHealth_at_risk: "Nähert sich dem Beobachtungsband",
    bannerHealth_elevated: "In der Beobachtungszone",
    navInsights: "Einblicke",
  },
  es: {
    pageTitleV2: "Exposición a contracargos",
    bannerHealth_at_risk: "Acercándose a la banda de monitoreo",
    bannerHealth_elevated: "En zona de monitoreo",
    navInsights: "Información",
  },
  fr: {
    pageTitleV2: "Exposition aux contestations",
    bannerHealth_at_risk: "Approche du seuil de surveillance",
    bannerHealth_elevated: "Dans la zone de surveillance",
    navInsights: "Analyses",
  },
  pt: {
    pageTitleV2: "Exposição a estornos",
    bannerHealth_at_risk: "Aproximando-se da faixa de monitoramento",
    bannerHealth_elevated: "Na zona de monitoramento",
    navInsights: "Insights",
  },
  sv: {
    pageTitleV2: "Återkrediteringsexponering",
    bannerHealth_at_risk: "Närmar sig övervakningsbandet",
    bannerHealth_elevated: "I övervakningszonen",
    navInsights: "Insikter",
  },
};

COPY["en-US"] = COPY.en;
COPY["de-DE"] = COPY.de;
COPY["es-ES"] = COPY.es;
COPY["fr-FR"] = COPY.fr;
COPY["pt-BR"] = COPY.pt;
COPY["sv-SE"] = COPY.sv;

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
let touched = 0;
for (const f of files) {
  const locale = f.replace(".json", "");
  const p = join(DIR, f);
  const m = JSON.parse(readFileSync(p, "utf8"));
  const c = COPY[locale];
  if (!c) {
    console.warn(`No copy for locale ${locale}; skipping`);
    continue;
  }

  if (m.fraudIntel) {
    m.fraudIntel.pageTitleV2 = c.pageTitleV2;
    m.fraudIntel.bannerHealth_at_risk = c.bannerHealth_at_risk;
    m.fraudIntel.bannerHealth_elevated = c.bannerHealth_elevated;
  }
  if (m.nav) {
    m.nav.insights = c.navInsights;
  }

  writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  touched++;
  console.log(`Updated ${f}`);
}
console.log(`\nDone — ${touched} files updated.`);
