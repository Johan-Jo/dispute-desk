// Adds the show/hide classification-details disclosure keys to every
// locale file under messages/. Idempotent.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";

const COPY = {
  en: {
    showClassificationDetails: "Show classification details",
    hideClassificationDetails: "Hide classification details",
  },
  de: {
    showClassificationDetails: "Klassifizierungsdetails anzeigen",
    hideClassificationDetails: "Klassifizierungsdetails ausblenden",
  },
  es: {
    showClassificationDetails: "Mostrar detalles de clasificación",
    hideClassificationDetails: "Ocultar detalles de clasificación",
  },
  fr: {
    showClassificationDetails: "Afficher les détails de classification",
    hideClassificationDetails: "Masquer les détails de classification",
  },
  pt: {
    showClassificationDetails: "Mostrar detalhes da classificação",
    hideClassificationDetails: "Ocultar detalhes da classificação",
  },
  sv: {
    showClassificationDetails: "Visa klassificeringsdetaljer",
    hideClassificationDetails: "Dölj klassificeringsdetaljer",
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
  if (!c || !m.fraudIntel) continue;
  m.fraudIntel.showClassificationDetails = c.showClassificationDetails;
  m.fraudIntel.hideClassificationDetails = c.hideClassificationDetails;
  writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  touched++;
  console.log(`Updated ${f}`);
}
console.log(`\nDone — ${touched} files updated.`);
