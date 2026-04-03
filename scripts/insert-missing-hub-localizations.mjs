/**
 * Inserts published hub localizations that were missing (locale coverage gaps).
 * Idempotent: skips if a row already exists for content_item_id + locale.
 *
 * Requires: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: node scripts/insert-missing-hub-localizations.mjs
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

const now = new Date().toISOString();

const INSERTS = [
  {
    content_item_id: "d3ec0c17-8449-4555-ac63-190cc07e29a7",
    locale: "fr-FR",
    route_kind: "resources",
    slug: "preuve-livraison-retrofacturation-shopify-insuffisante",
    title: "La preuve de livraison ne suffit pas toujours en cas de rétrofacturation",
    excerpt:
      "Découvrez pourquoi la seule preuve de livraison peut échouer dans les rétrofacturations Shopify et comment renforcer votre dossier avec des preuves complémentaires.",
    meta_title: "Preuve de livraison et rétrofacturations Shopify | DisputeDesk",
    meta_description:
      "Comprenez les limites de la preuve de livraison face aux rétrofacturations Shopify et les preuves à ajouter pour défendre votre dossier.",
    og_title: "",
    og_description: "",
    reading_time_minutes: 2,
    translation_status: "complete",
    body_json: {
      faq: [
        {
          q: "Pourquoi la preuve de livraison ne suffit-elle pas pour certains chargebacks ?",
          a: "Elle confirme l’expédition mais ne couvre pas les cas de produit défectueux, de description inexacte ou de transaction non autorisée.",
        },
        {
          q: "Quelles preuves ajouter en complément de la POD ?",
          a: "Communications avec le client, cohérence appareil/IP, journaux d’accès ou d’usage pour les biens et services numériques.",
        },
        {
          q: "Comment soumettre efficacement des preuves sur Shopify ?",
          a: "Étiquetez chaque pièce, résumez son utilité et organisez-les pour faciliter la lecture dans l’interface de litige.",
        },
      ],
      mainHtml: `<h2>Pourquoi la preuve de livraison seule peut être insuffisante</h2><p>De nombreux marchands Shopify s’appuient fortement sur la preuve de livraison (POD) pour contester les rétrofacturations, en particulier pour les litiges « Article non reçu » (INR). La POD n’est toutefois pas une réponse à tout. Elle confirme qu’un colis est arrivé, mais pas les litiges « nettement non conformes à la description » (SNAD) ni la fraude. Comprendre ses limites est indispensable.</p><h2>Quand la POD suffit et quand elle ne suffit pas</h2><p>La POD est pertinente lorsque la seule question est la livraison. Elle faiblit si le client invoque un défaut, une erreur de description ou une transaction non autorisée — la POD ne prouve pas la légitimité de l’achat dans ces cas.</p><h2>Renforcer votre dossier : au-delà de la POD</h2><p>Pour défendre une rétrofacturation, complétez la POD par :</p><ul><li><strong>Communications client :</strong> fils d’e-mails ou chats montrant réception et satisfaction.</li><li><strong>Appareil et IP :</strong> lorsque c’est pertinent, des éléments montrant que l’achat correspond aux habitudes du client.</li><li><strong>Preuve de service :</strong> pour le numérique, journaux ou captures prouvant l’usage par le client.</li></ul><h2>Soumission des preuves sur Shopify</h2><p>Sur Shopify, soyez clair : nommez chaque fichier et expliquez en une phrase son lien avec le litige. Facilitez la navigation pour l’examinateur.</p><h2>Visa Compelling Evidence 3.0 et checklist</h2><p>Consultez les exigences Visa CE 3.0 et une checklist de preuves avant envoi pour couvrir tous les angles utiles.</p><p>Pour aller plus loin, voir notre hub chargebacks Shopify et nos ressources Visa CE 3.0 et checklist des preuves.</p><h2>Conclusion</h2><p>La POD est une pièce clé mais souvent insuffisante seule. En la complétant, vous améliorez nettement vos chances. Pour automatiser la préparation des dossiers, envisagez une démo DisputeDesk.</p>`,
      disclaimer:
        "Ce contenu est fourni à titre informatif uniquement et ne constitue pas un conseil juridique.",
      keyTakeaways: [
        "La POD ne couvre pas tous les motifs de rétrofacturation.",
        "Ajoutez communications, cohérence appareil/IP et preuves de service lorsque c’est pertinent.",
        "Structurez les preuves clairement dans l’interface Shopify.",
      ],
    },
  },
  {
    content_item_id: "d3ec0c17-8449-4555-ac63-190cc07e29a7",
    locale: "sv-SE",
    route_kind: "resources",
    slug: "leveransbevis-aterbetalningskrav-shopify-racker-inte-alltid",
    title: "Leveransbevis räcker inte alltid vid ett återbetalningskrav",
    excerpt:
      "Lär dig varför leveransbevis ensamt kan falla vid Shopify-återbetalningskrav och hur du kompletterar med ytterligare dokumentation.",
    meta_title: "Leveransbevis och Shopify-återbetalningskrav | DisputeDesk",
    meta_description:
      "Förstå begränsningarna med leveransbevis i Shopify-tvister och vilka ytterligare bevis som stärker ditt ärende.",
    og_title: "",
    og_description: "",
    reading_time_minutes: 2,
    translation_status: "complete",
    body_json: {
      faq: [
        {
          q: "Varför räcker inte leveransbevis för alla chargebacks?",
          a: "Det visar att något levererats men täcker inte fel produkt, fel beskrivning eller obehöriga transaktioner.",
        },
        {
          q: "Vilka bevis ska jag lägga till utöver POD?",
          a: "Kundkommunikation, enhet/IP-stöd samt loggar eller skärmdumpar för digital leverans eller tjänst.",
        },
        {
          q: "Hur lämnar jag in bevis i Shopify på ett bra sätt?",
          a: "Märk varje fil, förklara kort relevans och håll ordning så granskaren hittar snabbt.",
        },
      ],
      mainHtml: `<h2>Varför leveransbevis ensamt kan falla</h2><p>Många Shopify-handlare förlitar sig på leveransbevis (POD) mot återbetalningskrav, särskilt vid «vare ej mottagen». POD bekräftar leverans men löser inte tvister om varan inte stämmer med beskrivningen eller vid bedrägeri.</p><h2>När POD räcker och när det inte gör det</h2><p>POD är starkt när enda frågan är om paketet kom fram. Det räcker sällan vid SNAD, tveksam kvalitet eller obehöriga köp.</p><h2>Stärk bevisningen utöver POD</h2><ul><li><strong>Kunddialog:</strong> mejl eller chatt som visar mottagande och nöjdhet.</li><li><strong>Enhet/IP:</strong> när det är relevant, data som stödjer att köpet följer kundens mönster.</li><li><strong>Tjänstebevis:</strong> för digitalt innehåll, loggar som visar användning.</li></ul><h2>Inlämning i Shopify</h2><p>Var tydlig med namngivning och korta förklaringar. Gör det lätt att följa kedjan av bevis.</p><h2>Visa Compelling Evidence 3.0</h2><p>Läs riktlinjerna och använd en checklista innan du skickar in.</p><p>Se även vårt hub om Shopify chargebacks och sidor om Visa CE 3.0 och bevis-checklistor.</p><h2>Slutsats</h2><p>Leveransbevis är viktigt men sällan tillräckligt ensamt. Komplettera strategiskt och överväg demo av DisputeDesk för effektivare hantering.</p>`,
      disclaimer:
        "Innehållet är endast informativt och utgör inte juridisk rådgivning.",
      keyTakeaways: [
        "POD täcker inte alla typer av återbetalningskrav.",
        "Komplettera med kommunikation, enhet/IP och tjänstebevis när det passar.",
        "Strukturera tydligt i Shopifys gränssnitt.",
      ],
    },
  },
  {
    content_item_id: "5bd41204-50a3-4f6a-9785-57f0715a8dbd",
    locale: "de-DE",
    route_kind: "resources",
    slug: "chargeback-praevention-checkliste-neue-shopify-shops",
    title: "Chargeback-Präventions-Checkliste für neue Shopify-Shops",
    excerpt:
      "Wesentliche Schritte für neue Shopify-Händler: sichtbare Richtlinien, Betrugsschutz und kommunikative Vorbeugung — jetzt umsetzen.",
    meta_title: "Chargeback-Prävention für neue Shopify-Shops | DisputeDesk",
    meta_description:
      "Verhindern Sie Chargebacks in neuen Shopify-Shops mit dieser Checkliste: Richtlinien, Betrugsabwehr, Abrechnungsname und mehr.",
    og_title: "",
    og_description: "",
    reading_time_minutes: 2,
    translation_status: "complete",
    body_json: {
      faq: [
        {
          q: "Warum sind sichtbare Richtlinien wichtig?",
          a: "Sie setzen Erwartungen und reduzieren Missverständnisse, die zu Chargebacks führen.",
        },
        {
          q: "Welche Tools helfen gegen Betrug?",
          a: "Shopifys Fraud-Analyse sowie Drittanbieter wie Signifyd oder NoFraud können verdächtige Bestellungen erkennen.",
        },
        {
          q: "Wie oft sollte ich die Checkliste prüfen?",
          a: "Nach größeren Shop-Änderungen oder wenn Chargebacks zunehmen.",
        },
      ],
      mainHtml: `<h2>1. Richtlinien gut sichtbar machen</h2><p>Erstattungs-, Rückgabe- und Versandrichtlinien auf Produktseiten, Checkout und in Bestätigungsmails klar platzieren. Transparenz senkt Streitpotenzial.</p><h2>2. Betrugserkennung aktivieren</h2><p>Shopify-Fraud-Tools nutzen und optional Signifyd oder NoFraud anbinden, um riskante Bestellungen früh zu sehen.</p><h2>3. Erkennbaren Abrechnungsnamen verwenden</h2><p>Der Name auf der Kartenabrechnung sollte zum Shop passen — das verringert «unbekannte» Belastungen und Streitfälle.</p><h2>4. Erfüllungsnachweise sichern</h2><p>Tracking und bei hohem Wert ggf. Unterschrift. Trackingnummern und Zustellnachweise für spätere Beweisführung aufbewahren.</p><h2>5. Proaktiv kommunizieren</h2><p>Verzögerungen und Statusänderungen früh mitteilen — Unzufriedenheit und Chargebacks sinken.</p><h2>6. Abos transparent gestalten</h2><p>Bei Abos Konditionen klar zeigen und vor Abrechnung erinnern, um Überraschungsbelastungen zu vermeiden.</p><h2>Häufige Fehler</h2><ul><li>Veraltete Richtlinien.</li><li>Fraud-Hinweise ignorieren.</li><li>Unklare Abrechnungsnamen.</li></ul><h2>Wann die Checkliste wiederholen?</h2><p>Bei neuen Produkten, Richtlinien-Updates oder steigender Chargeback-Rate.</p>`,
      disclaimer:
        "Dieser Inhalt dient nur zur Information und stellt keine Rechtsberatung dar.",
      keyTakeaways: [
        "Klare Richtlinien und sichtbare Kommunikation reduzieren Chargebacks.",
        "Betrugstools konsequent nutzen.",
        "Nachweise zur Erfüllung systematisch speichern.",
      ],
    },
  },
  {
    content_item_id: "5bd41204-50a3-4f6a-9785-57f0715a8dbd",
    locale: "fr-FR",
    route_kind: "resources",
    slug: "checklist-prevention-retrofacturations-nouvelles-boutiques-shopify",
    title: "Checklist de prévention des rétrofacturations pour les nouvelles boutiques Shopify",
    excerpt:
      "Étapes essentielles pour les nouveaux marchands : visibilité des politiques, lutte contre la fraude et communication proactive.",
    meta_title: "Prévention des rétrofacturations : nouvelles boutiques Shopify | DisputeDesk",
    meta_description:
      "Réduisez les rétrofacturations sur une nouvelle boutique Shopify : politiques, anti-fraude, descripteur de facturation et suivi des commandes.",
    og_title: "",
    og_description: "",
    reading_time_minutes: 2,
    translation_status: "complete",
    body_json: {
      faq: [
        {
          q: "Pourquoi la visibilité des politiques compte-t-elle ?",
          a: "Elle cadre les attentes des clients et limite les malentendus à l’origine de rétrofacturations.",
        },
        {
          q: "Quels outils anti-fraude utiliser ?",
          a: "L’analyse frauduleuse Shopify et des services tiers comme Signifyd ou NoFraud aident à repérer les commandes à risque.",
        },
        {
          q: "Quand revoir cette checklist ?",
          a: "Après un changement majeur du catalogue ou si les rétrofacturations augmentent.",
        },
      ],
      mainHtml: `<h2>1. Rendre les politiques visibles</h2><p>Remboursements, retours et livraison : affichez-les sur fiches produit, checkout et e-mails de confirmation.</p><h2>2. Activer la détection de fraude</h2><p>Utilisez les outils Shopify et envisagez Signifyd ou NoFraud pour bloquer ou examiner les commandes suspectes.</p><h2>3. Descripteur de carte clair</h2><p>Le nom qui apparaît sur le relevé doit évoquer votre boutique afin d’éviter les contestations « je ne reconnais pas ce paiement ».</p><h2>4. Conserver des preuves d’expédition</h2><p>Suivi, preuve de remise, surtout pour les commandes à forte valeur.</p><h2>5. Communiquer tôt</h2><p>Retards et changements de statut : informez le client pour limiter les mécontentements.</p><h2>6. Abonnements transparents</h2><p>Conditions visibles et rappels avant prélèvement pour éviter les contestations de facturation.</p><h2>Erreurs fréquentes</h2><ul><li>Politiques non mises à jour.</li><li>Alertes fraude ignorées.</li><li>Descripteur vague sur le relevé bancaire.</li></ul><h2>Quand actualiser ?</h2><p>Lors d’évolution du catalogue, des politiques ou si la courbe des rétrofacturations grimpe.</p>`,
      disclaimer:
        "Ce contenu est fourni à titre informatif uniquement et ne constitue pas un conseil juridique.",
      keyTakeaways: [
        "Politiques claires et visibles.",
        "Outils anti-fraude et surveillance des commandes.",
        "Communication proactive avec les clients.",
      ],
    },
  },
];

async function main() {
  for (const row of INSERTS) {
    const { data: existing } = await sb
      .from("content_localizations")
      .select("id")
      .eq("content_item_id", row.content_item_id)
      .eq("locale", row.locale)
      .maybeSingle();

    if (existing) {
      console.log("Skip (exists):", row.locale, row.content_item_id);
      continue;
    }

    const payload = {
      content_item_id: row.content_item_id,
      locale: row.locale,
      route_kind: row.route_kind,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      body_json: row.body_json,
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      og_title: row.og_title,
      og_description: row.og_description,
      reading_time_minutes: row.reading_time_minutes,
      is_published: true,
      publish_at: now,
      translation_status: row.translation_status,
      last_updated_at: now,
      updated_at: now,
    };

    const { error } = await sb.from("content_localizations").insert(payload);
    if (error) {
      console.error("Insert failed", row.locale, error.message);
      process.exit(1);
    }
    console.log("Inserted:", row.locale, row.slug);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
