/**
 * Seeds Resources Hub: authors, CTA, 10 content items × 6 locales, tags, 100 archive rows.
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY (CMS tables from `npm run db:migrate`).
 *
 * Usage:
 *   node scripts/seed-resources-hub.mjs           # skip if launch slug + archive already exist
 *   node scripts/seed-resources-hub.mjs --force # delete all hub rows (FK order) then seed fresh
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

const LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-PT", "sv-SE"];

const LAUNCH = [
  {
    slug: "chargeback-prevention-checklist",
    pillar: "chargebacks",
    type: "cluster_article",
    titles: {
      "en-US": "Chargeback Prevention Checklist",
      "de-DE": "Checkliste zur Chargeback-Prävention",
      "fr-FR": "Checklist de prévention des rétrofacturations",
      "es-ES": "Lista de prevención de contracargos",
      "pt-PT": "Checklist de prevenção de chargebacks",
      "sv-SE": "Checklista för chargeback-prevention",
    },
  },
  {
    slug: "chargebacks-faq-timelines-fees-next-steps",
    pillar: "chargebacks",
    type: "cluster_article",
    titles: {
      "en-US": "Chargebacks FAQ: Timelines, Fees, and Next Steps",
      "de-DE": "Chargebacks-FAQ: Fristen, Gebühren und nächste Schritte",
      "fr-FR": "FAQ rétrofacturations : délais, frais et prochaines étapes",
      "es-ES": "FAQ de contracargos: plazos, comisiones y siguientes pasos",
      "pt-PT": "FAQ de chargebacks: prazos, taxas e próximos passos",
      "sv-SE": "Chargebacks FAQ: tidslinjer, avgifter och nästa steg",
    },
  },
  {
    slug: "how-to-build-a-chargeback-evidence-pack",
    pillar: "chargebacks",
    type: "cluster_article",
    titles: {
      "en-US": "How to Build a Chargeback Evidence Pack",
      "de-DE": "So erstellen Sie ein Chargeback-Evidenzenpaket",
      "fr-FR": "Comment constituer un dossier de preuves pour rétrofacturation",
      "es-ES": "Cómo crear un paquete de pruebas para contracargos",
      "pt-PT": "Como montar um pacote de evidências de chargeback",
      "sv-SE": "Så bygger du ett chargeback-bevispaket",
    },
  },
  {
    slug: "chargeback-rebuttal-letter-template",
    pillar: "chargebacks",
    type: "template",
    titles: {
      "en-US": "Chargeback Rebuttal Letter Template",
      "de-DE": "Vorlage für ein Chargeback-Widerspruchsschreiben",
      "fr-FR": "Modèle de lettre de réponse à une rétrofacturation",
      "es-ES": "Plantilla de carta de réplica ante contracargos",
      "pt-PT": "Modelo de carta de contestação de chargeback",
      "sv-SE": "Mall för chargeback-motpartsbrev",
    },
  },
  {
    slug: "mediation-vs-arbitration-vs-small-claims",
    pillar: "mediation-arbitration",
    type: "cluster_article",
    titles: {
      "en-US": "Mediation vs Arbitration vs Small Claims",
      "de-DE": "Mediation vs. Schiedsverfahren vs. Bagatellverfahren",
      "fr-FR": "Médiation, arbitrage et petites créances",
      "es-ES": "Mediación vs arbitraje vs pequeñas reclamaciones",
      "pt-PT": "Mediação vs arbitragem vs pequenas causas",
      "sv-SE": "Medling vs skiljedom vs småmål",
    },
  },
  {
    slug: "how-to-write-a-demand-letter",
    pillar: "dispute-resolution",
    type: "cluster_article",
    titles: {
      "en-US": "How to Write a Demand Letter That Gets a Response",
      "de-DE": "So schreiben Sie ein Mahnschreiben, das Antwort auslöst",
      "fr-FR": "Rédiger une mise en demeure qui obtient une réponse",
      "es-ES": "Cómo redactar una carta de reclamación que obtenga respuesta",
      "pt-PT": "Como escrever uma carta de exigência que gere resposta",
      "sv-SE": "Skriv ett kravbrev som får svar",
    },
  },
  {
    slug: "dispute-handling-time-case-study",
    pillar: "dispute-management-software",
    type: "case_study",
    titles: {
      "en-US": "How a Team Cut Dispute Handling Time by 60%",
      "de-DE": "Wie ein Team die Bearbeitungszeit um 60 % senkte",
      "fr-FR": "Comment une équipe a réduit de 60 % le temps de traitement",
      "es-ES": "Cómo un equipo redujo un 60 % el tiempo de gestión de disputas",
      "pt-PT": "Como uma equipe reduziu 60% do tempo de tratamento de disputas",
      "sv-SE": "Hur ett team minskade handläggningstiden med 60 %",
    },
  },
  {
    slug: "policy-update-roundup",
    pillar: "dispute-resolution",
    type: "legal_update",
    titles: {
      "en-US": "Policy Update Roundup",
      "de-DE": "Rundum zu Policy-Updates",
      "fr-FR": "Tour d’horizon des mises à jour juridiques",
      "es-ES": "Resumen de actualizaciones normativas",
      "pt-PT": "Resumo de atualizações de políticas",
      "sv-SE": "Sammanfattning av policyuppdateringar",
    },
  },
  {
    slug: "dispute-resolution-process-playbook",
    pillar: "dispute-resolution",
    type: "pillar_page",
    titles: {
      "en-US": "Dispute Resolution Process: Step-by-Step Playbook",
      "de-DE": "Streitbeilegung: Schritt-für-Schritt-Playbook",
      "fr-FR": "Processus de résolution des litiges : guide pas à pas",
      "es-ES": "Proceso de resolución de disputas: guía paso a paso",
      "pt-PT": "Processo de resolução de disputas: guia passo a passo",
      "sv-SE": "Process för tvistlösning: steg-för-steg-playbook",
    },
  },
  {
    slug: "online-dispute-resolution-odr-guide",
    pillar: "dispute-resolution",
    type: "cluster_article",
    titles: {
      "en-US": "Online Dispute Resolution: When ODR Works",
      "de-DE": "Online-Streitbeilegung: Wenn ODR funktioniert",
      "fr-FR": "Résolution en ligne des litiges : quand la RLL fonctionne",
      "es-ES": "Resolución de disputas en línea: cuándo funciona la RLL",
      "pt-PT": "Resolução de disputas online: quando a RLL funciona",
      "sv-SE": "Onlinetvistlösning: när det fungerar",
    },
  },
];

function excerptFor(title) {
  return `${title.slice(0, 140)}…`;
}

/** Delete in batches (PostgREST has no TRUNCATE). FK-safe order for migration 030. */
async function deleteAllRows(table, idColumn = "id") {
  for (;;) {
    const { data, error } = await sb.from(table).select(idColumn).limit(500);
    if (error) throw error;
    if (!data?.length) break;
    const ids = data.map((r) => r[idColumn]);
    const { error: delErr } = await sb.from(table).delete().in(idColumn, ids);
    if (delErr) throw delErr;
  }
}

