/**
 * Resources Hub seed: “Top Chargeback Management Tools for Shopify Merchants”
 * English copy is the master; HTML fragments match structure across locales.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

function loadHtml(locale) {
  return readFileSync(join(dir, `main-${locale}.html`), "utf8");
}

/** Canonical URL segment (must match marketing hub paths, e.g. /resources/.../top-chargeback-management-tools-shopify). */
export const TOP_CHARGEBACK_SLUG = "top-chargeback-management-tools-shopify";
/** DB rows that should merge into the canonical article when syncing. */
export const TOP_CHARGEBACK_LEGACY_SLUGS = [
  "dispute-handling-time-case-study",
  "top-chargeback-management-tools-shopify-merchants",
];

/** @type {Record<string, { title: string; excerpt: string; metaTitle: string; metaDescription: string }>} */
export const TOP_CHARGEBACK_META = {
  "en-US": {
    title: "Top Chargeback Management Tools for Shopify Merchants",
    excerpt:
      "Chargebacks are not just a payments issue for Shopify merchants. They are an operations problem. Here is how the leading tools compare on workflow, control, and pricing.",
    metaTitle: "Top Chargeback Management Tools for Shopify Merchants in 2026",
    metaDescription:
      "Compare the top chargeback management tools for Shopify merchants. See pricing, pros and cons, and why DisputeDesk is the best choice for operational control and predictable costs.",
  },
  "de-DE": {
    title: "Die besten Chargeback-Management-Tools für Shopify-Händler",
    excerpt:
      "Chargebacks sind für Shopify-Händler nicht nur ein Zahlungsthema. Sie sind ein Operationsproblem. So schneiden die führenden Tools bei Workflow, Kontrolle und Preisen ab.",
    metaTitle: "Die besten Chargeback-Management-Tools für Shopify-Händler 2026",
    metaDescription:
      "Vergleichen Sie die führenden Chargeback-Management-Tools für Shopify-Händler. Preise, Vor- und Nachteile — und warum DisputeDesk die beste Wahl für operative Kontrolle und planbare Kosten ist.",
  },
  "fr-FR": {
    title: "Les meilleurs outils de gestion des rétrofacturations pour les marchands Shopify",
    excerpt:
      "Pour les marchands Shopify, les rétrofacturations ne sont pas qu’un sujet de paiement. C’est un problème opérationnel. Voici comment les principaux outils se comparent sur le workflow, le contrôle et les tarifs.",
    metaTitle: "Meilleurs outils de gestion des rétrofacturations pour marchands Shopify en 2026",
    metaDescription:
      "Comparez les principaux outils de gestion des rétrofacturations pour les marchands Shopify. Tarifs, avantages et limites — et pourquoi DisputeDesk est le meilleur choix pour le contrôle opérationnel et des coûts prévisibles.",
  },
  "es-ES": {
    title: "Las mejores herramientas de gestión de contracargos para comerciantes Shopify",
    excerpt:
      "Los contracargos no son solo un tema de pagos para los comerciantes de Shopify. Son un problema operativo. Así se comparan las principales herramientas en flujo de trabajo, control y precios.",
    metaTitle: "Mejores herramientas de gestión de contracargos para comerciantes Shopify en 2026",
    metaDescription:
      "Compare las principales herramientas de gestión de contracargos para comerciantes Shopify. Precios, pros y contras, y por qué DisputeDesk es la mejor opción para el control operativo y costes predecibles.",
  },
  "pt-BR": {
    title: "Principais ferramentas de gestão de chargebacks para lojistas Shopify",
    excerpt:
      "Chargebacks não são só uma questão de pagamentos para lojistas Shopify. São um problema operacional. Veja como as principais ferramentas se comparam em fluxo de trabalho, controle e preços.",
    metaTitle: "Principais ferramentas de gestão de chargebacks para lojistas Shopify em 2026",
    metaDescription:
      "Compare as principais ferramentas de gestão de chargebacks para lojistas Shopify. Preços, prós e contras, e por que a DisputeDesk é a melhor escolha para controle operacional e custos previsíveis.",
  },
  "sv-SE": {
    title: "Toppverktyg för chargeback-hantering för Shopify-handlare",
    excerpt:
      "Chargebacks är inte bara en betalningsfråga för Shopify-handlare. Det är ett operationsproblem. Så här jämför ledande verktyg i arbetsflöde, kontroll och prissättning.",
    metaTitle: "Toppverktyg för chargeback-hantering för Shopify-handlare 2026",
    metaDescription:
      "Jämför de främsta verktygen för chargeback-hantering för Shopify-handlare. Se priser, för- och nackdelar, och varför DisputeDesk är bäst för operativ kontroll och förutsägbara kostnader.",
  },
};

const LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

export function getTopChargebackManagementToolsArticleEntry() {
  const content = {};
  for (const locale of LOCALES) {
    const m = TOP_CHARGEBACK_META[locale];
    content[locale] = {
      title: m.title,
      excerpt: m.excerpt,
      body: { mainHtml: loadHtml(locale) },
      metaTitle: m.metaTitle,
      metaDescription: m.metaDescription,
    };
  }
  return {
    slug: TOP_CHARGEBACK_SLUG,
    pillar: "dispute-management-software",
    type: "cluster_article",
    readingTime: 18,
    tags: ["chargebacks", "merchants", "compliance"],
    content,
  };
}
