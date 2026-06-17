// One-off: insert `hub.articleLink` into each translated compare source module,
// before the `sectionAlternatives:` key (en.mjs already edited by hand).
import { readFileSync, writeFileSync } from "node:fs";

const TR = {
  de: "Zum Guide: die besten Chargeback-Management-Tools für Shopify",
  es: "Lee la guía: las mejores herramientas de gestión de contracargos para Shopify",
  fr: "Lire le guide : les meilleurs outils de gestion des rétrofacturations pour Shopify",
  pt: "Leia o guia: as melhores ferramentas de gestão de chargeback para Shopify",
  sv: "Läs guiden: de bästa verktygen för återkravshantering för Shopify",
};

for (const [loc, val] of Object.entries(TR)) {
  const f = `scripts/compare-i18n/${loc}.mjs`;
  let s = readFileSync(f, "utf8");
  if (s.includes("articleLink:")) {
    console.log(`${loc}: already present`);
    continue;
  }
  const re = /^([ \t]*)sectionAlternatives:/m;
  const m = s.match(re);
  if (!m) {
    console.error(`${loc}: no sectionAlternatives anchor`);
    process.exit(1);
  }
  const indent = m[1];
  s = s.replace(
    re,
    `${indent}articleLink: ${JSON.stringify(val)},\n${indent}sectionAlternatives:`
  );
  writeFileSync(f, s, "utf8");
  console.log(`${loc}: inserted hub.articleLink`);
}