/** Wipe Resources Hub tables. Does not touch cms_settings singleton. */
async function clearResourcesHubData() {
  console.log("Clearing Resources Hub tables…");
  await deleteAllRows("content_publish_queue");
  await deleteAllRows("content_items");
  await deleteAllRows("content_archive_items");
  await deleteAllRows("content_tags");
  await deleteAllRows("content_ctas");
  await deleteAllRows("authors");
  await deleteAllRows("reviewers");
  console.log("Cleared.");
}

async function getOrCreateAuthor() {
  const { data: existing } = await sb
    .from("authors")
    .select("id")
    .eq("name", "DisputeDesk Editorial")
    .maybeSingle();
  if (existing?.id) return existing;
  const { data, error } = await sb
    .from("authors")
    .insert({ name: "DisputeDesk Editorial", role: "Editorial", bio: "In-house editorial team." })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

async function getOrCreateCta() {
  const { data: existing } = await sb
    .from("content_ctas")
    .select("id")
    .eq("event_name", "resource_primary_cta")
    .maybeSingle();
  if (existing?.id) return existing;
  const { data, error } = await sb
    .from("content_ctas")
    .insert({
      type: "link",
      destination: "/portal/connect-shopify",
      event_name: "resource_primary_cta",
      localized_copy_json: { "en-US": { label: "Get started" } },
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

async function getOrCreateTagIds() {
  const tagKeys = ["chargebacks", "evidence", "disputes", "merchants", "compliance", "odr"];
  const tagIds = {};
  for (const key of tagKeys) {
    const { data: ex } = await sb.from("content_tags").select("id").eq("key", key).maybeSingle();
    if (ex?.id) {
      tagIds[key] = ex.id;
      continue;
    }
    const { data, error } = await sb.from("content_tags").insert({ key }).select("id").single();
    if (error) throw error;
    tagIds[key] = data.id;
  }
  return tagIds;
}

async function main() {
  const force =
    process.argv.includes("--force") || process.env.FORCE_RESOURCES_SEED === "1";

  if (force) {
    await clearResourcesHubData();
  }

  const author = await getOrCreateAuthor();
  const cta = await getOrCreateCta();
  const tagIds = await getOrCreateTagIds();

  const { count: existingArticles } = await sb
    .from("content_localizations")
    .select("*", { count: "exact", head: true })
    .eq("route_kind", "resources")
    .eq("slug", LAUNCH[0].slug)
    .eq("locale", "en-US");

  if (!force && existingArticles && existingArticles > 0) {
    console.log("Seed skipped: launch content already present (first slug exists). Use --force to replace.");
  } else {
  for (const entry of LAUNCH) {
    const { data: item, error: ie } = await sb
      .from("content_items")
      .insert({
        content_type: entry.type,
        primary_pillar: entry.pillar,
        audience: "merchant",
        funnel_stage: "awareness",
        workflow_status: "published",
        author_id: author?.id,
        primary_cta_id: cta?.id,
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (ie) throw ie;

    const three = ["chargebacks", "evidence", "disputes"];
    for (const k of three) {
      await sb.from("content_item_tags").insert({ content_item_id: item.id, tag_id: tagIds[k] });
    }

    for (const locale of LOCALES) {
      const title = entry.titles[locale];
      const slug = entry.slug;
      const body = {
        mainHtml: `<p><strong>Outline</strong> — expand in CMS. Section 1… Section 2…</p>`,
        keyTakeaways: ["Takeaway one", "Takeaway two", "Takeaway three"],
        faq: [{ q: "Who is this for?", a: "Merchants handling payment disputes." }],
      };
      await sb.from("content_localizations").insert({
        content_item_id: item.id,
        locale,
        route_kind: "resources",
        title,
        slug,
        excerpt: excerptFor(title),
        body_json: body,
        meta_title: `${title} | DisputeDesk`,
        meta_description: excerptFor(title).slice(0, 160),
        og_title: title,
        og_description: excerptFor(title).slice(0, 200),
        reading_time_minutes: 8,
        is_published: true,
        translation_status: "complete",
        last_updated_at: new Date().toISOString(),
      });
    }
  }
  }

  const { count: archCount } = await sb
    .from("content_archive_items")
    .select("*", { count: "exact", head: true })
    .like("proposed_slug", "archive-%");

  if (!force && archCount && archCount >= 100) {
    console.log("Archive seed skipped: 100+ archive rows already exist. Use --force to replace.");
  } else {

  const archivePillars = [
    ...Array(30).fill("chargebacks"),
    ...Array(20).fill("dispute-resolution"),
    ...Array(15).fill("mediation-arbitration"),
    ...Array(15).fill("small-claims"),
    ...Array(10).fill("dispute-management-software"),
    ...Array(10).fill("chargebacks"),
  ];

  for (let i = 0; i < 100; i++) {
    const pillar = archivePillars[i] ?? "chargebacks";
    const p = i < 30 ? 80 : i < 60 ? 55 : 35;
    await sb.from("content_archive_items").insert({
      proposed_title: `Archive idea ${i + 1}: ${pillar} topic`,
      proposed_slug: `archive-${i + 1}`,
      target_locale_set: LOCALES,
      content_type: "cluster_article",
      primary_pillar: pillar,
      priority_score: p,
      target_keyword: `${pillar} dispute`,
      search_intent: "informational",
      summary: "Seed backlog entry for editorial prioritization.",
      status: "backlog",
    });
  }
  }

  console.log(
    force
      ? "Seed complete (full refresh)."
      : "Seed complete (or partially skipped if already present; use --force to replace).",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
