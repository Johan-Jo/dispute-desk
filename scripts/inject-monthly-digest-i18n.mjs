// One-shot: add settings.notifMonthlyDigest + Desc keys across every
// locale file under messages/.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";

const COPY = {
  en: {
    notifMonthlyDigest: "Monthly chargeback digest",
    notifMonthlyDigestDesc:
      "A monthly email summarizing your chargeback exposure, where you stand on the network rules, and what changed.",
  },
  de: {
    notifMonthlyDigest: "Monatliche Rückbuchungs-Übersicht",
    notifMonthlyDigestDesc:
      "Eine monatliche E-Mail mit deiner Rückbuchungs-Exposition, deiner Position gegenüber den Netzwerkregeln und den Veränderungen.",
  },
  es: {
    notifMonthlyDigest: "Resumen mensual de contracargos",
    notifMonthlyDigestDesc:
      "Un correo mensual que resume tu exposición a contracargos, tu posición frente a las reglas de las redes y los cambios.",
  },
  fr: {
    notifMonthlyDigest: "Bulletin mensuel de contestations",
    notifMonthlyDigestDesc:
      "Un email mensuel qui résume votre exposition aux contestations, votre position vis-à-vis des règles des réseaux et les évolutions.",
  },
  pt: {
    notifMonthlyDigest: "Resumo mensal de estornos",
    notifMonthlyDigestDesc:
      "Um e-mail mensal que resume sua exposição a estornos, sua posição em relação às regras das redes e o que mudou.",
  },
  sv: {
    notifMonthlyDigest: "Månatlig återkrediteringssammanfattning",
    notifMonthlyDigestDesc:
      "Ett månadsmejl som sammanfattar din återkrediteringsexponering, din position gentemot kortnätsreglerna och förändringarna.",
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
  if (!c || !m.settings) continue;
  m.settings.notifMonthlyDigest = c.notifMonthlyDigest;
  m.settings.notifMonthlyDigestDesc = c.notifMonthlyDigestDesc;
  writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  touched++;
  console.log(`Updated ${f}`);
}
console.log(`\nDone — ${touched} files updated.`);
