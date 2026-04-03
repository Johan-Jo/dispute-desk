/**
 * One-time (re-runnable) updates for content_localizations where non–en-US SEO
 * titles still matched English. Paired with scripts/audit-hub-localization-titles.mjs.
 *
 * Requires: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: node scripts/fix-hub-localization-titles.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

/** @type {Array<{ content_item_id: string; locale: string; title?: string; meta_title?: string }>} */
const PATCHES = [
  // Pillar guide — localized H1 + meta (PT, ES); FR meta only
  {
    content_item_id: "b14d6e4b-50bc-4eaf-b92b-f7fb7c15f3da",
    locale: "pt-BR",
    title: "Chargebacks no Shopify: guia prático para lojistas",
    meta_title: "Chargebacks no Shopify: guia prático | DisputeDesk",
  },
  {
    content_item_id: "b14d6e4b-50bc-4eaf-b92b-f7fb7c15f3da",
    locale: "es-ES",
    title: "Contracargos en Shopify: guía práctica para comercios",
    meta_title: "Contracargos en Shopify: guía práctica | DisputeDesk",
  },
  {
    content_item_id: "b14d6e4b-50bc-4eaf-b92b-f7fb7c15f3da",
    locale: "fr-FR",
    meta_title: "Rétrofacturations Shopify : guide pratique | DisputeDesk",
  },
  // Inquiry vs chargeback — PT/SV meta + SV title
  {
    content_item_id: "4e8540d2-b3c1-4685-b8c6-b01e8e0f7cae",
    locale: "pt-BR",
    meta_title: "Inquiry de chargeback vs chargeback no Shopify | DisputeDesk",
  },
  {
    content_item_id: "4e8540d2-b3c1-4685-b8c6-b01e8e0f7cae",
    locale: "sv-SE",
    title: "Återbetalningsförfrågan kontra chargeback i Shopify",
    meta_title: "Återbetalningsförfrågan vs chargeback i Shopify | DisputeDesk",
  },
  // Issuer response — DE + SV
  {
    content_item_id: "3af36108-9fa6-43b7-96b3-d52d2cbefa4d",
    locale: "de-DE",
    title: "Issuer-Antwort in Shopify: Warum Sie gewonnen oder verloren haben",
    meta_title: "Issuer-Antwort in Shopify: gewonnen oder verloren | DisputeDesk",
  },
  {
    content_item_id: "3af36108-9fa6-43b7-96b3-d52d2cbefa4d",
    locale: "sv-SE",
    title: "Utfärdarens svar i Shopify: varför du vann eller förlorade",
    meta_title: "Utfärdarens svar i Shopify: vinst eller förlust | DisputeDesk",
  },
  // Proof of delivery — DE meta
  {
    content_item_id: "d3ec0c17-8449-4555-ac63-190cc07e29a7",
    locale: "de-DE",
    meta_title: "Zustellnachweis und Shopify-Rückbuchungen | DisputeDesk",
  },
  // Evidence checklist
  {
    content_item_id: "8d3ae4f1-b7be-4037-be85-c341a2301e71",
    locale: "de-DE",
    title: "Checkliste für Shopify-Chargeback-Beweise",
    meta_title: "Shopify-Chargeback-Beweise: Checkliste | DisputeDesk",
  },
  {
    content_item_id: "8d3ae4f1-b7be-4037-be85-c341a2301e71",
    locale: "fr-FR",
    meta_title: "Checklist preuves rétrofacturations Shopify | DisputeDesk",
  },
  {
    content_item_id: "8d3ae4f1-b7be-4037-be85-c341a2301e71",
    locale: "es-ES",
    meta_title: "Checklist de evidencia para contracargos en Shopify | DisputeDesk",
  },
  {
    content_item_id: "8d3ae4f1-b7be-4037-be85-c341a2301e71",
    locale: "pt-BR",
    meta_title: "Checklist de evidências para chargebacks no Shopify | DisputeDesk",
  },
  {
    content_item_id: "8d3ae4f1-b7be-4037-be85-c341a2301e71",
    locale: "sv-SE",
    title: "Checklista för bevis vid Shopify-återbetalningskrav",
    meta_title: "Bevis vid Shopify-återbetalningskrav: checklista | DisputeDesk",
  },
  // Visa CE 3.0 — distinct localized meta
  {
    content_item_id: "de9aec83-c7e9-4c1e-89fc-a6f5a4ed84cb",
    locale: "de-DE",
    meta_title: "Visa Compelling Evidence 3.0: Leitfaden für Shopify-Händler | DisputeDesk",
  },
  {
    content_item_id: "de9aec83-c7e9-4c1e-89fc-a6f5a4ed84cb",
    locale: "pt-BR",
    meta_title: "Visa Compelling Evidence 3.0 no Shopify: guia para lojistas | DisputeDesk",
  },
];

async function main() {
  const now = new Date().toISOString();
  for (const p of PATCHES) {
    const updates = { updated_at: now };
    if (p.title !== undefined) updates.title = p.title;
    if (p.meta_title !== undefined) updates.meta_title = p.meta_title;

    const { error } = await sb
      .from("content_localizations")
      .update(updates)
      .eq("content_item_id", p.content_item_id)
      .eq("locale", p.locale);

    if (error) {
      console.error("Update failed", p, error.message);
      process.exit(1);
    }
    console.log("OK", p.locale, p.content_item_id.slice(0, 8), Object.keys(updates).filter((k) => k !== "updated_at").join("+") || "timestamp-only");
  }
  console.log(`\nApplied ${PATCHES.length} localization patches.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
