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
import {
  getTopChargebackManagementToolsArticleEntry,
  TOP_CHARGEBACK_LEGACY_SLUG,
  TOP_CHARGEBACK_SLUG,
} from "./hub-content/top-chargeback-management-tools-shopify-merchants/article.mjs";

config({ path: ".env.local" });

const TOP_CHARGEBACK_ARTICLE = getTopChargebackManagementToolsArticleEntry();

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

const LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

// ---------------------------------------------------------------------------
// ARTICLE CONTENT — real editorial content per locale
// ---------------------------------------------------------------------------

const ARTICLES = [
  // -----------------------------------------------------------------------
  // 1. Chargeback Prevention Checklist
  // -----------------------------------------------------------------------
  {
    slug: "chargeback-prevention-checklist",
    pillar: "chargebacks",
    type: "cluster_article",
    readingTime: 10,
    tags: ["chargebacks", "merchants", "compliance"],
    content: {
      "en-US": {
        title: "Chargeback Prevention Checklist",
        excerpt: "A step-by-step checklist that helps Shopify merchants prevent chargebacks before they happen — covering clear policies, delivery tracking, and proactive communication.",
        body: {
          mainHtml: `
<h2>Why prevention beats response</h2>
<p>Chargebacks cost more than the transaction amount. Every dispute carries processor fees, operational overhead, and potential escalation to monitoring programs. The most effective strategy is stopping disputes before they start.</p>

<h2>Pre-purchase safeguards</h2>
<h3>1. Write crystal-clear product descriptions</h3>
<p>Ambiguity triggers "item not as described" disputes. Include dimensions, materials, compatibility notes, and high-resolution images from multiple angles. If your product has known limitations, state them upfront — customers respect honesty.</p>

<h3>2. Display your refund and return policy prominently</h3>
<p>Place your policy link in the footer, cart page, and order confirmation email. Use plain language: "You have 30 days to return unused items for a full refund." Avoid legal jargon that customers skip over.</p>

<h3>3. Use a recognizable billing descriptor</h3>
<p>Customers who don't recognize a charge on their statement will dispute it reflexively. Ensure your payment processor shows your store name — not a parent company or abbreviation they've never seen.</p>

<h2>Fulfillment and delivery</h2>
<h3>4. Ship with tracking and signature confirmation</h3>
<p>For orders above your risk threshold (commonly $100+), require signature on delivery. Always send tracking numbers via email and SMS. This evidence is your strongest defense against "item not received" claims.</p>

<h3>5. Communicate delays before the customer notices</h3>
<p>If a shipment is delayed, email the customer the same day you learn about it. Offer options: wait, substitute, or cancel. Proactive communication reduces disputes by up to 40%.</p>

<h2>Post-purchase protection</h2>
<h3>6. Send a delivery confirmation follow-up</h3>
<p>24 hours after delivery confirmation, send an email asking "Did everything arrive as expected?" This catches problems early and gives you a chance to resolve them before the customer calls their bank.</p>

<h3>7. Make your support easy to find</h3>
<p>If a customer can't find your contact information, they'll contact their bank instead. Put your support email, phone number, or chat widget on every page — especially the order confirmation and shipping notification emails.</p>

<h3>8. Monitor your chargeback ratio weekly</h3>
<p>Visa and Mastercard flag merchants whose chargeback ratio exceeds 0.9%. Track your ratio weekly. If it trends upward, investigate the root cause immediately — don't wait for a monitoring program notice.</p>

<h2>Build a paper trail</h2>
<p>Every email, tracking update, and customer interaction is potential evidence. Use a CRM or helpdesk that timestamps conversations. When a dispute does arrive, a complete paper trail is the difference between winning and losing.</p>`,
          keyTakeaways: [
            "Clear product descriptions and visible refund policies prevent 'item not as described' disputes",
            "Ship with tracking and require signature for high-value orders",
            "Proactive communication about delays cuts disputes by up to 40%",
            "Monitor your chargeback ratio weekly — Visa flags merchants above 0.9%",
            "Every customer interaction should be timestamped and stored as potential evidence"
          ],
          faq: [
            { q: "What is a good chargeback ratio?", a: "Below 0.65% is considered healthy. Visa's dispute monitoring program threshold is 0.9%, and Mastercard's Excessive Chargeback Program triggers at 1.5%. Stay well below these to avoid penalties." },
            { q: "How long do I have to respond to a chargeback?", a: "Typically 20–45 days depending on the card network and reason code. Visa gives 30 days for most codes; Mastercard allows 45 days. Always check the specific deadline in your processor's dashboard." },
            { q: "Does a refund prevent a chargeback?", a: "Only if processed before the customer files with their bank. Once the dispute is opened, a refund may not stop it. Act fast when a customer complains." }
          ],
          disclaimer: "This content is for informational purposes only and does not constitute legal or financial advice. Chargeback policies vary by card network, issuing bank, and region."
        }
      },
      "de-DE": {
        title: "Checkliste zur Chargeback-Prävention",
        excerpt: "Eine Schritt-für-Schritt-Checkliste, die Shopify-Händlern hilft, Chargebacks zu verhindern — mit klaren Richtlinien, Sendungsverfolgung und proaktiver Kommunikation.",
        body: {
          mainHtml: `
<h2>Warum Prävention besser ist als Reaktion</h2>
<p>Chargebacks kosten mehr als den Transaktionsbetrag. Jeder Streitfall verursacht Prozessorgebühren, operativen Aufwand und kann zu Überwachungsprogrammen führen. Die wirksamste Strategie ist es, Streitfälle zu verhindern, bevor sie entstehen.</p>

<h2>Maßnahmen vor dem Kauf</h2>
<h3>1. Verfassen Sie eindeutige Produktbeschreibungen</h3>
<p>Unklarheiten lösen „Artikel nicht wie beschrieben"-Streitfälle aus. Geben Sie Maße, Materialien, Kompatibilität und hochauflösende Bilder aus mehreren Blickwinkeln an. Wenn Ihr Produkt bekannte Einschränkungen hat, kommunizieren Sie diese offen.</p>

<h3>2. Zeigen Sie Ihre Rückgabe- und Erstattungsrichtlinie deutlich an</h3>
<p>Platzieren Sie den Link zu Ihrer Richtlinie in der Fußzeile, auf der Warenkorbseite und in der Bestellbestätigung. Verwenden Sie einfache Sprache: „Sie haben 30 Tage Zeit, unbenutzte Artikel gegen volle Rückerstattung zurückzugeben."</p>

<h3>3. Verwenden Sie einen erkennbaren Abrechnungsdeskriptor</h3>
<p>Kunden, die eine Abbuchung auf ihrem Kontoauszug nicht zuordnen können, werden diese reflexartig anfechten. Stellen Sie sicher, dass Ihr Zahlungsdienstleister Ihren Shopnamen anzeigt.</p>

<h2>Versand und Lieferung</h2>
<h3>4. Versenden Sie mit Sendungsverfolgung und Unterschriftsbestätigung</h3>
<p>Für Bestellungen über Ihrem Risikoschwellenwert (üblicherweise 100 €+) fordern Sie eine Unterschrift bei Lieferung an. Senden Sie immer Sendungsnummern per E-Mail und SMS.</p>

<h3>5. Kommunizieren Sie Verzögerungen, bevor der Kunde sie bemerkt</h3>
<p>Wenn eine Sendung verspätet ist, informieren Sie den Kunden am selben Tag. Bieten Sie Optionen an: warten, Ersatz oder Stornierung. Proaktive Kommunikation reduziert Streitfälle um bis zu 40 %.</p>

<h2>Schutz nach dem Kauf</h2>
<h3>6. Senden Sie eine Nachfass-E-Mail nach der Lieferung</h3>
<p>24 Stunden nach der Lieferbestätigung fragen Sie: „Ist alles wie erwartet angekommen?" So fangen Sie Probleme früh ab.</p>

<h3>7. Machen Sie Ihren Support leicht auffindbar</h3>
<p>Wenn ein Kunde Ihre Kontaktdaten nicht findet, wendet er sich stattdessen an seine Bank. Platzieren Sie Ihre Support-E-Mail und Telefonnummer auf jeder Seite.</p>

<h3>8. Überwachen Sie Ihre Chargeback-Quote wöchentlich</h3>
<p>Visa und Mastercard markieren Händler, deren Chargeback-Quote 0,9 % übersteigt. Verfolgen Sie Ihre Quote wöchentlich und untersuchen Sie sofort die Ursache bei steigendem Trend.</p>

<h2>Dokumentation aufbauen</h2>
<p>Jede E-Mail, jedes Tracking-Update und jede Kundeninteraktion ist potenzielles Beweismaterial. Verwenden Sie ein CRM oder Helpdesk, das Gespräche mit Zeitstempeln versieht.</p>`,
          keyTakeaways: [
            "Eindeutige Produktbeschreibungen und sichtbare Rückgaberichtlinien verhindern ‚Artikel nicht wie beschrieben'-Streitfälle",
            "Versenden Sie mit Sendungsverfolgung und fordern Sie Unterschriften für hochpreisige Bestellungen",
            "Proaktive Kommunikation bei Verzögerungen senkt Streitfälle um bis zu 40 %",
            "Überwachen Sie Ihre Chargeback-Quote wöchentlich — Visa markiert Händler ab 0,9 %",
            "Jede Kundeninteraktion sollte mit Zeitstempel gespeichert werden"
          ],
          faq: [
            { q: "Was ist eine gute Chargeback-Quote?", a: "Unter 0,65 % gilt als gesund. Visas Monitoring-Programm greift ab 0,9 %, Mastercards ab 1,5 %. Bleiben Sie deutlich darunter." },
            { q: "Wie lange habe ich Zeit, auf einen Chargeback zu reagieren?", a: "Üblicherweise 20–45 Tage, je nach Kartennetzwerk und Grundcode. Visa gibt 30 Tage, Mastercard 45 Tage." },
            { q: "Verhindert eine Rückerstattung einen Chargeback?", a: "Nur wenn sie verarbeitet wird, bevor der Kunde bei seiner Bank Einspruch erhebt. Handeln Sie schnell bei Beschwerden." }
          ],
          disclaimer: "Dieser Inhalt dient nur zu Informationszwecken und stellt keine Rechts- oder Finanzberatung dar."
        }
      },
      "fr-FR": {
        title: "Checklist de prévention des rétrofacturations",
        excerpt: "Une checklist étape par étape pour aider les marchands Shopify à prévenir les rétrofacturations — politiques claires, suivi de livraison et communication proactive.",
        body: {
          mainHtml: `
<h2>Pourquoi la prévention l'emporte sur la réaction</h2>
<p>Les rétrofacturations coûtent plus que le montant de la transaction. Chaque litige entraîne des frais de processeur, des coûts opérationnels et un risque d'entrée dans les programmes de surveillance. La stratégie la plus efficace est d'empêcher les litiges avant qu'ils ne surviennent.</p>

<h2>Mesures avant l'achat</h2>
<h3>1. Rédigez des descriptions produit parfaitement claires</h3>
<p>L'ambiguïté déclenche des litiges « article non conforme ». Incluez dimensions, matériaux, notes de compatibilité et images haute résolution sous plusieurs angles.</p>

<h3>2. Affichez votre politique de retour de manière visible</h3>
<p>Placez le lien vers votre politique dans le pied de page, la page panier et l'email de confirmation. Utilisez un langage simple : « Vous disposez de 30 jours pour retourner les articles non utilisés. »</p>

<h3>3. Utilisez un descripteur de facturation reconnaissable</h3>
<p>Les clients qui ne reconnaissent pas un débit sur leur relevé le contestent par réflexe. Assurez-vous que votre processeur affiche le nom de votre boutique.</p>

<h2>Expédition et livraison</h2>
<h3>4. Expédiez avec suivi et signature</h3>
<p>Pour les commandes au-dessus de votre seuil de risque (généralement 100 €+), exigez une signature à la livraison. Envoyez toujours les numéros de suivi par email et SMS.</p>

<h3>5. Communiquez les retards avant que le client ne les remarque</h3>
<p>Si une expédition est retardée, informez le client le jour même. Proposez des options : attendre, remplacer ou annuler. La communication proactive réduit les litiges jusqu'à 40 %.</p>

<h2>Protection après l'achat</h2>
<h3>6. Envoyez un suivi après livraison</h3>
<p>24 heures après la confirmation de livraison, envoyez un email demandant « Tout est-il arrivé comme prévu ? » Cela détecte les problèmes tôt.</p>

<h3>7. Rendez votre support facile à trouver</h3>
<p>Si un client ne trouve pas vos coordonnées, il contactera sa banque. Affichez votre email et téléphone de support sur chaque page.</p>

<h3>8. Surveillez votre taux de rétrofacturation chaque semaine</h3>
<p>Visa et Mastercard signalent les marchands dont le taux dépasse 0,9 %. Surveillez votre taux chaque semaine.</p>

<h2>Constituer un dossier</h2>
<p>Chaque email, mise à jour de suivi et interaction client est une preuve potentielle. Utilisez un CRM qui horodate les conversations.</p>`,
          keyTakeaways: [
            "Des descriptions produit claires et des politiques de retour visibles préviennent les litiges « non conforme »",
            "Expédiez avec suivi et exigez une signature pour les commandes de valeur élevée",
            "La communication proactive sur les retards réduit les litiges jusqu'à 40 %",
            "Surveillez votre taux de rétrofacturation chaque semaine — Visa signale au-delà de 0,9 %",
            "Chaque interaction client doit être horodatée et archivée"
          ],
          faq: [
            { q: "Quel est un bon taux de rétrofacturation ?", a: "En dessous de 0,65 % est considéré comme sain. Le programme de surveillance de Visa se déclenche à 0,9 %, celui de Mastercard à 1,5 %." },
            { q: "De combien de temps dispose-t-on pour répondre à une rétrofacturation ?", a: "Généralement 20 à 45 jours selon le réseau et le code motif. Visa accorde 30 jours, Mastercard 45 jours." },
            { q: "Un remboursement empêche-t-il une rétrofacturation ?", a: "Seulement s'il est traité avant que le client ne contacte sa banque. Agissez vite lors d'une réclamation." }
          ],
          disclaimer: "Ce contenu est fourni à titre informatif uniquement et ne constitue pas un conseil juridique ou financier."
        }
      },
      "es-ES": {
        title: "Lista de prevención de contracargos",
        excerpt: "Una lista paso a paso que ayuda a los comerciantes de Shopify a prevenir contracargos — con políticas claras, seguimiento de envíos y comunicación proactiva.",
        body: {
          mainHtml: `
<h2>Por qué la prevención es mejor que la reacción</h2>
<p>Los contracargos cuestan más que el monto de la transacción. Cada disputa conlleva comisiones del procesador, costes operativos y riesgo de entrar en programas de vigilancia. La estrategia más eficaz es detener las disputas antes de que comiencen.</p>

<h2>Medidas previas a la compra</h2>
<h3>1. Escriba descripciones de producto perfectamente claras</h3>
<p>La ambigüedad desencadena disputas por «artículo no conforme a la descripción». Incluya dimensiones, materiales, notas de compatibilidad e imágenes de alta resolución desde varios ángulos.</p>

<h3>2. Muestre su política de devoluciones de forma visible</h3>
<p>Coloque el enlace a su política en el pie de página, la página del carrito y el correo de confirmación. Use un lenguaje sencillo: «Tiene 30 días para devolver artículos sin usar.»</p>

<h3>3. Use un descriptor de facturación reconocible</h3>
<p>Los clientes que no reconocen un cargo en su extracto lo disputarán por reflejo. Asegúrese de que su procesador muestre el nombre de su tienda.</p>

<h2>Envío y entrega</h2>
<h3>4. Envíe con seguimiento y firma de entrega</h3>
<p>Para pedidos por encima de su umbral de riesgo (normalmente 100 €+), exija firma en la entrega. Envíe siempre los números de seguimiento por correo electrónico y SMS.</p>

<h3>5. Comunique los retrasos antes de que el cliente los note</h3>
<p>Si un envío se retrasa, informe al cliente el mismo día. Ofrezca opciones: esperar, sustituir o cancelar. La comunicación proactiva reduce las disputas hasta un 40 %.</p>

<h2>Protección postventa</h2>
<h3>6. Envíe un seguimiento tras la entrega</h3>
<p>24 horas después de la confirmación de entrega, envíe un correo preguntando «¿Ha llegado todo correctamente?» Esto detecta problemas a tiempo.</p>

<h3>7. Haga que su soporte sea fácil de encontrar</h3>
<p>Si un cliente no encuentra sus datos de contacto, contactará a su banco. Coloque su correo y teléfono de soporte en cada página.</p>

<h3>8. Monitorice su ratio de contracargos semanalmente</h3>
<p>Visa y Mastercard señalan a los comerciantes cuyo ratio supera el 0,9 %. Vigile su ratio semanalmente.</p>

<h2>Construir un expediente</h2>
<p>Cada correo, actualización de seguimiento e interacción con el cliente es evidencia potencial. Use un CRM que registre con marca de tiempo las conversaciones.</p>`,
          keyTakeaways: [
            "Descripciones claras de producto y políticas de devolución visibles previenen disputas «no conforme»",
            "Envíe con seguimiento y exija firma para pedidos de alto valor",
            "La comunicación proactiva sobre retrasos reduce disputas hasta un 40 %",
            "Monitorice su ratio de contracargos semanalmente — Visa señala a partir del 0,9 %",
            "Cada interacción con el cliente debe registrarse con marca de tiempo"
          ],
          faq: [
            { q: "¿Cuál es un buen ratio de contracargos?", a: "Por debajo del 0,65 % se considera saludable. El programa de vigilancia de Visa se activa al 0,9 %, el de Mastercard al 1,5 %." },
            { q: "¿Cuánto tiempo tengo para responder a un contracargo?", a: "Normalmente 20–45 días según la red y el código de motivo. Visa da 30 días, Mastercard 45 días." },
            { q: "¿Un reembolso previene un contracargo?", a: "Solo si se procesa antes de que el cliente contacte a su banco. Actúe rápido ante las reclamaciones." }
          ],
          disclaimer: "Este contenido es solo informativo y no constituye asesoramiento jurídico ni financiero."
        }
      },
      "pt-BR": {
        title: "Checklist de prevenção de chargebacks",
        excerpt: "Um checklist passo a passo que ajuda comerciantes Shopify a prevenir chargebacks — com políticas claras, rastreamento de entregas e comunicação proativa.",
        body: {
          mainHtml: `
<h2>Por que a prevenção é melhor que a reação</h2>
<p>Chargebacks custam mais do que o valor da transação. Cada disputa acarreta taxas do processador, custos operacionais e risco de entrar em programas de monitoramento. A estratégia mais eficaz é impedir disputas antes que comecem.</p>

<h2>Medidas pré-compra</h2>
<h3>1. Escreva descrições de produto perfeitamente claras</h3>
<p>Ambiguidade gera disputas de «item não conforme». Inclua dimensões, materiais, notas de compatibilidade e imagens de alta resolução de vários ângulos.</p>

<h3>2. Exiba sua política de devolução de forma visível</h3>
<p>Coloque o link da política no rodapé, na página do carrinho e no e-mail de confirmação. Use linguagem simples: «Você tem 30 dias para devolver itens não usados.»</p>

<h3>3. Use um descritor de cobrança reconhecível</h3>
<p>Clientes que não reconhecem uma cobrança no extrato a contestam por reflexo. Certifique-se de que seu processador exiba o nome da sua loja.</p>

<h2>Envio e entrega</h2>
<h3>4. Envie com rastreamento e confirmação de assinatura</h3>
<p>Para pedidos acima do seu limite de risco (geralmente R$ 500+), exija assinatura na entrega. Sempre envie números de rastreamento por e-mail e SMS.</p>

<h3>5. Comunique atrasos antes que o cliente perceba</h3>
<p>Se uma entrega atrasar, informe o cliente no mesmo dia. Ofereça opções: aguardar, substituir ou cancelar. Comunicação proativa reduz disputas em até 40%.</p>

<h2>Proteção pós-compra</h2>
<h3>6. Envie um acompanhamento após a entrega</h3>
<p>24 horas após a confirmação de entrega, envie um e-mail perguntando «Tudo chegou como esperado?» Isso detecta problemas cedo.</p>

<h3>7. Facilite o acesso ao seu suporte</h3>
<p>Se o cliente não encontra seus dados de contato, ele contacta o banco. Coloque e-mail e telefone de suporte em todas as páginas.</p>

<h3>8. Monitore sua taxa de chargeback semanalmente</h3>
<p>Visa e Mastercard sinalizam comerciantes cuja taxa ultrapassa 0,9%. Monitore sua taxa semanalmente.</p>

<h2>Construir um dossiê</h2>
<p>Cada e-mail, atualização de rastreamento e interação com o cliente é evidência potencial. Use um CRM que registre conversas com carimbo de data e hora.</p>`,
          keyTakeaways: [
            "Descrições claras e políticas de devolução visíveis previnem disputas de «item não conforme»",
            "Envie com rastreamento e exija assinatura para pedidos de alto valor",
            "Comunicação proativa sobre atrasos reduz disputas em até 40%",
            "Monitore sua taxa de chargeback semanalmente — Visa sinaliza a partir de 0,9%",
            "Cada interação com o cliente deve ser registrada com carimbo de data e hora"
          ],
          faq: [
            { q: "Qual é uma boa taxa de chargeback?", a: "Abaixo de 0,65% é considerado saudável. O programa de monitoramento da Visa é ativado a 0,9%, o da Mastercard a 1,5%." },
            { q: "Quanto tempo tenho para responder a um chargeback?", a: "Normalmente 20–45 dias dependendo da bandeira e do código de motivo. Visa dá 30 dias, Mastercard 45 dias." },
            { q: "Um reembolso previne um chargeback?", a: "Apenas se processado antes de o cliente contestar junto ao banco. Aja rápido diante de reclamações." }
          ],
          disclaimer: "Este conteúdo é apenas informativo e não constitui aconselhamento jurídico ou financeiro."
        }
      },
      "sv-SE": {
        title: "Checklista för chargeback-prevention",
        excerpt: "En steg-för-steg-checklista som hjälper Shopify-handlare att förebygga chargebacks — med tydliga policyer, leveransspårning och proaktiv kommunikation.",
        body: {
          mainHtml: `
<h2>Varför förebyggande slår reaktion</h2>
<p>Chargebacks kostar mer än transaktionsbeloppet. Varje tvist medför processoravgifter, operativa kostnader och risk att hamna i övervakningsprogram. Den mest effektiva strategin är att stoppa tvister innan de uppstår.</p>

<h2>Åtgärder före köp</h2>
<h3>1. Skriv kristallklara produktbeskrivningar</h3>
<p>Otydligheter utlöser tvister om «vara inte som beskriven». Inkludera mått, material, kompatibilitetsinformation och högupplösta bilder från flera vinklar.</p>

<h3>2. Visa din retur- och återbetalningspolicy tydligt</h3>
<p>Placera policylänken i sidfoten, på varukorgsidan och i orderbekräftelsen. Använd enkelt språk: «Du har 30 dagar att returnera oanvända varor.»</p>

<h3>3. Använd en igenkännbar fakturabeskrivning</h3>
<p>Kunder som inte känner igen en debitering på sitt kontoutdrag bestrider den reflexmässigt. Se till att din betalningsprocessor visar ditt butiksnamn.</p>

<h2>Frakt och leverans</h2>
<h3>4. Skicka med spårning och signaturbekräftelse</h3>
<p>För beställningar över din risktröskel (vanligtvis 1 000 kr+), kräv signatur vid leverans. Skicka alltid spårningsnummer via e-post och SMS.</p>

<h3>5. Kommunicera förseningar innan kunden märker dem</h3>
<p>Om en leverans försenas, informera kunden samma dag. Erbjud alternativ: vänta, ersätta eller avbryta. Proaktiv kommunikation minskar tvister med upp till 40 %.</p>

<h2>Skydd efter köp</h2>
<h3>6. Skicka en uppföljning efter leverans</h3>
<p>24 timmar efter leveransbekräftelsen, skicka ett e-postmeddelande som frågar «Kom allt fram som förväntat?» Det fångar problem tidigt.</p>

<h3>7. Gör din support lätt att hitta</h3>
<p>Om en kund inte hittar dina kontaktuppgifter kontaktar de sin bank istället. Placera support-e-post och telefonnummer på varje sida.</p>

<h3>8. Övervaka din chargeback-kvot varje vecka</h3>
<p>Visa och Mastercard flaggar handlare vars kvot överstiger 0,9 %. Övervaka din kvot varje vecka.</p>

<h2>Bygg en dokumentation</h2>
<p>Varje e-post, spårningsuppdatering och kundinteraktion är potentiellt bevismaterial. Använd ett CRM som tidsstämplar konversationer.</p>`,
          keyTakeaways: [
            "Tydliga produktbeskrivningar och synliga returpolicyer förhindrar tvister om «vara inte som beskriven»",
            "Skicka med spårning och kräv signatur för högvärdesbeställningar",
            "Proaktiv kommunikation om förseningar minskar tvister med upp till 40 %",
            "Övervaka din chargeback-kvot varje vecka — Visa flaggar handlare vid 0,9 %",
            "Varje kundinteraktion bör tidsstämplas och arkiveras"
          ],
          faq: [
            { q: "Vad är en bra chargeback-kvot?", a: "Under 0,65 % anses sunt. Visas övervakningsprogram aktiveras vid 0,9 %, Mastercards vid 1,5 %." },
            { q: "Hur lång tid har jag på mig att svara på en chargeback?", a: "Vanligtvis 20–45 dagar beroende på kortnätverk och orsakskod. Visa ger 30 dagar, Mastercard 45 dagar." },
            { q: "Förhindrar en återbetalning en chargeback?", a: "Bara om den behandlas innan kunden kontaktar sin bank. Agera snabbt vid klagomål." }
          ],
          disclaimer: "Detta innehåll är enbart informativt och utgör inte juridisk eller finansiell rådgivning."
        }
      }
    }
  },

  // -----------------------------------------------------------------------
  // 2. Chargebacks FAQ
  // -----------------------------------------------------------------------
  {
    slug: "chargebacks-faq-timelines-fees-next-steps",
    pillar: "chargebacks",
    type: "cluster_article",
    readingTime: 12,
    tags: ["chargebacks", "merchants"],
    content: {
      "en-US": {
        title: "Chargebacks FAQ: Timelines, Fees, and Next Steps",
        excerpt: "Everything Shopify merchants need to know about chargebacks — from dispute timelines and processor fees to building a winning response strategy.",
        body: {
          mainHtml: `
<h2>What exactly is a chargeback?</h2>
<p>A chargeback is a forced transaction reversal initiated by the cardholder's bank. Unlike a refund (which you initiate), a chargeback is the bank taking the money back on the customer's behalf. The merchant has a limited window to contest it with evidence.</p>

<h2>The chargeback lifecycle</h2>
<ol>
<li><strong>Customer contacts bank:</strong> The cardholder calls their issuing bank to dispute a charge.</li>
<li><strong>Bank issues provisional credit:</strong> The customer gets their money back immediately while the investigation proceeds.</li>
<li><strong>Acquirer notifies merchant:</strong> Your payment processor sends you a chargeback notification with the reason code and deadline.</li>
<li><strong>Merchant responds (or accepts):</strong> You submit evidence to contest the chargeback, or accept the loss.</li>
<li><strong>Bank reviews evidence:</strong> The issuing bank decides whether the evidence is compelling enough to reverse the provisional credit.</li>
<li><strong>Final outcome:</strong> Either the merchant wins (funds returned) or loses (chargeback stands). Some disputes enter pre-arbitration or arbitration.</li>
</ol>

<h2>Timelines by card network</h2>
<table>
<thead><tr><th>Network</th><th>Customer filing window</th><th>Merchant response window</th></tr></thead>
<tbody>
<tr><td>Visa</td><td>120 days from transaction</td><td>30 days from notification</td></tr>
<tr><td>Mastercard</td><td>120 days from transaction</td><td>45 days from notification</td></tr>
<tr><td>American Express</td><td>120 days from transaction</td><td>20 days from notification</td></tr>
<tr><td>Discover</td><td>120 days from transaction</td><td>30 days from notification</td></tr>
</tbody>
</table>

<h2>What does a chargeback cost?</h2>
<p>Beyond the transaction amount, you'll face:</p>
<ul>
<li><strong>Chargeback fee:</strong> $15–$100 per dispute (varies by processor).</li>
<li><strong>Operational cost:</strong> Staff time to gather evidence and respond.</li>
<li><strong>Product loss:</strong> The customer often keeps the goods.</li>
<li><strong>Monitoring penalties:</strong> If your ratio exceeds thresholds, you may face fines of $10,000–$25,000/month.</li>
</ul>

<h2>Common reason codes</h2>
<h3>Fraud (Visa 10.x, MC 4837)</h3>
<p>The cardholder claims they didn't authorize the transaction. This is the most common category, accounting for roughly 60% of all chargebacks.</p>

<h3>Product/Service (Visa 13.x, MC 4853)</h3>
<p>The customer received something different from what was described, or didn't receive it at all.</p>

<h3>Processing errors (Visa 12.x, MC 4834)</h3>
<p>Duplicate charges, incorrect amounts, or transactions processed after a cancellation.</p>

<h2>What to do when you receive a chargeback</h2>
<ol>
<li><strong>Don't panic.</strong> You have time to respond — use it wisely.</li>
<li><strong>Read the reason code carefully.</strong> Your evidence must address the specific claim.</li>
<li><strong>Gather evidence:</strong> Order confirmation, shipping tracking, delivery proof, customer communications, refund policy shown at checkout.</li>
<li><strong>Write a clear rebuttal.</strong> Summarize why the chargeback is invalid, then attach supporting documents.</li>
<li><strong>Submit before the deadline.</strong> Late responses are automatically lost.</li>
</ol>`,
          keyTakeaways: [
            "A chargeback is a bank-initiated forced reversal — not the same as a refund",
            "You typically have 20–45 days to respond depending on the card network",
            "Each chargeback costs $15–$100 in fees on top of the transaction amount and product loss",
            "60% of all chargebacks are filed under fraud reason codes",
            "Your evidence must specifically address the reason code — generic responses lose"
          ],
          faq: [
            { q: "Can I fight every chargeback?", a: "You can respond to most, but not all are worth fighting. If the customer has a legitimate complaint, resolving it directly is cheaper and faster than losing a dispute." },
            { q: "What happens if I ignore a chargeback?", a: "You automatically lose the dispute and the funds. The chargeback still counts toward your ratio, and you still pay the chargeback fee." },
            { q: "What is pre-arbitration?", a: "If the merchant wins the initial dispute, the cardholder's bank can escalate to pre-arbitration. This is a second review with higher stakes — the losing party pays an additional fee ($250–$500)." }
          ],
          disclaimer: "This content is for informational purposes only. Timelines and fees vary by processor, card network, and region. Consult your payment processor for specific terms."
        }
      },
      "de-DE": {
        title: "Chargebacks-FAQ: Fristen, Gebühren und nächste Schritte",
        excerpt: "Alles, was Shopify-Händler über Chargebacks wissen müssen — von Fristen und Prozessorgebühren bis zur erfolgreichen Strategie für die Streitbeilegung.",
        body: {
          mainHtml: `
<h2>Was genau ist ein Chargeback?</h2>
<p>Ein Chargeback ist eine erzwungene Transaktionsrückbuchung, die von der Bank des Karteninhabers eingeleitet wird. Anders als eine Erstattung (die Sie initiieren) holt sich die Bank das Geld im Auftrag des Kunden zurück. Der Händler hat ein begrenztes Zeitfenster, um mit Beweisen zu widersprechen.</p>

<h2>Der Chargeback-Lebenszyklus</h2>
<ol>
<li><strong>Kunde kontaktiert Bank:</strong> Der Karteninhaber ruft bei seiner ausgebenden Bank an, um eine Belastung anzufechten.</li>
<li><strong>Bank gewährt vorläufige Gutschrift:</strong> Der Kunde erhält sein Geld sofort zurück, während die Untersuchung läuft.</li>
<li><strong>Acquirer benachrichtigt Händler:</strong> Ihr Zahlungsdienstleister sendet Ihnen eine Chargeback-Benachrichtigung mit dem Grundcode und der Frist.</li>
<li><strong>Händler reagiert (oder akzeptiert):</strong> Sie reichen Beweise ein, um den Chargeback anzufechten, oder akzeptieren den Verlust.</li>
<li><strong>Bank prüft Beweise:</strong> Die ausgebende Bank entscheidet, ob die Beweise überzeugend genug sind.</li>
<li><strong>Endgültiges Ergebnis:</strong> Entweder gewinnt der Händler (Gelder werden zurückgegeben) oder verliert (Chargeback bleibt bestehen).</li>
</ol>

<h2>Fristen nach Kartennetzwerk</h2>
<p>Visa: 30 Tage Reaktionszeit. Mastercard: 45 Tage. American Express: 20 Tage. Discover: 30 Tage. Alle Netzwerke erlauben dem Kunden 120 Tage ab Transaktion für die Einreichung.</p>

<h2>Was kostet ein Chargeback?</h2>
<ul>
<li><strong>Chargeback-Gebühr:</strong> 15–100 € pro Streitfall (je nach Prozessor).</li>
<li><strong>Operativer Aufwand:</strong> Personalzeit für Beweissammlung und Antwort.</li>
<li><strong>Produktverlust:</strong> Der Kunde behält oft die Ware.</li>
<li><strong>Monitoring-Strafen:</strong> Bei Überschreitung der Schwellenwerte drohen Geldstrafen von 10.000–25.000 €/Monat.</li>
</ul>

<h2>Was tun, wenn Sie einen Chargeback erhalten</h2>
<ol>
<li><strong>Keine Panik.</strong> Sie haben Zeit zu reagieren.</li>
<li><strong>Lesen Sie den Grundcode sorgfältig.</strong> Ihre Beweise müssen den spezifischen Anspruch adressieren.</li>
<li><strong>Sammeln Sie Beweise:</strong> Bestellbestätigung, Sendungsverfolgung, Liefernachweis, Kundenkommunikation.</li>
<li><strong>Schreiben Sie eine klare Widerlegung.</strong></li>
<li><strong>Reichen Sie vor der Frist ein.</strong> Verspätete Antworten verlieren automatisch.</li>
</ol>`,
          keyTakeaways: [
            "Ein Chargeback ist eine von der Bank erzwungene Rückbuchung — nicht dasselbe wie eine Erstattung",
            "Sie haben je nach Kartennetzwerk 20–45 Tage Reaktionszeit",
            "Jeder Chargeback kostet 15–100 € an Gebühren zusätzlich zum Transaktionsbetrag",
            "60 % aller Chargebacks werden unter Betrugs-Grundcodes eingereicht",
            "Ihre Beweise müssen den spezifischen Grundcode adressieren"
          ],
          faq: [
            { q: "Kann ich jeden Chargeback anfechten?", a: "Sie können auf die meisten reagieren, aber nicht alle lohnen sich. Bei berechtigten Beschwerden ist eine direkte Lösung günstiger." },
            { q: "Was passiert, wenn ich einen Chargeback ignoriere?", a: "Sie verlieren automatisch den Streitfall und die Gelder. Der Chargeback zählt weiterhin zu Ihrer Quote." },
            { q: "Was ist Prä-Arbitration?", a: "Wenn der Händler den ersten Streit gewinnt, kann die Bank des Karteninhabers eine Prä-Arbitration einleiten. Die unterlegene Partei zahlt eine zusätzliche Gebühr (250–500 €)." }
          ],
          disclaimer: "Dieser Inhalt dient nur zu Informationszwecken. Fristen und Gebühren variieren je nach Prozessor, Kartennetzwerk und Region."
        }
      },
      "fr-FR": {
        title: "FAQ rétrofacturations : délais, frais et prochaines étapes",
        excerpt: "Tout ce que les marchands Shopify doivent savoir sur les rétrofacturations — délais, frais de processeur et stratégie de réponse gagnante.",
        body: {
          mainHtml: `
<h2>Qu'est-ce exactement qu'une rétrofacturation ?</h2>
<p>Une rétrofacturation est une annulation forcée de transaction initiée par la banque du titulaire de carte. Contrairement à un remboursement (que vous initiez), c'est la banque qui reprend l'argent au nom du client. Le marchand dispose d'un délai limité pour contester avec des preuves.</p>

<h2>Le cycle de vie d'une rétrofacturation</h2>
<ol>
<li><strong>Le client contacte sa banque :</strong> Le titulaire appelle sa banque émettrice pour contester un débit.</li>
<li><strong>La banque accorde un crédit provisoire :</strong> Le client récupère son argent immédiatement pendant l'enquête.</li>
<li><strong>L'acquéreur notifie le marchand :</strong> Votre processeur vous envoie une notification avec le code motif et le délai.</li>
<li><strong>Le marchand répond (ou accepte) :</strong> Vous soumettez des preuves ou acceptez la perte.</li>
<li><strong>La banque examine les preuves :</strong> La banque émettrice décide si les preuves sont suffisamment convaincantes.</li>
<li><strong>Résultat final :</strong> Soit le marchand gagne, soit la rétrofacturation est maintenue.</li>
</ol>

<h2>Délais par réseau</h2>
<p>Visa : 30 jours de réponse. Mastercard : 45 jours. American Express : 20 jours. Tous les réseaux accordent au client 120 jours à compter de la transaction.</p>

<h2>Que coûte une rétrofacturation ?</h2>
<ul>
<li><strong>Frais de rétrofacturation :</strong> 15–100 € par litige.</li>
<li><strong>Coût opérationnel :</strong> Temps du personnel pour rassembler les preuves.</li>
<li><strong>Perte de produit :</strong> Le client conserve souvent la marchandise.</li>
<li><strong>Pénalités de surveillance :</strong> Amendes de 10 000–25 000 €/mois en cas de dépassement des seuils.</li>
</ul>

<h2>Que faire quand vous recevez une rétrofacturation</h2>
<ol>
<li><strong>Pas de panique.</strong> Vous avez du temps pour répondre.</li>
<li><strong>Lisez attentivement le code motif.</strong></li>
<li><strong>Rassemblez les preuves :</strong> confirmation de commande, suivi d'expédition, preuve de livraison, communications client.</li>
<li><strong>Rédigez une réfutation claire.</strong></li>
<li><strong>Soumettez avant la date limite.</strong></li>
</ol>`,
          keyTakeaways: [
            "Une rétrofacturation est une annulation forcée par la banque — pas un remboursement",
            "Vous avez généralement 20–45 jours pour répondre",
            "Chaque rétrofacturation coûte 15–100 € de frais en plus du montant de la transaction",
            "60 % des rétrofacturations sont déposées sous des codes de fraude",
            "Vos preuves doivent répondre spécifiquement au code motif"
          ],
          faq: [
            { q: "Peut-on contester chaque rétrofacturation ?", a: "Vous pouvez répondre à la plupart, mais toutes ne valent pas la peine d'être contestées. Pour les plaintes légitimes, une résolution directe est moins coûteuse." },
            { q: "Que se passe-t-il si j'ignore une rétrofacturation ?", a: "Vous perdez automatiquement le litige et les fonds. La rétrofacturation compte toujours dans votre ratio." },
            { q: "Qu'est-ce que la pré-arbitration ?", a: "Si le marchand gagne le litige initial, la banque du client peut escalader. La partie perdante paie des frais supplémentaires (250–500 €)." }
          ],
          disclaimer: "Ce contenu est fourni à titre informatif uniquement. Les délais et frais varient selon le processeur, le réseau et la région."
        }
      },
      "es-ES": {
        title: "FAQ de contracargos: plazos, comisiones y siguientes pasos",
        excerpt: "Todo lo que los comerciantes de Shopify necesitan saber sobre contracargos — plazos, comisiones del procesador y estrategia de respuesta ganadora.",
        body: {
          mainHtml: `
<h2>¿Qué es exactamente un contracargo?</h2>
<p>Un contracargo es una reversión forzada de transacción iniciada por el banco del titular de la tarjeta. A diferencia de un reembolso (que usted inicia), el banco retira el dinero en nombre del cliente. El comerciante tiene un plazo limitado para contestar con evidencia.</p>

<h2>El ciclo de vida de un contracargo</h2>
<ol>
<li><strong>El cliente contacta al banco:</strong> El titular llama a su banco emisor para disputar un cargo.</li>
<li><strong>El banco emite un crédito provisional:</strong> El cliente recupera su dinero inmediatamente mientras se investiga.</li>
<li><strong>El adquirente notifica al comerciante:</strong> Su procesador le envía una notificación con el código de motivo y el plazo.</li>
<li><strong>El comerciante responde (o acepta):</strong> Presenta evidencia para contestar, o acepta la pérdida.</li>
<li><strong>El banco revisa la evidencia:</strong> El banco emisor decide si la evidencia es suficientemente convincente.</li>
<li><strong>Resultado final:</strong> El comerciante gana o el contracargo se mantiene.</li>
</ol>

<h2>Plazos por red</h2>
<p>Visa: 30 días de respuesta. Mastercard: 45 días. American Express: 20 días. Todas las redes permiten al cliente 120 días desde la transacción.</p>

<h2>¿Cuánto cuesta un contracargo?</h2>
<ul>
<li><strong>Comisión de contracargo:</strong> 15–100 € por disputa.</li>
<li><strong>Coste operativo:</strong> Tiempo del personal para recopilar evidencia.</li>
<li><strong>Pérdida de producto:</strong> El cliente a menudo conserva la mercancía.</li>
<li><strong>Penalizaciones de monitoreo:</strong> Multas de 10.000–25.000 €/mes si se superan los umbrales.</li>
</ul>

<h2>Qué hacer al recibir un contracargo</h2>
<ol>
<li><strong>No entre en pánico.</strong> Tiene tiempo para responder.</li>
<li><strong>Lea el código de motivo con atención.</strong></li>
<li><strong>Recopile evidencia:</strong> confirmación de pedido, seguimiento, prueba de entrega, comunicaciones.</li>
<li><strong>Redacte una refutación clara.</strong></li>
<li><strong>Envíe antes del plazo.</strong></li>
</ol>`,
          keyTakeaways: [
            "Un contracargo es una reversión forzada por el banco — no es un reembolso",
            "Tiene normalmente 20–45 días para responder",
            "Cada contracargo cuesta 15–100 € de comisión además del importe de la transacción",
            "El 60% de los contracargos se presentan bajo códigos de fraude",
            "Su evidencia debe abordar específicamente el código de motivo"
          ],
          faq: [
            { q: "¿Se puede disputar cada contracargo?", a: "Puede responder a la mayoría, pero no todos merecen ser disputados. Para quejas legítimas, una resolución directa es más económica." },
            { q: "¿Qué pasa si ignoro un contracargo?", a: "Pierde automáticamente la disputa y los fondos. El contracargo sigue contando en su ratio." },
            { q: "¿Qué es la pre-arbitración?", a: "Si el comerciante gana la disputa inicial, el banco del cliente puede escalar. La parte perdedora paga una comisión adicional (250–500 €)." }
          ],
          disclaimer: "Este contenido es solo informativo. Los plazos y comisiones varían según el procesador, la red y la región."
        }
      },
      "pt-BR": {
        title: "FAQ de chargebacks: prazos, taxas e próximos passos",
        excerpt: "Tudo que comerciantes Shopify precisam saber sobre chargebacks — prazos de disputa, taxas do processador e estratégia de resposta vencedora.",
        body: {
          mainHtml: `
<h2>O que exatamente é um chargeback?</h2>
<p>Um chargeback é uma reversão forçada de transação iniciada pelo banco do titular do cartão. Diferente de um reembolso (que você inicia), o banco retira o dinheiro em nome do cliente. O comerciante tem um prazo limitado para contestar com evidências.</p>

<h2>O ciclo de vida de um chargeback</h2>
<ol>
<li><strong>Cliente contacta o banco:</strong> O titular liga para o banco emissor para disputar uma cobrança.</li>
<li><strong>Banco concede crédito provisório:</strong> O cliente recebe o dinheiro imediatamente enquanto a investigação prossegue.</li>
<li><strong>Adquirente notifica o comerciante:</strong> Seu processador envia uma notificação com o código de motivo e o prazo.</li>
<li><strong>Comerciante responde (ou aceita):</strong> Você submete evidências para contestar, ou aceita a perda.</li>
<li><strong>Banco analisa as evidências:</strong> O banco emissor decide se as evidências são convincentes.</li>
<li><strong>Resultado final:</strong> O comerciante vence ou o chargeback é mantido.</li>
</ol>

<h2>Prazos por bandeira</h2>
<p>Visa: 30 dias de resposta. Mastercard: 45 dias. American Express: 20 dias. Todas as bandeiras permitem ao cliente 120 dias a partir da transação.</p>

<h2>Quanto custa um chargeback?</h2>
<ul>
<li><strong>Taxa de chargeback:</strong> R$ 75–500 por disputa.</li>
<li><strong>Custo operacional:</strong> Tempo da equipe para reunir evidências.</li>
<li><strong>Perda de produto:</strong> O cliente frequentemente fica com a mercadoria.</li>
<li><strong>Penalidades de monitoramento:</strong> Multas mensais se ultrapassar os limites.</li>
</ul>

<h2>O que fazer ao receber um chargeback</h2>
<ol>
<li><strong>Não entre em pânico.</strong> Você tem tempo para responder.</li>
<li><strong>Leia o código de motivo cuidadosamente.</strong></li>
<li><strong>Reúna evidências:</strong> confirmação de pedido, rastreamento, prova de entrega, comunicações.</li>
<li><strong>Escreva uma contestação clara.</strong></li>
<li><strong>Envie antes do prazo.</strong></li>
</ol>`,
          keyTakeaways: [
            "Um chargeback é uma reversão forçada pelo banco — não é o mesmo que reembolso",
            "Você normalmente tem 20–45 dias para responder",
            "Cada chargeback custa R$ 75–500 em taxas além do valor da transação",
            "60% dos chargebacks são registrados sob códigos de fraude",
            "Suas evidências devem abordar especificamente o código de motivo"
          ],
          faq: [
            { q: "Posso contestar todos os chargebacks?", a: "Você pode responder à maioria, mas nem todos valem a pena. Para reclamações legítimas, resolução direta é mais econômica." },
            { q: "O que acontece se eu ignorar um chargeback?", a: "Você perde automaticamente a disputa e os fundos. O chargeback ainda conta na sua taxa." },
            { q: "O que é pré-arbitragem?", a: "Se o comerciante vence a disputa inicial, o banco do cliente pode escalar. A parte perdedora paga uma taxa adicional." }
          ],
          disclaimer: "Este conteúdo é apenas informativo. Prazos e taxas variam conforme o processador, a bandeira e a região."
        }
      },
      "sv-SE": {
        title: "Chargebacks FAQ: tidslinjer, avgifter och nästa steg",
        excerpt: "Allt Shopify-handlare behöver veta om chargebacks — tidsfrister, processoravgifter och strategi för ett vinnande svar.",
        body: {
          mainHtml: `
<h2>Vad är egentligen en chargeback?</h2>
<p>En chargeback är en tvångsmässig transaktionsåterföring initierad av kortinnehavarens bank. Till skillnad från en återbetalning (som du initierar) tar banken tillbaka pengarna på kundens vägnar. Handlaren har en begränsad tid att bestrida med bevis.</p>

<h2>Chargebackens livscykel</h2>
<ol>
<li><strong>Kunden kontaktar banken:</strong> Kortinnehavaren ringer sin utfärdande bank för att bestrida en debitering.</li>
<li><strong>Banken utfärdar provisorisk kredit:</strong> Kunden får pengarna tillbaka omedelbart under utredningen.</li>
<li><strong>Inlösaren meddelar handlaren:</strong> Din betalningsprocessor skickar en chargeback-notifikation med orsakskod och tidsfrist.</li>
<li><strong>Handlaren svarar (eller accepterar):</strong> Du skickar in bevis för att bestrida, eller accepterar förlusten.</li>
<li><strong>Banken granskar bevis:</strong> Den utfärdande banken avgör om bevisen är övertygande.</li>
<li><strong>Slutgiltigt resultat:</strong> Antingen vinner handlaren eller så kvarstår chargebacken.</li>
</ol>

<h2>Tidsfrister per kortnätverk</h2>
<p>Visa: 30 dagars svarstid. Mastercard: 45 dagar. American Express: 20 dagar. Alla nätverk ger kunden 120 dagar från transaktionen.</p>

<h2>Vad kostar en chargeback?</h2>
<ul>
<li><strong>Chargeback-avgift:</strong> 150–1 000 kr per tvist.</li>
<li><strong>Operativ kostnad:</strong> Personaltid för att samla bevis.</li>
<li><strong>Produktförlust:</strong> Kunden behåller ofta varan.</li>
<li><strong>Övervakningsböter:</strong> Böter vid överskridande av tröskelvärden.</li>
</ul>

<h2>Vad gör du när du får en chargeback</h2>
<ol>
<li><strong>Få inte panik.</strong> Du har tid att svara.</li>
<li><strong>Läs orsakskoden noggrant.</strong></li>
<li><strong>Samla bevis:</strong> orderbekräftelse, spårning, leveransbevis, kundkommunikation.</li>
<li><strong>Skriv en tydlig vederläggning.</strong></li>
<li><strong>Skicka in före deadline.</strong></li>
</ol>`,
          keyTakeaways: [
            "En chargeback är en bankinitierad tvångsåterföring — inte samma sak som en återbetalning",
            "Du har vanligtvis 20–45 dagar att svara",
            "Varje chargeback kostar 150–1 000 kr i avgifter utöver transaktionsbeloppet",
            "60 % av alla chargebacks lämnas in under bedrägerikoder",
            "Dina bevis måste specifikt bemöta orsakskoden"
          ],
          faq: [
            { q: "Kan jag bestrida varje chargeback?", a: "Du kan svara på de flesta, men alla är inte värda att bestrida. För berättigade klagomål är direkt lösning billigare." },
            { q: "Vad händer om jag ignorerar en chargeback?", a: "Du förlorar automatiskt tvisten och medlen. Chargebacken räknas fortfarande mot din kvot." },
            { q: "Vad är förmedling (pre-arbitration)?", a: "Om handlaren vinner den initiala tvisten kan kundens bank eskalera. Den förlorande parten betalar en extra avgift." }
          ],
          disclaimer: "Detta innehåll är enbart informativt. Tidsfrister och avgifter varierar beroende på processor, kortnätverk och region."
        }
      }
    }
  },

  // -----------------------------------------------------------------------
  // 3. How to Build a Chargeback Evidence Pack
  // -----------------------------------------------------------------------
  {
    slug: "how-to-build-a-chargeback-evidence-pack",
    pillar: "chargebacks",
    type: "cluster_article",
    readingTime: 14,
    tags: ["chargebacks", "evidence"],
    content: {
      "en-US": {
        title: "How to Build a Chargeback Evidence Pack",
        excerpt: "A practical guide to assembling compelling chargeback evidence — the documents, screenshots, and narrative structure that win disputes.",
        body: {
          mainHtml: `
<h2>Why evidence quality matters more than quantity</h2>
<p>Banks review hundreds of chargeback responses daily. A wall of unorganized documents gets skimmed. A focused, well-structured evidence pack gets read. The goal isn't to submit everything you have — it's to submit exactly what addresses the reason code, presented clearly.</p>

<h2>The evidence framework</h2>
<p>Every winning evidence pack follows this structure:</p>
<ol>
<li><strong>Rebuttal letter:</strong> A concise summary (one page or less) explaining why the chargeback should be reversed. Address the specific reason code.</li>
<li><strong>Transaction proof:</strong> Order confirmation, payment receipt, and AVS/CVV match results showing the customer authorized the purchase.</li>
<li><strong>Fulfillment proof:</strong> Shipping confirmation with carrier name, tracking number, delivery date, and signature (if applicable).</li>
<li><strong>Customer communication:</strong> Emails, chat logs, or support tickets showing you addressed the customer's concern or that the customer confirmed receipt.</li>
<li><strong>Policy proof:</strong> Screenshots of your refund/return policy as displayed during checkout and in order confirmation emails.</li>
</ol>

<h2>Matching evidence to reason codes</h2>
<h3>Fraud (unauthorized transaction)</h3>
<p>Your strongest evidence: AVS match, CVV verification, IP address matching the billing address region, previous successful orders from the same customer, and delivery to the cardholder's address.</p>

<h3>Item not received</h3>
<p>Your strongest evidence: Carrier tracking showing delivered status, signature confirmation, GPS coordinates from carrier, and any post-delivery communication where the customer acknowledged receipt.</p>

<h3>Item not as described</h3>
<p>Your strongest evidence: Product page screenshots with detailed descriptions matching what was shipped, photos of the actual product, and any quality control documentation.</p>

<h2>Common mistakes that lose disputes</h2>
<ul>
<li><strong>Submitting irrelevant documents.</strong> Internal notes or financial reports don't help — the bank wants customer-facing evidence.</li>
<li><strong>Ignoring the reason code.</strong> If the code is «item not received» but you submit product quality evidence, you'll lose.</li>
<li><strong>Missing the deadline.</strong> No evidence beats the clock. Track every deadline and submit at least 3 business days early.</li>
<li><strong>Poorly formatted documents.</strong> Blurry screenshots, cropped timestamps, or unreadable PDFs undermine credibility.</li>
</ul>

<h2>Tools that help</h2>
<p>DisputeDesk automates evidence collection from your Shopify store — pulling order data, tracking info, customer communications, and policy screenshots into a ready-to-submit pack. This saves hours of manual work per dispute.</p>`,
          keyTakeaways: [
            "Quality over quantity — focused evidence that addresses the reason code wins",
            "Every pack needs: rebuttal letter, transaction proof, fulfillment proof, customer comms, policy proof",
            "Match your evidence to the specific reason code — generic submissions lose",
            "Submit at least 3 business days before the deadline to avoid technical issues",
            "Automation tools like DisputeDesk cut hours of manual evidence gathering"
          ],
          faq: [
            { q: "How long should a rebuttal letter be?", a: "One page or less. Lead with your strongest point, cite the attached evidence, and be professional. Banks appreciate brevity and clarity." },
            { q: "Should I include everything I have?", a: "No. Only include evidence that directly addresses the reason code. Irrelevant documents dilute your case and signal desperation." },
            { q: "Can I reuse evidence across disputes?", a: "Policy screenshots and general store documentation can be reused. Transaction-specific evidence (tracking, emails) must be unique per dispute." }
          ],
          disclaimer: "This content is for informational purposes only and does not constitute legal advice. Evidence requirements vary by card network and issuing bank."
        }
      },
      "de-DE": {
        title: "So erstellen Sie ein Chargeback-Evidenzenpaket",
        excerpt: "Ein praktischer Leitfaden zur Zusammenstellung überzeugender Chargeback-Beweise — die Dokumente, Screenshots und Erzählstruktur, die Streitfälle gewinnen.",
        body: {
          mainHtml: `
<h2>Warum Beweisqualität wichtiger ist als Quantität</h2>
<p>Banken prüfen täglich Hunderte von Chargeback-Antworten. Ein unorganisierter Dokumentenberg wird überflogen. Ein fokussiertes, gut strukturiertes Beweispaket wird gelesen. Das Ziel ist nicht, alles einzureichen — sondern genau das, was den Grundcode adressiert.</p>

<h2>Das Beweis-Framework</h2>
<ol>
<li><strong>Widerlegungsschreiben:</strong> Eine prägnante Zusammenfassung (maximal eine Seite), die erklärt, warum der Chargeback rückgängig gemacht werden sollte.</li>
<li><strong>Transaktionsnachweis:</strong> Bestellbestätigung, Zahlungsbeleg und AVS/CVV-Übereinstimmungsergebnisse.</li>
<li><strong>Liefernachweis:</strong> Versandbestätigung mit Sendungsnummer, Lieferdatum und Unterschrift.</li>
<li><strong>Kundenkommunikation:</strong> E-Mails, Chat-Protokolle oder Support-Tickets.</li>
<li><strong>Richtliniennachweis:</strong> Screenshots Ihrer Rückgaberichtlinie, wie sie beim Checkout angezeigt wird.</li>
</ol>

<h2>Beweise den Grundcodes zuordnen</h2>
<h3>Betrug (unautorisierte Transaktion)</h3>
<p>Stärkste Beweise: AVS-Übereinstimmung, CVV-Verifizierung, IP-Adresse, frühere erfolgreiche Bestellungen, Lieferung an Karteninhaberadresse.</p>

<h3>Artikel nicht erhalten</h3>
<p>Stärkste Beweise: Tracking mit Zustellstatus, Unterschriftsbestätigung, GPS-Koordinaten des Zustelldienstes.</p>

<h3>Artikel nicht wie beschrieben</h3>
<p>Stärkste Beweise: Produktseiten-Screenshots mit detaillierten Beschreibungen, Fotos des tatsächlichen Produkts.</p>

<h2>Häufige Fehler, die Streitfälle verlieren</h2>
<ul>
<li><strong>Irrelevante Dokumente einreichen.</strong></li>
<li><strong>Den Grundcode ignorieren.</strong></li>
<li><strong>Die Frist verpassen.</strong></li>
<li><strong>Schlecht formatierte Dokumente.</strong></li>
</ul>`,
          keyTakeaways: [
            "Qualität vor Quantität — fokussierte Beweise, die den Grundcode adressieren, gewinnen",
            "Jedes Paket braucht: Widerlegungsschreiben, Transaktionsnachweis, Liefernachweis, Kommunikation, Richtliniennachweis",
            "Ordnen Sie Ihre Beweise dem spezifischen Grundcode zu",
            "Reichen Sie mindestens 3 Werktage vor der Frist ein",
            "Automatisierungstools sparen Stunden manueller Beweissammlung"
          ],
          faq: [
            { q: "Wie lang sollte ein Widerlegungsschreiben sein?", a: "Maximal eine Seite. Beginnen Sie mit Ihrem stärksten Punkt und verweisen Sie auf die beigefügten Beweise." },
            { q: "Sollte ich alles einreichen, was ich habe?", a: "Nein. Reichen Sie nur Beweise ein, die direkt den Grundcode adressieren." },
            { q: "Kann ich Beweise für mehrere Streitfälle wiederverwenden?", a: "Richtlinien-Screenshots ja. Transaktionsspezifische Beweise müssen einzigartig sein." }
          ],
          disclaimer: "Dieser Inhalt dient nur zu Informationszwecken und stellt keine Rechtsberatung dar."
        }
      },
      "fr-FR": {
        title: "Comment constituer un dossier de preuves pour rétrofacturation",
        excerpt: "Un guide pratique pour assembler des preuves convaincantes — documents, captures d'écran et structure narrative qui gagnent les litiges.",
        body: {
          mainHtml: `
<h2>Pourquoi la qualité des preuves compte plus que la quantité</h2>
<p>Les banques examinent des centaines de réponses chaque jour. Un dossier mal organisé est survolé. Un dossier ciblé et bien structuré est lu. L'objectif n'est pas de tout soumettre — mais exactement ce qui répond au code motif.</p>

<h2>Le cadre de preuves</h2>
<ol>
<li><strong>Lettre de réfutation :</strong> Un résumé concis (une page max) expliquant pourquoi la rétrofacturation devrait être annulée.</li>
<li><strong>Preuve de transaction :</strong> Confirmation de commande, reçu de paiement, résultats AVS/CVV.</li>
<li><strong>Preuve d'expédition :</strong> Confirmation d'envoi avec numéro de suivi, date de livraison et signature.</li>
<li><strong>Communication client :</strong> E-mails, chats ou tickets de support.</li>
<li><strong>Preuve de politique :</strong> Captures d'écran de votre politique de retour telle qu'affichée au paiement.</li>
</ol>

<h2>Adapter les preuves aux codes motif</h2>
<h3>Fraude (transaction non autorisée)</h3>
<p>Preuves les plus fortes : correspondance AVS, vérification CVV, adresse IP, commandes antérieures réussies.</p>

<h3>Article non reçu</h3>
<p>Preuves les plus fortes : suivi de livraison avec statut « livré », confirmation de signature, coordonnées GPS.</p>

<h3>Article non conforme</h3>
<p>Preuves les plus fortes : captures de la page produit avec descriptions détaillées, photos du produit réel.</p>

<h2>Erreurs courantes</h2>
<ul>
<li><strong>Soumettre des documents non pertinents.</strong></li>
<li><strong>Ignorer le code motif.</strong></li>
<li><strong>Manquer la date limite.</strong></li>
<li><strong>Documents mal formatés.</strong></li>
</ul>`,
          keyTakeaways: [
            "Qualité plutôt que quantité — des preuves ciblées répondant au code motif gagnent",
            "Chaque dossier nécessite : lettre de réfutation, preuve de transaction, d'expédition, communication client, preuve de politique",
            "Adaptez vos preuves au code motif spécifique",
            "Soumettez au moins 3 jours ouvrés avant la date limite",
            "Les outils d'automatisation économisent des heures de collecte manuelle"
          ],
          faq: [
            { q: "Quelle longueur pour une lettre de réfutation ?", a: "Une page maximum. Commencez par votre argument le plus fort et citez les preuves jointes." },
            { q: "Dois-je tout soumettre ?", a: "Non. Ne soumettez que les preuves répondant directement au code motif." },
            { q: "Puis-je réutiliser des preuves ?", a: "Les captures de politique oui. Les preuves spécifiques à la transaction doivent être uniques." }
          ],
          disclaimer: "Ce contenu est fourni à titre informatif et ne constitue pas un conseil juridique."
        }
      },
      "es-ES": {
        title: "Cómo crear un paquete de pruebas para contracargos",
        excerpt: "Una guía práctica para reunir pruebas convincentes — documentos, capturas de pantalla y estructura narrativa que ganan disputas.",
        body: {
          mainHtml: `
<h2>Por qué la calidad de las pruebas importa más que la cantidad</h2>
<p>Los bancos revisan cientos de respuestas diariamente. Un montón de documentos desorganizados se hojea. Un paquete enfocado y bien estructurado se lee. El objetivo no es presentar todo — sino exactamente lo que aborda el código de motivo.</p>

<h2>El marco de evidencia</h2>
<ol>
<li><strong>Carta de refutación:</strong> Un resumen conciso (máximo una página) explicando por qué el contracargo debe revertirse.</li>
<li><strong>Prueba de transacción:</strong> Confirmación de pedido, recibo de pago, resultados AVS/CVV.</li>
<li><strong>Prueba de envío:</strong> Confirmación de envío con número de seguimiento, fecha de entrega y firma.</li>
<li><strong>Comunicación con el cliente:</strong> Correos, chats o tickets de soporte.</li>
<li><strong>Prueba de política:</strong> Capturas de su política de devolución tal como se muestra en el checkout.</li>
</ol>

<h2>Adaptar las pruebas a los códigos de motivo</h2>
<h3>Fraude (transacción no autorizada)</h3>
<p>Pruebas más fuertes: coincidencia AVS, verificación CVV, dirección IP, pedidos anteriores exitosos.</p>

<h3>Artículo no recibido</h3>
<p>Pruebas más fuertes: seguimiento con estado «entregado», confirmación de firma, coordenadas GPS.</p>

<h3>Artículo no conforme</h3>
<p>Pruebas más fuertes: capturas de la página del producto con descripciones detalladas, fotos del producto real.</p>

<h2>Errores comunes</h2>
<ul>
<li><strong>Presentar documentos irrelevantes.</strong></li>
<li><strong>Ignorar el código de motivo.</strong></li>
<li><strong>Perder el plazo.</strong></li>
<li><strong>Documentos mal formateados.</strong></li>
</ul>`,
          keyTakeaways: [
            "Calidad sobre cantidad — pruebas enfocadas que abordan el código de motivo ganan",
            "Cada paquete necesita: carta de refutación, prueba de transacción, de envío, comunicación, prueba de política",
            "Adapte sus pruebas al código de motivo específico",
            "Presente al menos 3 días hábiles antes del plazo",
            "Las herramientas de automatización ahorran horas de recopilación manual"
          ],
          faq: [
            { q: "¿Cuánto debe medir una carta de refutación?", a: "Máximo una página. Comience con su argumento más fuerte y cite las pruebas adjuntas." },
            { q: "¿Debo presentar todo lo que tengo?", a: "No. Solo presente pruebas que aborden directamente el código de motivo." },
            { q: "¿Puedo reutilizar pruebas?", a: "Capturas de política sí. Pruebas específicas de la transacción deben ser únicas." }
          ],
          disclaimer: "Este contenido es solo informativo y no constituye asesoramiento jurídico."
        }
      },
      "pt-BR": {
        title: "Como montar um pacote de evidências de chargeback",
        excerpt: "Um guia prático para reunir evidências convincentes — documentos, capturas de tela e estrutura narrativa que vencem disputas.",
        body: {
          mainHtml: `
<h2>Por que qualidade importa mais que quantidade</h2>
<p>Bancos analisam centenas de respostas diariamente. Um monte de documentos desorganizados é folheado. Um pacote focado e bem estruturado é lido. O objetivo não é enviar tudo — mas exatamente o que aborda o código de motivo.</p>

<h2>O framework de evidências</h2>
<ol>
<li><strong>Carta de contestação:</strong> Um resumo conciso (máximo uma página) explicando por que o chargeback deve ser revertido.</li>
<li><strong>Prova de transação:</strong> Confirmação de pedido, recibo de pagamento, resultados AVS/CVV.</li>
<li><strong>Prova de envio:</strong> Confirmação de envio com número de rastreamento, data de entrega e assinatura.</li>
<li><strong>Comunicação com o cliente:</strong> E-mails, chats ou tickets de suporte.</li>
<li><strong>Prova de política:</strong> Capturas da sua política de devolução exibida no checkout.</li>
</ol>

<h2>Adaptar evidências aos códigos de motivo</h2>
<h3>Fraude (transação não autorizada)</h3>
<p>Evidências mais fortes: correspondência AVS, verificação CVV, endereço IP, pedidos anteriores bem-sucedidos.</p>

<h3>Item não recebido</h3>
<p>Evidências mais fortes: rastreamento com status «entregue», confirmação de assinatura, coordenadas GPS.</p>

<h3>Item não conforme</h3>
<p>Evidências mais fortes: capturas da página do produto com descrições detalhadas, fotos do produto real.</p>

<h2>Erros comuns</h2>
<ul>
<li><strong>Enviar documentos irrelevantes.</strong></li>
<li><strong>Ignorar o código de motivo.</strong></li>
<li><strong>Perder o prazo.</strong></li>
<li><strong>Documentos mal formatados.</strong></li>
</ul>`,
          keyTakeaways: [
            "Qualidade acima de quantidade — evidências focadas que abordam o código de motivo vencem",
            "Cada pacote precisa de: carta de contestação, prova de transação, de envio, comunicação, prova de política",
            "Adapte suas evidências ao código de motivo específico",
            "Envie pelo menos 3 dias úteis antes do prazo",
            "Ferramentas de automação economizam horas de coleta manual"
          ],
          faq: [
            { q: "Qual o tamanho ideal da carta de contestação?", a: "Máximo uma página. Comece com seu argumento mais forte e cite as evidências anexadas." },
            { q: "Devo enviar tudo que tenho?", a: "Não. Envie apenas evidências que abordem diretamente o código de motivo." },
            { q: "Posso reutilizar evidências?", a: "Capturas de política sim. Evidências específicas da transação devem ser únicas." }
          ],
          disclaimer: "Este conteúdo é apenas informativo e não constitui aconselhamento jurídico."
        }
      },
      "sv-SE": {
        title: "Så bygger du ett chargeback-bevispaket",
        excerpt: "En praktisk guide till att sammanställa övertygande chargeback-bevis — dokument, skärmdumpar och narrativ struktur som vinner tvister.",
        body: {
          mainHtml: `
<h2>Varför beviskvalitet är viktigare än kvantitet</h2>
<p>Banker granskar hundratals chargeback-svar dagligen. En hög oorganiserade dokument bläddras igenom. Ett fokuserat, välstrukturerat bevispaket läses. Målet är inte att skicka in allt — utan exakt det som bemöter orsakskoden.</p>

<h2>Bevisramverket</h2>
<ol>
<li><strong>Vederläggningsbrev:</strong> En koncis sammanfattning (max en sida) som förklarar varför chargebacken bör upphävas.</li>
<li><strong>Transaktionsbevis:</strong> Orderbekräftelse, kvitto, AVS/CVV-matchresultat.</li>
<li><strong>Leveransbevis:</strong> Fraktbekräftelse med spårningsnummer, leveransdatum och signatur.</li>
<li><strong>Kundkommunikation:</strong> E-post, chattloggar eller supportärenden.</li>
<li><strong>Policybevis:</strong> Skärmdumpar av din returpolicy som visas vid kassan.</li>
</ol>

<h2>Matcha bevis med orsakskoder</h2>
<h3>Bedrägeri (obehörig transaktion)</h3>
<p>Starkaste bevis: AVS-matchning, CVV-verifiering, IP-adress, tidigare lyckade beställningar.</p>

<h3>Vara ej mottagen</h3>
<p>Starkaste bevis: spårning med leveransstatus, signaturbekräftelse, GPS-koordinater.</p>

<h3>Vara ej som beskriven</h3>
<p>Starkaste bevis: skärmdumpar av produktsidan med detaljerade beskrivningar, foton av den faktiska produkten.</p>

<h2>Vanliga misstag</h2>
<ul>
<li><strong>Skicka in irrelevanta dokument.</strong></li>
<li><strong>Ignorera orsakskoden.</strong></li>
<li><strong>Missa deadline.</strong></li>
<li><strong>Dåligt formaterade dokument.</strong></li>
</ul>`,
          keyTakeaways: [
            "Kvalitet över kvantitet — fokuserade bevis som bemöter orsakskoden vinner",
            "Varje paket behöver: vederläggningsbrev, transaktionsbevis, leveransbevis, kommunikation, policybevis",
            "Matcha dina bevis med den specifika orsakskoden",
            "Skicka in minst 3 arbetsdagar före deadline",
            "Automatiseringsverktyg sparar timmar av manuell bevisinsamling"
          ],
          faq: [
            { q: "Hur långt ska ett vederläggningsbrev vara?", a: "Max en sida. Börja med ditt starkaste argument och hänvisa till bifogade bevis." },
            { q: "Ska jag skicka in allt jag har?", a: "Nej. Skicka bara in bevis som direkt bemöter orsakskoden." },
            { q: "Kan jag återanvända bevis?", a: "Policyskärmdumpar ja. Transaktionsspecifika bevis måste vara unika." }
          ],
          disclaimer: "Detta innehåll är enbart informativt och utgör inte juridisk rådgivning."
        }
      }
    }
  },

  // -----------------------------------------------------------------------
  // 4–10: Remaining articles (shorter to stay within file size limits)
  // Each has full real content in all 6 locales
  // -----------------------------------------------------------------------
  {
    slug: "chargeback-rebuttal-letter-template",
    pillar: "chargebacks",
    type: "template",
    readingTime: 8,
    tags: ["chargebacks", "evidence", "merchants"],
    content: {
      "en-US": { title: "Chargeback Rebuttal Letter Template", excerpt: "A proven rebuttal letter template that addresses the most common chargeback reason codes — ready to customize for your Shopify disputes.", body: { mainHtml: `<h2>What is a rebuttal letter?</h2><p>A rebuttal letter is the narrative cover document you submit alongside your evidence when contesting a chargeback. It tells the bank reviewer exactly why the dispute should be reversed, guiding them through your evidence in a logical order.</p><h2>Template structure</h2><h3>Opening paragraph</h3><p>State the dispute details: order number, transaction date, amount, and the reason code you're addressing. Example: "This letter responds to Chargeback Case #12345 (Visa Reason Code 13.1 — Merchandise/Services Not Received) for Order #1001 dated March 15, 2025, totaling $127.50."</p><h3>Evidence summary</h3><p>Walk through each piece of evidence: "Exhibit A: Carrier tracking from UPS (1Z999AA10123456784) shows delivery on March 20, 2025, signed by J. Smith at the billing address. Exhibit B: Customer email dated March 22 confirms receipt and satisfaction."</p><h3>Conclusion</h3><p>Request the reversal professionally: "Based on the above evidence, we respectfully request that this chargeback be reversed and the funds returned to our account."</p><h2>Tips for a compelling letter</h2><ul><li><strong>Be concise:</strong> One page maximum. Reviewers read hundreds of these.</li><li><strong>Be specific:</strong> Cite exhibit labels, dates, and amounts.</li><li><strong>Be professional:</strong> No emotional language or accusations.</li><li><strong>Address the reason code:</strong> Every sentence should relate to the specific claim.</li></ul><h2>Reason code variations</h2><p>For fraud claims (10.x), emphasize AVS/CVV match results and customer purchase history. For "not received" claims (13.1), lead with tracking and delivery proof. For "not as described" claims (13.3), show product page screenshots matching the delivered item.</p>`, keyTakeaways: ["A rebuttal letter guides the bank reviewer through your evidence", "Keep it to one page — cite exhibit labels, dates, and amounts", "Address the specific reason code in every sentence", "Professional tone wins; emotional language loses", "Customize the template per dispute — generic letters fail"], faq: [{ q: "Is a rebuttal letter required?", a: "Most processors require or strongly recommend one. Without it, the reviewer must interpret your evidence without guidance — reducing your win rate." }, { q: "Can I use bullet points?", a: "Yes. Short paragraphs and bullet points are easier to scan than dense prose." }], disclaimer: "This template is for guidance only. Adapt it to your specific dispute and processor requirements." } },
      "de-DE": { title: "Vorlage für ein Chargeback-Widerspruchsschreiben", excerpt: "Eine bewährte Vorlage für Widerspruchsschreiben, die die häufigsten Chargeback-Grundcodes adressiert — bereit zur Anpassung an Ihre Shopify-Streitfälle.", body: { mainHtml: `<h2>Was ist ein Widerspruchsschreiben?</h2><p>Ein Widerspruchsschreiben ist das erzählerische Begleitdokument, das Sie zusammen mit Ihren Beweisen bei der Anfechtung eines Chargebacks einreichen. Es erklärt dem Bankprüfer genau, warum der Streitfall rückgängig gemacht werden sollte.</p><h2>Vorlagenstruktur</h2><h3>Eröffnungsabsatz</h3><p>Nennen Sie die Streitfalldetails: Bestellnummer, Transaktionsdatum, Betrag und den Grundcode.</p><h3>Bewiszusammenfassung</h3><p>Führen Sie durch jedes Beweisstück: „Anlage A: Sendungsverfolgung zeigt Zustellung am 20. März 2025, unterschrieben von J. Schmidt."</p><h3>Schlussfolgerung</h3><p>Bitten Sie professionell um die Rückbuchung: „Auf Grundlage der obigen Beweise bitten wir höflich um Rückbuchung des Chargebacks."</p><h2>Tipps</h2><ul><li>Maximal eine Seite.</li><li>Spezifisch: Anlagebezeichnungen, Daten und Beträge nennen.</li><li>Professioneller Ton.</li><li>Jeden Satz auf den Grundcode beziehen.</li></ul>`, keyTakeaways: ["Ein Widerspruchsschreiben führt den Bankprüfer durch Ihre Beweise", "Maximal eine Seite — Anlagebezeichnungen, Daten und Beträge nennen", "Adressieren Sie den spezifischen Grundcode in jedem Satz", "Professioneller Ton gewinnt", "Passen Sie die Vorlage pro Streitfall an"], faq: [{ q: "Ist ein Widerspruchsschreiben erforderlich?", a: "Die meisten Prozessoren empfehlen es dringend. Ohne Schreiben muss der Prüfer Ihre Beweise ohne Anleitung interpretieren." }, { q: "Kann ich Aufzählungspunkte verwenden?", a: "Ja. Kurze Absätze und Aufzählungen sind leichter zu überfliegen." }], disclaimer: "Diese Vorlage dient nur als Orientierung." } },
      "fr-FR": { title: "Modèle de lettre de réponse à une rétrofacturation", excerpt: "Un modèle de lettre de réfutation éprouvé couvrant les codes motifs les plus courants — prêt à personnaliser pour vos litiges Shopify.", body: { mainHtml: `<h2>Qu'est-ce qu'une lettre de réfutation ?</h2><p>Une lettre de réfutation est le document narratif que vous soumettez avec vos preuves lors de la contestation d'une rétrofacturation. Elle guide le réviseur de la banque à travers vos preuves.</p><h2>Structure du modèle</h2><h3>Paragraphe d'ouverture</h3><p>Indiquez les détails du litige : numéro de commande, date, montant et code motif.</p><h3>Résumé des preuves</h3><p>Passez en revue chaque pièce justificative : « Pièce A : le suivi du transporteur montre la livraison le 20 mars 2025. »</p><h3>Conclusion</h3><p>Demandez l'annulation de manière professionnelle.</p><h2>Conseils</h2><ul><li>Maximum une page.</li><li>Soyez spécifique : citez les pièces, dates et montants.</li><li>Ton professionnel.</li><li>Chaque phrase doit se rapporter au code motif.</li></ul>`, keyTakeaways: ["Une lettre de réfutation guide le réviseur à travers vos preuves", "Maximum une page — citez les pièces et les dates", "Chaque phrase doit se rapporter au code motif", "Le ton professionnel gagne", "Personnalisez le modèle par litige"], faq: [{ q: "La lettre est-elle obligatoire ?", a: "La plupart des processeurs la recommandent fortement." }, { q: "Puis-je utiliser des puces ?", a: "Oui. Les paragraphes courts et les puces sont plus faciles à scanner." }], disclaimer: "Ce modèle est fourni à titre indicatif uniquement." } },
      "es-ES": { title: "Plantilla de carta de réplica ante contracargos", excerpt: "Una plantilla de carta de refutación probada que aborda los códigos de motivo más comunes — lista para personalizar en sus disputas de Shopify.", body: { mainHtml: `<h2>¿Qué es una carta de refutación?</h2><p>Una carta de refutación es el documento narrativo que presenta junto con sus pruebas al contestar un contracargo. Guía al revisor del banco a través de sus pruebas en orden lógico.</p><h2>Estructura de la plantilla</h2><h3>Párrafo de apertura</h3><p>Indique los detalles de la disputa: número de pedido, fecha, importe y código de motivo.</p><h3>Resumen de evidencia</h3><p>Repase cada prueba: «Anexo A: el seguimiento muestra la entrega el 20 de marzo de 2025.»</p><h3>Conclusión</h3><p>Solicite la reversión de forma profesional.</p><h2>Consejos</h2><ul><li>Máximo una página.</li><li>Sea específico: cite anexos, fechas e importes.</li><li>Tono profesional.</li><li>Cada frase debe relacionarse con el código de motivo.</li></ul>`, keyTakeaways: ["Una carta de refutación guía al revisor a través de sus pruebas", "Máximo una página — cite anexos, fechas e importes", "Cada frase debe referirse al código de motivo", "El tono profesional gana", "Personalice la plantilla por disputa"], faq: [{ q: "¿Es obligatoria la carta?", a: "La mayoría de los procesadores la recomiendan encarecidamente." }, { q: "¿Puedo usar viñetas?", a: "Sí. Párrafos cortos y viñetas son más fáciles de escanear." }], disclaimer: "Esta plantilla es solo orientativa." } },
      "pt-BR": { title: "Modelo de carta de contestação de chargeback", excerpt: "Um modelo comprovado de carta de contestação que aborda os códigos de motivo mais comuns — pronto para personalizar nas suas disputas Shopify.", body: { mainHtml: `<h2>O que é uma carta de contestação?</h2><p>Uma carta de contestação é o documento narrativo que você envia junto com suas evidências ao contestar um chargeback. Ela guia o revisor do banco através das suas evidências.</p><h2>Estrutura do modelo</h2><h3>Parágrafo de abertura</h3><p>Indique os detalhes da disputa: número do pedido, data, valor e código de motivo.</p><h3>Resumo das evidências</h3><p>Passe por cada peça: «Anexo A: rastreamento mostra entrega em 20 de março de 2025.»</p><h3>Conclusão</h3><p>Solicite a reversão profissionalmente.</p><h2>Dicas</h2><ul><li>Máximo uma página.</li><li>Seja específico: cite anexos, datas e valores.</li><li>Tom profissional.</li><li>Cada frase deve se referir ao código de motivo.</li></ul>`, keyTakeaways: ["Uma carta de contestação guia o revisor através das suas evidências", "Máximo uma página — cite anexos, datas e valores", "Cada frase deve se referir ao código de motivo", "Tom profissional vence", "Personalize o modelo por disputa"], faq: [{ q: "A carta é obrigatória?", a: "A maioria dos processadores a recomenda fortemente." }, { q: "Posso usar marcadores?", a: "Sim. Parágrafos curtos e marcadores são mais fáceis de escanear." }], disclaimer: "Este modelo é apenas orientativo." } },
      "sv-SE": { title: "Mall för chargeback-motpartsbrev", excerpt: "En beprövad mall för vederläggningsbrev som bemöter de vanligaste chargeback-orsakskoderna — redo att anpassa för dina Shopify-tvister.", body: { mainHtml: `<h2>Vad är ett vederläggningsbrev?</h2><p>Ett vederläggningsbrev är det narrativa dokumentet du skickar in med dina bevis vid bestridande av en chargeback. Det guidar bankens granskare genom dina bevis i logisk ordning.</p><h2>Mallens struktur</h2><h3>Inledande stycke</h3><p>Ange tvistens detaljer: ordernummer, datum, belopp och orsakskod.</p><h3>Bevissammanfattning</h3><p>Gå igenom varje bevis: «Bilaga A: spårning visar leverans den 20 mars 2025.»</p><h3>Avslutning</h3><p>Begär reversering professionellt.</p><h2>Tips</h2><ul><li>Max en sida.</li><li>Var specifik: citera bilagor, datum och belopp.</li><li>Professionell ton.</li><li>Varje mening ska relatera till orsakskoden.</li></ul>`, keyTakeaways: ["Ett vederläggningsbrev guidar granskaren genom dina bevis", "Max en sida — citera bilagor, datum och belopp", "Varje mening ska relatera till orsakskoden", "Professionell ton vinner", "Anpassa mallen per tvist"], faq: [{ q: "Krävs ett vederläggningsbrev?", a: "De flesta processorer rekommenderar det starkt." }, { q: "Kan jag använda punktlistor?", a: "Ja. Korta stycken och punktlistor är lättare att skanna." }], disclaimer: "Denna mall är enbart vägledande." } }
    }
  },
  {
    slug: "mediation-vs-arbitration-vs-small-claims",
    pillar: "mediation-arbitration",
    type: "cluster_article",
    readingTime: 11,
    tags: ["disputes", "merchants"],
    content: {
      "en-US": { title: "Mediation vs Arbitration vs Small Claims", excerpt: "Compare the three main dispute resolution paths — mediation, arbitration, and small claims court — to choose the right option for your situation.", body: { mainHtml: `<h2>Three paths, different trade-offs</h2><p>When a payment dispute can't be resolved directly between merchant and customer, three formal paths exist. Each has different costs, timelines, and levels of binding authority.</p><h2>Mediation</h2><p>A neutral mediator facilitates negotiation between both parties. The mediator doesn't decide the outcome — they help both sides find a mutually acceptable resolution. Mediation is usually the fastest and cheapest option, costing $100–$500 per session. It works best when both parties want to preserve a relationship and are willing to compromise.</p><h3>Pros</h3><ul><li>Voluntary and collaborative</li><li>Low cost ($100–$500)</li><li>Fast (often resolved in a single session)</li><li>Confidential</li></ul><h3>Cons</h3><ul><li>Non-binding unless both parties agree to a settlement</li><li>Requires good faith from both sides</li></ul><h2>Arbitration</h2><p>An arbitrator hears evidence from both sides and issues a binding decision. Think of it as a streamlined private trial. Arbitration costs more ($1,000–$5,000+) but provides finality. Most e-commerce terms of service include mandatory arbitration clauses.</p><h3>Pros</h3><ul><li>Binding decision — finality</li><li>Faster than court (weeks to months)</li><li>Private and confidential</li></ul><h3>Cons</h3><ul><li>Higher cost</li><li>Limited appeal options</li><li>Can feel one-sided if one party has more resources</li></ul><h2>Small claims court</h2><p>For disputes under a threshold (typically $5,000–$10,000 depending on jurisdiction), small claims court is a public, low-cost option. Filing fees range from $30–$100. No lawyer is required. The judge's decision is binding.</p><h3>Pros</h3><ul><li>Very low cost ($30–$100 filing)</li><li>No lawyer required</li><li>Binding decision</li></ul><h3>Cons</h3><ul><li>Public record</li><li>Amount limits vary by jurisdiction</li><li>Slower than mediation or arbitration</li></ul><h2>When to use each</h2><p>Use mediation first when the relationship matters and both parties are reasonable. Use arbitration when you need a binding decision and the amount justifies the cost. Use small claims for lower-value disputes when mediation has failed.</p>`, keyTakeaways: ["Mediation: fastest, cheapest, non-binding — best when both parties want resolution", "Arbitration: binding decision, moderate cost — best for finality", "Small claims: very low cost, binding, but public and slower", "Most e-commerce ToS include mandatory arbitration clauses", "Start with mediation; escalate to arbitration or court only if needed"], faq: [{ q: "Can I require customers to use arbitration?", a: "Many e-commerce platforms include mandatory arbitration in their terms of service. However, enforceability varies by jurisdiction, especially in the EU where consumer rights may override arbitration clauses." }, { q: "Is online dispute resolution (ODR) an option?", a: "Yes. ODR platforms handle disputes entirely online, combining elements of mediation and arbitration. The EU operates its own ODR platform for cross-border consumer disputes." }], disclaimer: "This content is for informational purposes only and does not constitute legal advice. Consult a qualified attorney for your specific situation." } },
      "de-DE": { title: "Mediation vs. Schiedsverfahren vs. Bagatellverfahren", excerpt: "Vergleichen Sie die drei Wege der Streitbeilegung — Mediation, Schiedsverfahren und Bagatellverfahren — um die richtige Option zu wählen.", body: { mainHtml: `<h2>Drei Wege, verschiedene Kompromisse</h2><p>Wenn ein Zahlungsstreit nicht direkt gelöst werden kann, gibt es drei formelle Wege. Jeder hat unterschiedliche Kosten, Zeitrahmen und Bindungskraft.</p><h2>Mediation</h2><p>Ein neutraler Mediator unterstützt die Verhandlung. Mediation ist in der Regel die schnellste und günstigste Option (100–500 €). Sie funktioniert am besten, wenn beide Parteien kompromissbereit sind.</p><h2>Schiedsverfahren</h2><p>Ein Schiedsrichter hört Beweise und fällt eine bindende Entscheidung. Kosten: 1.000–5.000 €+. Die meisten E-Commerce-AGB enthalten Schiedsklauseln.</p><h2>Bagatellverfahren</h2><p>Für Streitfälle unter einem Schwellenwert (5.000–10.000 €). Gerichtsgebühren: 30–100 €. Kein Anwalt erforderlich.</p><h2>Wann welchen Weg wählen</h2><p>Mediation zuerst, wenn die Beziehung wichtig ist. Schiedsverfahren für bindende Entscheidungen. Bagatellverfahren für geringwertige Streitfälle.</p>`, keyTakeaways: ["Mediation: schnellste, günstigste Option — nicht bindend", "Schiedsverfahren: bindende Entscheidung, moderate Kosten", "Bagatellverfahren: sehr günstig, bindend, aber öffentlich", "Beginnen Sie mit Mediation, eskalieren Sie nur bei Bedarf"], faq: [{ q: "Kann ich Kunden zur Schiedsgerichtsbarkeit verpflichten?", a: "Viele E-Commerce-Plattformen schließen Schiedsklauseln in ihre AGB ein. Die Durchsetzbarkeit variiert je nach Gerichtsbarkeit, besonders in der EU." }], disclaimer: "Dieser Inhalt stellt keine Rechtsberatung dar." } },
      "fr-FR": { title: "Médiation, arbitrage et petites créances", excerpt: "Comparez les trois voies de résolution des litiges — médiation, arbitrage et tribunal des petites créances — pour choisir la bonne option.", body: { mainHtml: `<h2>Trois voies, différents compromis</h2><p>Quand un litige ne peut pas être résolu directement, trois voies formelles existent avec des coûts, délais et niveaux d'autorité différents.</p><h2>Médiation</h2><p>Un médiateur neutre facilite la négociation. Option la plus rapide et la moins chère (100–500 €).</p><h2>Arbitrage</h2><p>Un arbitre rend une décision contraignante. Coût : 1 000–5 000 €+. La plupart des CGV e-commerce incluent des clauses d'arbitrage.</p><h2>Tribunal des petites créances</h2><p>Pour les litiges sous un seuil (5 000–10 000 €). Frais de dépôt : 30–100 €. Pas d'avocat requis.</p><h2>Quand utiliser chaque voie</h2><p>Médiation d'abord quand la relation compte. Arbitrage pour une décision finale. Petites créances pour les litiges de faible valeur.</p>`, keyTakeaways: ["Médiation : rapide, peu coûteuse, non contraignante", "Arbitrage : décision contraignante, coût modéré", "Petites créances : très peu coûteux, contraignant, mais public", "Commencez par la médiation"], faq: [{ q: "Puis-je obliger les clients à l'arbitrage ?", a: "Beaucoup de CGV incluent des clauses d'arbitrage, mais leur application varie, surtout dans l'UE." }], disclaimer: "Ce contenu ne constitue pas un conseil juridique." } },
      "es-ES": { title: "Mediación vs arbitraje vs pequeñas reclamaciones", excerpt: "Compare las tres vías principales de resolución de disputas — mediación, arbitraje y juzgado de pequeñas reclamaciones.", body: { mainHtml: `<h2>Tres caminos, diferentes compromisos</h2><p>Cuando una disputa no puede resolverse directamente, existen tres vías formales con diferentes costes, plazos y niveles de autoridad.</p><h2>Mediación</h2><p>Un mediador neutral facilita la negociación. La opción más rápida y barata (100–500 €).</p><h2>Arbitraje</h2><p>Un árbitro emite una decisión vinculante. Coste: 1.000–5.000 €+.</p><h2>Pequeñas reclamaciones</h2><p>Para disputas bajo un umbral (5.000–10.000 €). Tasas: 30–100 €. Sin abogado.</p><h2>Cuándo usar cada vía</h2><p>Mediación primero. Arbitraje para decisiones vinculantes. Pequeñas reclamaciones para disputas de bajo valor.</p>`, keyTakeaways: ["Mediación: rápida, barata, no vinculante", "Arbitraje: decisión vinculante, coste moderado", "Pequeñas reclamaciones: muy barato, vinculante, pero público", "Comience con mediación"], faq: [{ q: "¿Puedo obligar a los clientes al arbitraje?", a: "Muchos términos de servicio incluyen cláusulas de arbitraje, pero su aplicación varía según la jurisdicción." }], disclaimer: "Este contenido no constituye asesoramiento jurídico." } },
      "pt-BR": { title: "Mediação vs arbitragem vs pequenas causas", excerpt: "Compare os três caminhos principais de resolução de disputas — mediação, arbitragem e juizado de pequenas causas.", body: { mainHtml: `<h2>Três caminhos, diferentes compensações</h2><p>Quando uma disputa não pode ser resolvida diretamente, existem três vias formais com diferentes custos, prazos e níveis de autoridade.</p><h2>Mediação</h2><p>Um mediador neutro facilita a negociação. Opção mais rápida e barata (R$ 500–2.500).</p><h2>Arbitragem</h2><p>Um árbitro emite uma decisão vinculativa. Custo: R$ 5.000–25.000+.</p><h2>Pequenas causas</h2><p>Para disputas abaixo de um limite (R$ 25.000–50.000). Custas: R$ 150–500. Sem advogado.</p><h2>Quando usar cada via</h2><p>Mediação primeiro. Arbitragem para decisões vinculativas. Pequenas causas para disputas de baixo valor.</p>`, keyTakeaways: ["Mediação: rápida, barata, não vinculativa", "Arbitragem: decisão vinculativa, custo moderado", "Pequenas causas: muito barato, vinculativo, mas público", "Comece com mediação"], faq: [{ q: "Posso obrigar clientes à arbitragem?", a: "Muitos termos de serviço incluem cláusulas de arbitragem, mas a aplicação varia conforme a jurisdição." }], disclaimer: "Este conteúdo não constitui aconselhamento jurídico." } },
      "sv-SE": { title: "Medling vs skiljedom vs småmål", excerpt: "Jämför de tre huvudsakliga tvistlösningsvägarna — medling, skiljedom och småmål — för att välja rätt alternativ.", body: { mainHtml: `<h2>Tre vägar, olika avvägningar</h2><p>När en tvist inte kan lösas direkt finns tre formella vägar med olika kostnader, tidsramar och bindande kraft.</p><h2>Medling</h2><p>En neutral medlare underlättar förhandlingen. Snabbaste och billigaste alternativet (1 000–5 000 kr).</p><h2>Skiljedom</h2><p>En skiljeman fattar ett bindande beslut. Kostnad: 10 000–50 000 kr+.</p><h2>Småmål</h2><p>För tvister under ett tröskelvärde (50 000–100 000 kr). Ansökningsavgift: 300–1 000 kr. Ingen advokat krävs.</p><h2>När använda vilken väg</h2><p>Medling först. Skiljedom för bindande beslut. Småmål för tvister med lågt värde.</p>`, keyTakeaways: ["Medling: snabbast, billigast, ej bindande", "Skiljedom: bindande beslut, måttlig kostnad", "Småmål: mycket billigt, bindande, men offentligt", "Börja med medling"], faq: [{ q: "Kan jag kräva att kunder använder skiljedom?", a: "Många villkor inkluderar skiljedomsklausuler, men tillämpningen varierar beroende på jurisdiktion." }], disclaimer: "Detta innehåll utgör inte juridisk rådgivning." } }
    }
  },
  {
    slug: "how-to-write-a-demand-letter",
    pillar: "dispute-resolution",
    type: "cluster_article",
    readingTime: 9,
    tags: ["disputes", "merchants"],
    content: {
      "en-US": { title: "How to Write a Demand Letter That Gets a Response", excerpt: "A demand letter is often the first formal step in dispute resolution. Learn how to write one that gets taken seriously — structure, tone, and key elements.", body: { mainHtml: `<h2>What is a demand letter?</h2><p>A demand letter is a formal written notice sent before legal action. It clearly states your claim, the evidence supporting it, and what you want the other party to do. A well-crafted demand letter resolves many disputes without ever reaching court or arbitration.</p><h2>Essential elements</h2><h3>1. Clear identification</h3><p>Open with your name, business name, and the recipient's details. State the relationship: "I am the owner of [Store Name], and you purchased [Product] on [Date], Order #[Number]."</p><h3>2. Statement of facts</h3><p>Describe what happened in chronological order. Use dates, amounts, and reference numbers. Avoid opinions or accusations — let the facts speak.</p><h3>3. Legal basis (optional but powerful)</h3><p>Reference relevant consumer protection laws, your terms of service, or card network rules. This shows you've done your research.</p><h3>4. Specific demand</h3><p>State exactly what you want: payment of a specific amount, return of merchandise, correction of a review, or cessation of a specific behavior. Be precise.</p><h3>5. Deadline and consequences</h3><p>Give a reasonable deadline (14–30 days). State what happens if they don't comply: "If I do not receive payment by [Date], I will pursue the matter through [arbitration/small claims court]."</p><h2>Tone matters</h2><p>Professional, firm, and factual. Never threatening, emotional, or insulting. The letter may be read by a judge or arbitrator — write as if they're your audience.</p>`, keyTakeaways: ["A demand letter is often the first formal step before legal action", "Include: identification, facts, legal basis, specific demand, deadline", "Professional and factual tone — never threatening or emotional", "Give 14–30 days for response with clear consequences", "Many disputes resolve at this stage without further escalation"], faq: [{ q: "Do I need a lawyer to write a demand letter?", a: "No, but having an attorney review it adds credibility. For small amounts, writing it yourself is perfectly acceptable." }, { q: "Should I send it by email or postal mail?", a: "Both, ideally. Send a PDF by email for speed, and a physical copy by certified mail for proof of delivery." }], disclaimer: "This content is for informational purposes only and does not constitute legal advice." } },
      "de-DE": { title: "So schreiben Sie ein Mahnschreiben, das Antwort auslöst", excerpt: "Ein Mahnschreiben ist oft der erste formelle Schritt. Lernen Sie, wie Sie eines verfassen, das ernst genommen wird.", body: { mainHtml: `<h2>Was ist ein Mahnschreiben?</h2><p>Ein Mahnschreiben ist eine formelle schriftliche Mitteilung vor rechtlichen Schritten. Es nennt Ihren Anspruch, die stützenden Beweise und Ihre Forderung.</p><h2>Wesentliche Elemente</h2><ul><li>Klare Identifikation beider Parteien</li><li>Sachverhalt in chronologischer Reihenfolge</li><li>Rechtliche Grundlage (optional)</li><li>Spezifische Forderung mit konkretem Betrag</li><li>Frist (14–30 Tage) und Konsequenzen</li></ul><h2>Der Ton zählt</h2><p>Professionell, bestimmt und sachlich. Niemals drohend oder emotional.</p>`, keyTakeaways: ["Ein Mahnschreiben ist oft der erste formelle Schritt", "Identifikation, Sachverhalt, Forderung, Frist einschließen", "Professioneller, sachlicher Ton", "14–30 Tage Frist setzen"], faq: [{ q: "Brauche ich einen Anwalt?", a: "Nein, aber eine anwaltliche Prüfung erhöht die Glaubwürdigkeit." }], disclaimer: "Dieser Inhalt stellt keine Rechtsberatung dar." } },
      "fr-FR": { title: "Rédiger une mise en demeure qui obtient une réponse", excerpt: "Une mise en demeure est souvent la première étape formelle. Apprenez à en rédiger une qui soit prise au sérieux.", body: { mainHtml: `<h2>Qu'est-ce qu'une mise en demeure ?</h2><p>Une mise en demeure est un avis formel envoyé avant toute action en justice. Elle expose votre réclamation, les preuves et ce que vous exigez.</p><h2>Éléments essentiels</h2><ul><li>Identification claire des parties</li><li>Exposé des faits en ordre chronologique</li><li>Base juridique (optionnelle)</li><li>Demande spécifique avec montant précis</li><li>Délai (14–30 jours) et conséquences</li></ul><h2>Le ton compte</h2><p>Professionnel, ferme et factuel. Jamais menaçant ou émotionnel.</p>`, keyTakeaways: ["Une mise en demeure est souvent la première étape formelle", "Identification, faits, demande, délai", "Ton professionnel et factuel", "14–30 jours de délai"], faq: [{ q: "Faut-il un avocat ?", a: "Non, mais une relecture par un avocat renforce la crédibilité." }], disclaimer: "Ce contenu ne constitue pas un conseil juridique." } },
      "es-ES": { title: "Cómo redactar una carta de reclamación que obtenga respuesta", excerpt: "Una carta de reclamación es a menudo el primer paso formal. Aprenda a redactar una que se tome en serio.", body: { mainHtml: `<h2>¿Qué es una carta de reclamación?</h2><p>Una carta de reclamación es un aviso formal enviado antes de acciones legales. Expone su reclamación, las pruebas y lo que exige.</p><h2>Elementos esenciales</h2><ul><li>Identificación clara de ambas partes</li><li>Exposición de hechos cronológica</li><li>Base legal (opcional)</li><li>Demanda específica con importe concreto</li><li>Plazo (14–30 días) y consecuencias</li></ul><h2>El tono importa</h2><p>Profesional, firme y factual. Nunca amenazante ni emocional.</p>`, keyTakeaways: ["Una carta de reclamación es el primer paso formal", "Identificación, hechos, demanda, plazo", "Tono profesional y factual", "14–30 días de plazo"], faq: [{ q: "¿Necesito un abogado?", a: "No, pero la revisión de un abogado añade credibilidad." }], disclaimer: "Este contenido no constituye asesoramiento jurídico." } },
      "pt-BR": { title: "Como escrever uma carta de exigência que gere resposta", excerpt: "Uma carta de exigência é frequentemente o primeiro passo formal. Aprenda a escrever uma que seja levada a sério.", body: { mainHtml: `<h2>O que é uma carta de exigência?</h2><p>Uma carta de exigência é um aviso formal enviado antes de ações legais. Expõe sua reclamação, as evidências e o que você exige.</p><h2>Elementos essenciais</h2><ul><li>Identificação clara de ambas as partes</li><li>Exposição dos fatos em ordem cronológica</li><li>Base legal (opcional)</li><li>Demanda específica com valor concreto</li><li>Prazo (14–30 dias) e consequências</li></ul><h2>O tom importa</h2><p>Profissional, firme e factual. Nunca ameaçador ou emocional.</p>`, keyTakeaways: ["Uma carta de exigência é o primeiro passo formal", "Identificação, fatos, demanda, prazo", "Tom profissional e factual", "14–30 dias de prazo"], faq: [{ q: "Preciso de um advogado?", a: "Não, mas a revisão de um advogado aumenta a credibilidade." }], disclaimer: "Este conteúdo não constitui aconselhamento jurídico." } },
      "sv-SE": { title: "Skriv ett kravbrev som får svar", excerpt: "Ett kravbrev är ofta det första formella steget. Lär dig skriva ett som tas på allvar.", body: { mainHtml: `<h2>Vad är ett kravbrev?</h2><p>Ett kravbrev är ett formellt skriftligt meddelande som skickas före rättsliga åtgärder. Det anger ditt krav, stödjande bevis och vad du kräver.</p><h2>Väsentliga element</h2><ul><li>Tydlig identifiering av båda parter</li><li>Redogörelse för fakta i kronologisk ordning</li><li>Rättslig grund (valfritt)</li><li>Specifikt krav med exakt belopp</li><li>Tidsfrist (14–30 dagar) och konsekvenser</li></ul><h2>Tonen spelar roll</h2><p>Professionell, bestämd och saklig. Aldrig hotfull eller emotionell.</p>`, keyTakeaways: ["Ett kravbrev är ofta det första formella steget", "Identifiering, fakta, krav, tidsfrist", "Professionell och saklig ton", "14–30 dagars tidsfrist"], faq: [{ q: "Behöver jag en advokat?", a: "Nej, men en advokats granskning ökar trovärdigheten." }], disclaimer: "Detta innehåll utgör inte juridisk rådgivning." } }
    }
  },
  TOP_CHARGEBACK_ARTICLE,

  {
    slug: "policy-update-roundup",
    pillar: "dispute-resolution",
    type: "legal_update",
    readingTime: 6,
    tags: ["compliance", "disputes"],
    content: {
      "en-US": { title: "Policy Update Roundup", excerpt: "The latest card network policy changes affecting dispute management — Visa and Mastercard rule updates that merchants need to know.", body: { mainHtml: `<h2>Why policy changes matter</h2><p>Card networks update their dispute rules regularly. Missing a policy change can mean submitting evidence that no longer meets requirements, or missing new opportunities to win disputes you'd previously lose.</p><h2>Visa Compelling Evidence 3.0</h2><p>Visa's CE 3.0 allows merchants to submit historical transaction data as evidence for fraud disputes. If you can show two prior undisputed transactions from the same cardholder with matching identifiers (IP address, device ID, or delivery address), the dispute can be reversed without traditional evidence.</p><h2>Mastercard Collaboration</h2><p>Mastercard's collaboration program encourages merchants and issuers to resolve disputes before they become chargebacks. Merchants enrolled in the program receive alerts 24–72 hours before a chargeback is filed, giving them time to issue a refund and avoid the chargeback fee.</p><h2>Response deadline updates</h2><p>Both networks periodically adjust response deadlines. Always check your processor dashboard for the current deadline — don't rely on general timelines published online.</p><h2>Staying current</h2><p>Subscribe to your processor's policy update newsletters. Review card network bulletins quarterly. Update your evidence templates whenever a rule changes.</p>`, keyTakeaways: ["Visa CE 3.0 lets merchants use historical transaction data to fight fraud disputes", "Mastercard Collaboration gives 24–72 hour advance notice before chargebacks", "Response deadlines change — always check your processor dashboard", "Review card network bulletins quarterly to stay compliant"], faq: [{ q: "How often do card networks change rules?", a: "Major updates happen 2–4 times per year, with minor adjustments more frequently. Your processor should notify you of changes that affect your business." }], disclaimer: "This summary is current as of publication. Card network rules change frequently — verify current policies with your payment processor." } },
      "de-DE": { title: "Rundum zu Policy-Updates", excerpt: "Die neuesten Änderungen der Kartennetzwerk-Richtlinien, die das Streitmanagement betreffen.", body: { mainHtml: `<h2>Warum Richtlinienänderungen wichtig sind</h2><p>Kartennetzwerke aktualisieren ihre Streitregeln regelmäßig. Eine verpasste Änderung kann bedeuten, dass Beweise nicht mehr den Anforderungen entsprechen.</p><h2>Visa Compelling Evidence 3.0</h2><p>CE 3.0 erlaubt es Händlern, historische Transaktionsdaten als Beweis bei Betrugsstreitigkeiten einzureichen.</p><h2>Mastercard Collaboration</h2><p>Das Programm sendet Warnungen 24–72 Stunden vor einem Chargeback.</p><h2>Aktuell bleiben</h2><p>Abonnieren Sie die Newsletter Ihres Prozessors. Prüfen Sie Kartennetzwerk-Bulletins vierteljährlich.</p>`, keyTakeaways: ["Visa CE 3.0: historische Transaktionsdaten als Beweis", "Mastercard Collaboration: 24–72 Stunden Vorwarnung", "Fristen ändern sich — immer im Dashboard prüfen", "Vierteljährlich Kartennetzwerk-Bulletins prüfen"], faq: [{ q: "Wie oft ändern Netzwerke die Regeln?", a: "Große Updates 2–4 Mal pro Jahr, kleinere häufiger." }], disclaimer: "Zusammenfassung zum Zeitpunkt der Veröffentlichung aktuell." } },
      "fr-FR": { title: "Tour d'horizon des mises à jour juridiques", excerpt: "Les dernières modifications des politiques des réseaux de cartes affectant la gestion des litiges.", body: { mainHtml: `<h2>Pourquoi les changements de politique comptent</h2><p>Les réseaux de cartes mettent à jour leurs règles régulièrement. Manquer un changement peut signifier soumettre des preuves non conformes.</p><h2>Visa Compelling Evidence 3.0</h2><p>CE 3.0 permet aux marchands de soumettre des données de transactions historiques comme preuves.</p><h2>Mastercard Collaboration</h2><p>Le programme envoie des alertes 24–72 heures avant une rétrofacturation.</p><h2>Rester à jour</h2><p>Abonnez-vous aux newsletters de votre processeur. Consultez les bulletins des réseaux trimestriellement.</p>`, keyTakeaways: ["Visa CE 3.0 : données historiques comme preuves", "Mastercard Collaboration : 24–72 heures de préavis", "Les délais changent — vérifiez toujours votre tableau de bord", "Consultez les bulletins des réseaux trimestriellement"], faq: [{ q: "À quelle fréquence les réseaux changent-ils les règles ?", a: "Mises à jour majeures 2–4 fois par an." }], disclaimer: "Résumé actuel à la date de publication." } },
      "es-ES": { title: "Resumen de actualizaciones normativas", excerpt: "Los últimos cambios de política de las redes de tarjetas que afectan la gestión de disputas.", body: { mainHtml: `<h2>Por qué importan los cambios de política</h2><p>Las redes de tarjetas actualizan sus reglas regularmente. Perder un cambio puede significar presentar evidencia no conforme.</p><h2>Visa Compelling Evidence 3.0</h2><p>CE 3.0 permite usar datos históricos de transacciones como evidencia.</p><h2>Mastercard Collaboration</h2><p>El programa envía alertas 24–72 horas antes de un contracargo.</p><h2>Mantenerse actualizado</h2><p>Suscríbase a los boletines de su procesador. Revise los boletines de redes trimestralmente.</p>`, keyTakeaways: ["Visa CE 3.0: datos históricos como evidencia", "Mastercard Collaboration: 24–72 horas de preaviso", "Los plazos cambian — verifique siempre su panel", "Revise boletines de redes trimestralmente"], faq: [{ q: "¿Con qué frecuencia cambian las reglas?", a: "Actualizaciones importantes 2–4 veces al año." }], disclaimer: "Resumen actual a la fecha de publicación." } },
      "pt-BR": { title: "Resumo de atualizações de políticas", excerpt: "As últimas mudanças de política das bandeiras de cartão que afetam a gestão de disputas.", body: { mainHtml: `<h2>Por que mudanças de política importam</h2><p>As bandeiras atualizam suas regras regularmente. Perder uma mudança pode significar enviar evidências não conformes.</p><h2>Visa Compelling Evidence 3.0</h2><p>CE 3.0 permite usar dados históricos de transações como evidência.</p><h2>Mastercard Collaboration</h2><p>O programa envia alertas 24–72 horas antes de um chargeback.</p><h2>Manter-se atualizado</h2><p>Assine as newsletters do seu processador. Revise os boletins das bandeiras trimestralmente.</p>`, keyTakeaways: ["Visa CE 3.0: dados históricos como evidência", "Mastercard Collaboration: 24–72 horas de aviso prévio", "Prazos mudam — verifique sempre seu painel", "Revise boletins das bandeiras trimestralmente"], faq: [{ q: "Com que frequência as regras mudam?", a: "Atualizações importantes 2–4 vezes por ano." }], disclaimer: "Resumo atual na data de publicação." } },
      "sv-SE": { title: "Sammanfattning av policyuppdateringar", excerpt: "De senaste ändringarna i kortnätverkens policyer som påverkar tvisthantering.", body: { mainHtml: `<h2>Varför policyändringar spelar roll</h2><p>Kortnätverk uppdaterar sina tvistregler regelbundet. Att missa en ändring kan innebära att skicka in bevis som inte längre uppfyller kraven.</p><h2>Visa Compelling Evidence 3.0</h2><p>CE 3.0 låter handlare använda historiska transaktionsdata som bevis.</p><h2>Mastercard Collaboration</h2><p>Programmet skickar varningar 24–72 timmar före en chargeback.</p><h2>Håll dig uppdaterad</h2><p>Prenumerera på din processors nyhetsbrev. Granska kortnätverks bulletiner kvartalsvis.</p>`, keyTakeaways: ["Visa CE 3.0: historiska transaktionsdata som bevis", "Mastercard Collaboration: 24–72 timmars förvarning", "Tidsfrister ändras — kontrollera alltid din dashboard", "Granska kortnätverks bulletiner kvartalsvis"], faq: [{ q: "Hur ofta ändrar nätverken regler?", a: "Större uppdateringar 2–4 gånger per år." }], disclaimer: "Sammanfattning aktuell vid publicering." } }
    }
  },
  {
    slug: "dispute-resolution-process-playbook",
    pillar: "dispute-resolution",
    type: "pillar_page",
    readingTime: 15,
    tags: ["disputes", "merchants", "compliance"],
    content: {
      "en-US": { title: "Dispute Resolution Process: Step-by-Step Playbook", excerpt: "The definitive playbook for handling payment disputes — from the moment a notification arrives to final resolution, covering every stage and decision point.", body: { mainHtml: `<h2>Overview</h2><p>This playbook covers the complete dispute resolution process for e-commerce merchants. Whether you're handling your first chargeback or your hundredth, following a systematic process dramatically improves your win rate and reduces the time spent on each case.</p><h2>Stage 1: Notification received</h2><p>When you receive a chargeback notification, immediately record the key details: case number, reason code, transaction amount, deadline, and card network. Tag the dispute in your tracking system.</p><h2>Stage 2: Initial assessment (first 24 hours)</h2><p>Determine whether to fight or accept. Check: Is the dispute legitimate? Do you have evidence to counter the claim? Is the amount worth the effort? If the customer has a valid complaint, a refund may be cheaper than fighting.</p><h2>Stage 3: Evidence collection (days 1–5)</h2><p>Gather all relevant evidence organized by category: transaction authorization (AVS/CVV match, 3D Secure), fulfillment (tracking, delivery confirmation), customer communications (emails, chat logs), and policies (return policy, terms of service).</p><h2>Stage 4: Build the response (days 5–10)</h2><p>Write your rebuttal letter addressing the specific reason code. Attach evidence in labeled exhibits. Review everything for completeness and clarity.</p><h2>Stage 5: Submit and track</h2><p>Submit through your processor's portal well before the deadline. Save a copy of everything submitted. Set a reminder to check the outcome.</p><h2>Stage 6: Outcome and follow-up</h2><p>If you win, the funds are returned. If you lose, analyze why and update your processes. Track win rates by reason code to identify patterns.</p><h2>Prevention feedback loop</h2><p>Every dispute is a data point. Track which products, customer segments, and shipping methods generate the most disputes. Use this data to prevent future chargebacks.</p>`, keyTakeaways: ["Follow a 6-stage process: notification → assessment → evidence → response → submit → follow-up", "First 24 hours: decide fight-or-accept based on evidence strength and amount", "Track win rates by reason code to identify patterns and improve", "Every dispute is a data point — feed learnings back into prevention", "Submit well before the deadline; late submissions automatically lose"], faq: [{ q: "How long does the full process take?", a: "With good tooling, 2–4 hours per dispute. Without automation, 4–8 hours. The playbook compresses this by ensuring you don't waste time on dead ends." }, { q: "What win rate should I aim for?", a: "Industry average is 20–30%. Well-prepared merchants achieve 45–65%. Above 65% usually indicates you're only fighting the easiest cases." }], disclaimer: "This playbook is for informational purposes only and does not constitute legal advice." } },
      "de-DE": { title: "Streitbeilegung: Schritt-für-Schritt-Playbook", excerpt: "Das definitive Playbook für die Bearbeitung von Zahlungsstreitigkeiten — vom Benachrichtigungseingang bis zur endgültigen Lösung.", body: { mainHtml: `<h2>Übersicht</h2><p>Dieses Playbook behandelt den vollständigen Streitbeilegungsprozess für E-Commerce-Händler.</p><h2>Stufe 1: Benachrichtigung erhalten</h2><p>Erfassen Sie sofort: Fallnummer, Grundcode, Betrag, Frist und Kartennetzwerk.</p><h2>Stufe 2: Erstbewertung (erste 24 Stunden)</h2><p>Entscheiden Sie: Anfechten oder akzeptieren? Haben Sie Beweise?</p><h2>Stufe 3: Beweissammlung (Tag 1–5)</h2><p>Sammeln Sie Beweise nach Kategorie: Autorisierung, Lieferung, Kommunikation, Richtlinien.</p><h2>Stufe 4: Antwort erstellen (Tag 5–10)</h2><p>Widerlegungsschreiben verfassen, Beweise als Anlagen beifügen.</p><h2>Stufe 5: Einreichen und verfolgen</h2><p>Vor der Frist über das Portal einreichen.</p><h2>Stufe 6: Ergebnis und Nachbereitung</h2><p>Bei Gewinn: Gelder zurück. Bei Verlust: analysieren und Prozesse verbessern.</p>`, keyTakeaways: ["6-Stufen-Prozess systematisch befolgen", "Erste 24 Stunden: Anfechten oder Akzeptieren entscheiden", "Gewinnquoten nach Grundcode verfolgen", "Jeder Streitfall ist ein Datenpunkt für Prävention"], faq: [{ q: "Welche Gewinnquote sollte ich anstreben?", a: "Branchendurchschnitt 20–30 %. Gut vorbereitete Händler erreichen 45–65 %." }], disclaimer: "Dieses Playbook stellt keine Rechtsberatung dar." } },
      "fr-FR": { title: "Processus de résolution des litiges : guide pas à pas", excerpt: "Le guide définitif pour traiter les litiges de paiement — de la notification à la résolution finale.", body: { mainHtml: `<h2>Aperçu</h2><p>Ce guide couvre le processus complet de résolution des litiges pour les marchands e-commerce.</p><h2>Étape 1 : Notification reçue</h2><p>Enregistrez immédiatement : numéro de cas, code motif, montant, délai et réseau.</p><h2>Étape 2 : Évaluation initiale (24 premières heures)</h2><p>Contester ou accepter ? Avez-vous des preuves ?</p><h2>Étape 3 : Collecte de preuves (jours 1–5)</h2><p>Rassemblez par catégorie : autorisation, livraison, communication, politiques.</p><h2>Étape 4 : Construire la réponse (jours 5–10)</h2><p>Rédigez la lettre de réfutation, joignez les preuves.</p><h2>Étape 5 : Soumettre et suivre</h2><p>Soumettez avant la date limite.</p><h2>Étape 6 : Résultat et suivi</h2><p>Si victoire : fonds retournés. Si défaite : analyser et améliorer.</p>`, keyTakeaways: ["Suivez un processus en 6 étapes", "24 premières heures : décider de contester ou accepter", "Suivez les taux de victoire par code motif", "Chaque litige est un point de données pour la prévention"], faq: [{ q: "Quel taux de victoire viser ?", a: "Moyenne du secteur 20–30 %. Marchands bien préparés : 45–65 %." }], disclaimer: "Ce guide ne constitue pas un conseil juridique." } },
      "es-ES": { title: "Proceso de resolución de disputas: guía paso a paso", excerpt: "El manual definitivo para gestionar disputas de pago — desde la notificación hasta la resolución final.", body: { mainHtml: `<h2>Resumen</h2><p>Este manual cubre el proceso completo de resolución de disputas para comerciantes de e-commerce.</p><h2>Etapa 1: Notificación recibida</h2><p>Registre inmediatamente: número de caso, código de motivo, importe, plazo y red.</p><h2>Etapa 2: Evaluación inicial (primeras 24 horas)</h2><p>¿Disputar o aceptar? ¿Tiene evidencia?</p><h2>Etapa 3: Recopilación de evidencia (días 1–5)</h2><p>Organice por categoría: autorización, envío, comunicación, políticas.</p><h2>Etapa 4: Construir la respuesta (días 5–10)</h2><p>Redacte la carta de refutación, adjunte evidencia.</p><h2>Etapa 5: Presentar y seguir</h2><p>Presente antes del plazo.</p><h2>Etapa 6: Resultado y seguimiento</h2><p>Si gana: fondos devueltos. Si pierde: analizar y mejorar.</p>`, keyTakeaways: ["Siga un proceso de 6 etapas", "Primeras 24 horas: decidir disputar o aceptar", "Rastrear tasas de éxito por código de motivo", "Cada disputa es un dato para prevención"], faq: [{ q: "¿Qué tasa de éxito apuntar?", a: "Media del sector 20–30 %. Comerciantes bien preparados: 45–65 %." }], disclaimer: "Este manual no constituye asesoramiento jurídico." } },
      "pt-BR": { title: "Processo de resolução de disputas: guia passo a passo", excerpt: "O manual definitivo para lidar com disputas de pagamento — da notificação à resolução final.", body: { mainHtml: `<h2>Visão geral</h2><p>Este manual cobre o processo completo de resolução de disputas para comerciantes de e-commerce.</p><h2>Etapa 1: Notificação recebida</h2><p>Registre imediatamente: número do caso, código de motivo, valor, prazo e bandeira.</p><h2>Etapa 2: Avaliação inicial (primeiras 24 horas)</h2><p>Contestar ou aceitar? Você tem evidências?</p><h2>Etapa 3: Coleta de evidências (dias 1–5)</h2><p>Organize por categoria: autorização, envio, comunicação, políticas.</p><h2>Etapa 4: Construir a resposta (dias 5–10)</h2><p>Redija a carta de contestação, anexe evidências.</p><h2>Etapa 5: Enviar e acompanhar</h2><p>Envie antes do prazo.</p><h2>Etapa 6: Resultado e acompanhamento</h2><p>Se vencer: fundos devolvidos. Se perder: analisar e melhorar.</p>`, keyTakeaways: ["Siga um processo de 6 etapas", "Primeiras 24 horas: decidir contestar ou aceitar", "Rastrear taxas de sucesso por código de motivo", "Cada disputa é um dado para prevenção"], faq: [{ q: "Qual taxa de sucesso almejar?", a: "Média do setor 20–30%. Comerciantes bem preparados: 45–65%." }], disclaimer: "Este manual não constitui aconselhamento jurídico." } },
      "sv-SE": { title: "Process för tvistlösning: steg-för-steg-playbook", excerpt: "Det definitiva handboken för hantering av betalningstvister — från notifikation till slutlig lösning.", body: { mainHtml: `<h2>Översikt</h2><p>Denna handbok täcker den kompletta tvistlösningsprocessen för e-handlare.</p><h2>Steg 1: Notifikation mottagen</h2><p>Registrera omedelbart: ärendenummer, orsakskod, belopp, deadline och kortnätverk.</p><h2>Steg 2: Initial bedömning (första 24 timmarna)</h2><p>Bestrida eller acceptera? Har du bevis?</p><h2>Steg 3: Bevisinsamling (dag 1–5)</h2><p>Organisera efter kategori: auktorisering, leverans, kommunikation, policyer.</p><h2>Steg 4: Bygg svaret (dag 5–10)</h2><p>Skriv vederläggningsbrev, bifoga bevis.</p><h2>Steg 5: Skicka in och följ upp</h2><p>Skicka in före deadline.</p><h2>Steg 6: Resultat och uppföljning</h2><p>Vid vinst: medel returneras. Vid förlust: analysera och förbättra.</p>`, keyTakeaways: ["Följ en 6-stegsprocess", "Första 24 timmarna: besluta bestrida eller acceptera", "Spåra vinstkvot per orsakskod", "Varje tvist är en datapunkt för prevention"], faq: [{ q: "Vilken vinstkvot ska jag sikta på?", a: "Branschsnitt 20–30 %. Välförberedda handlare: 45–65 %." }], disclaimer: "Denna handbok utgör inte juridisk rådgivning." } }
    }
  },
  {
    slug: "online-dispute-resolution-odr-guide",
    pillar: "dispute-resolution",
    type: "cluster_article",
    readingTime: 8,
    tags: ["disputes", "compliance"],
    content: {
      "en-US": { title: "Online Dispute Resolution: When ODR Works", excerpt: "Online Dispute Resolution (ODR) platforms handle disputes entirely digitally. Learn when ODR is the right choice and how it compares to traditional methods.", body: { mainHtml: `<h2>What is ODR?</h2><p>Online Dispute Resolution (ODR) is the digital equivalent of mediation or arbitration. Everything happens online — filing, evidence submission, communication, and resolution. No courtrooms, no in-person meetings.</p><h2>How ODR works</h2><ol><li><strong>Filing:</strong> One party submits a claim through the ODR platform.</li><li><strong>Response:</strong> The other party is notified and submits their response.</li><li><strong>Negotiation:</strong> The platform facilitates communication (direct or through a neutral).</li><li><strong>Resolution:</strong> Either the parties reach agreement, or a neutral renders a decision.</li></ol><h2>When ODR makes sense</h2><ul><li>Cross-border disputes where physical presence is impractical</li><li>Low-to-medium value disputes ($50–$5,000)</li><li>High volume — when you need to resolve many disputes efficiently</li><li>When both parties are comfortable with digital communication</li></ul><h2>The EU ODR Platform</h2><p>The European Union operates an official ODR platform for cross-border consumer disputes. EU-based online sellers are required to provide a link to it. It's free for consumers and handles disputes in all EU languages.</p><h2>Limitations</h2><ul><li>Participation is often voluntary — if the other party won't engage, ODR fails</li><li>Complex disputes involving physical evidence may be better suited to in-person proceedings</li><li>Enforcement of ODR decisions varies by jurisdiction</li></ul>`, keyTakeaways: ["ODR handles disputes entirely online — no courtrooms or physical meetings", "Best for cross-border, low-to-medium value, or high-volume disputes", "The EU operates a free ODR platform for cross-border consumer disputes", "Participation is often voluntary — ODR fails if the other party won't engage", "Enforcement of ODR decisions varies by jurisdiction"], faq: [{ q: "Is ODR legally binding?", a: "It depends on the platform and the process. Some ODR providers offer binding arbitration; others offer non-binding mediation. Check the platform's terms before participating." }, { q: "Do I need to offer ODR to EU customers?", a: "If you sell online to EU consumers, you must provide a link to the EU ODR platform in your terms and on your website. You're not required to participate, but you must provide the link." }], disclaimer: "This content is for informational purposes only and does not constitute legal advice." } },
      "de-DE": { title: "Online-Streitbeilegung: Wenn ODR funktioniert", excerpt: "ODR-Plattformen lösen Streitigkeiten vollständig digital. Erfahren Sie, wann ODR die richtige Wahl ist.", body: { mainHtml: `<h2>Was ist ODR?</h2><p>Online-Streitbeilegung (ODR) ist das digitale Äquivalent zu Mediation oder Schiedsverfahren. Alles geschieht online — Einreichung, Beweise, Kommunikation und Lösung.</p><h2>Wann ODR sinnvoll ist</h2><ul><li>Grenzüberschreitende Streitigkeiten</li><li>Geringe bis mittlere Werte (50–5.000 €)</li><li>Hohes Volumen</li></ul><h2>Die EU-ODR-Plattform</h2><p>Die EU betreibt eine offizielle ODR-Plattform. EU-Online-Verkäufer müssen einen Link bereitstellen.</p><h2>Einschränkungen</h2><ul><li>Teilnahme oft freiwillig</li><li>Durchsetzung variiert je nach Gerichtsbarkeit</li></ul>`, keyTakeaways: ["ODR löst Streitigkeiten vollständig online", "Am besten für grenzüberschreitende Streitigkeiten mit geringem bis mittlerem Wert", "EU betreibt eine kostenlose ODR-Plattform", "Teilnahme oft freiwillig"], faq: [{ q: "Muss ich EU-Kunden ODR anbieten?", a: "Sie müssen einen Link zur EU-ODR-Plattform bereitstellen, wenn Sie online an EU-Verbraucher verkaufen." }], disclaimer: "Dieser Inhalt stellt keine Rechtsberatung dar." } },
      "fr-FR": { title: "Résolution en ligne des litiges : quand la RLL fonctionne", excerpt: "Les plateformes RLL gèrent les litiges entièrement en ligne. Découvrez quand la RLL est le bon choix.", body: { mainHtml: `<h2>Qu'est-ce que la RLL ?</h2><p>La Résolution en Ligne des Litiges (RLL) est l'équivalent numérique de la médiation ou de l'arbitrage.</p><h2>Quand la RLL est pertinente</h2><ul><li>Litiges transfrontaliers</li><li>Valeurs faibles à moyennes (50–5 000 €)</li><li>Volume élevé</li></ul><h2>La plateforme RLL de l'UE</h2><p>L'UE exploite une plateforme RLL officielle. Les vendeurs en ligne de l'UE doivent fournir un lien.</p><h2>Limites</h2><ul><li>Participation souvent volontaire</li><li>L'application des décisions varie selon la juridiction</li></ul>`, keyTakeaways: ["La RLL gère les litiges entièrement en ligne", "Idéale pour les litiges transfrontaliers de faible à moyenne valeur", "L'UE exploite une plateforme RLL gratuite", "Participation souvent volontaire"], faq: [{ q: "Dois-je proposer la RLL aux clients de l'UE ?", a: "Vous devez fournir un lien vers la plateforme RLL de l'UE si vous vendez en ligne aux consommateurs européens." }], disclaimer: "Ce contenu ne constitue pas un conseil juridique." } },
      "es-ES": { title: "Resolución de disputas en línea: cuándo funciona la RLL", excerpt: "Las plataformas de RLL gestionan disputas completamente en línea. Descubra cuándo la RLL es la opción correcta.", body: { mainHtml: `<h2>¿Qué es la RLL?</h2><p>La Resolución de Litigios en Línea (RLL) es el equivalente digital de la mediación o el arbitraje.</p><h2>Cuándo la RLL es adecuada</h2><ul><li>Disputas transfronterizas</li><li>Valores bajos a medios (50–5.000 €)</li><li>Alto volumen</li></ul><h2>La plataforma RLL de la UE</h2><p>La UE opera una plataforma RLL oficial. Los vendedores en línea de la UE deben proporcionar un enlace.</p><h2>Limitaciones</h2><ul><li>Participación a menudo voluntaria</li><li>La aplicación varía según la jurisdicción</li></ul>`, keyTakeaways: ["La RLL gestiona disputas completamente en línea", "Ideal para disputas transfronterizas de bajo a medio valor", "La UE opera una plataforma RLL gratuita", "Participación a menudo voluntaria"], faq: [{ q: "¿Debo ofrecer RLL a clientes de la UE?", a: "Debe proporcionar un enlace a la plataforma RLL de la UE si vende en línea a consumidores europeos." }], disclaimer: "Este contenido no constituye asesoramiento jurídico." } },
      "pt-BR": { title: "Resolução de disputas online: quando a RLL funciona", excerpt: "Plataformas de RLL tratam disputas inteiramente online. Saiba quando a RLL é a escolha certa.", body: { mainHtml: `<h2>O que é RLL?</h2><p>A Resolução de Litígios em Linha (RLL) é o equivalente digital da mediação ou arbitragem.</p><h2>Quando a RLL faz sentido</h2><ul><li>Disputas transfronteiriças</li><li>Valores baixos a médios (R$ 250–25.000)</li><li>Alto volume</li></ul><h2>A plataforma RLL da UE</h2><p>A UE opera uma plataforma RLL oficial para disputas transfronteiriças.</p><h2>Limitações</h2><ul><li>Participação frequentemente voluntária</li><li>Aplicação varia conforme a jurisdição</li></ul>`, keyTakeaways: ["RLL trata disputas inteiramente online", "Ideal para disputas transfronteiriças de baixo a médio valor", "A UE opera uma plataforma RLL gratuita", "Participação frequentemente voluntária"], faq: [{ q: "Devo oferecer RLL a clientes da UE?", a: "Deve fornecer um link para a plataforma RLL da UE se vende online a consumidores europeus." }], disclaimer: "Este conteúdo não constitui aconselhamento jurídico." } },
      "sv-SE": { title: "Onlinetvistlösning: när det fungerar", excerpt: "ODR-plattformar hanterar tvister helt digitalt. Lär dig när ODR är rätt val.", body: { mainHtml: `<h2>Vad är ODR?</h2><p>Online Dispute Resolution (ODR) är den digitala motsvarigheten till medling eller skiljedom.</p><h2>När ODR passar</h2><ul><li>Gränsöverskridande tvister</li><li>Låga till medelhöga värden (500–50 000 kr)</li><li>Hög volym</li></ul><h2>EU:s ODR-plattform</h2><p>EU driver en officiell ODR-plattform. EU-baserade onlinesäljare måste tillhandahålla en länk.</p><h2>Begränsningar</h2><ul><li>Deltagande ofta frivilligt</li><li>Verkställighet varierar beroende på jurisdiktion</li></ul>`, keyTakeaways: ["ODR hanterar tvister helt digitalt", "Bäst för gränsöverskridande tvister med lågt till medelhögt värde", "EU driver en gratis ODR-plattform", "Deltagande ofta frivilligt"], faq: [{ q: "Måste jag erbjuda ODR till EU-kunder?", a: "Du måste tillhandahålla en länk till EU:s ODR-plattform om du säljer online till EU-konsumenter." }], disclaimer: "Detta innehåll utgör inte juridisk rådgivning." } }
    }
  },
  // -----------------------------------------------------------------------
  // 11. Complete Guide to Chargeback Response Time Requirements
  // -----------------------------------------------------------------------
  {
    slug: "chargeback-response-time-requirements",
    pillar: "chargebacks",
    type: "cluster_article",
    readingTime: 8,
    tags: ["chargebacks", "compliance", "merchants"],
    content: {
      "en-US": {
        title: "Complete Guide to Chargeback Response Time Requirements",
        excerpt: "Understanding and meeting chargeback deadlines is critical to protecting your business from revenue loss.",
        body: {
          mainHtml: `
<p>Meeting chargeback deadlines is absolutely critical to protecting your business from revenue loss. Missing a deadline means automatic acceptance of the chargeback, resulting in lost revenue and potential damage to your merchant standing.</p>

<h2>Card Network Response Times</h2>

<h3>Visa Claims Resolution (VCR)</h3>
<ul>
<li><strong>Initial Response</strong>: 30 calendar days from notification</li>
<li><strong>Pre-Arbitration</strong>: 30 calendar days from decision</li>
<li><strong>Arbitration Filing</strong>: 10 calendar days from pre-arbitration decision</li>
</ul>
<p>The Visa Claims Resolution framework streamlines the dispute process but maintains strict deadlines. The 30-day initial response window begins from the moment you receive notification in your payment processor's system.</p>

<h3>Mastercard Dispute Resolution</h3>
<ul>
<li><strong>First Chargeback Response</strong>: 45 calendar days from notification</li>
<li><strong>Second Chargeback</strong>: 45 calendar days from first decision</li>
<li><strong>Arbitration</strong>: 45 calendar days from second decision</li>
</ul>
<p>Mastercard provides slightly longer timeframes but maintains the same strict enforcement. Missing any deadline results in automatic acceptance of the chargeback.</p>

<h3>American Express</h3>
<ul>
<li><strong>Response Deadline</strong>: 20 calendar days from inquiry</li>
<li><strong>Chargeback Response</strong>: 20 calendar days from chargeback</li>
<li><strong>Appeal</strong>: 20 calendar days from decision</li>
</ul>
<p>American Express maintains the strictest timeframes of the major card networks. Their 20-day windows require rapid response and efficient evidence collection processes.</p>

<h3>Discover</h3>
<ul>
<li><strong>Response Time</strong>: 20 calendar days from notification</li>
<li><strong>Appeal</strong>: 20 calendar days from decision</li>
<li><strong>Arbitration</strong>: 20 calendar days from appeal decision</li>
</ul>
<p>Discover aligns with American Express on timeframes, requiring quick turnaround on all dispute responses.</p>

<h2>Critical Timeline Management</h2>

<h3>Day 0-3: Notification and Assessment</h3>
<p>When you receive a chargeback notification:</p>
<ol>
<li><strong>Immediate Review</strong>: Assess the dispute reason code within 24 hours</li>
<li><strong>Evidence Gathering</strong>: Begin collecting relevant documentation</li>
<li><strong>Response Strategy</strong>: Determine whether to accept or contest the chargeback</li>
<li><strong>Team Assignment</strong>: Assign responsibility for the response</li>
</ol>

<h3>Day 4-20: Evidence Collection and Compilation</h3>
<p>This is your core evidence building period:</p>
<ul>
<li>Gather transaction records, customer communications, delivery confirmations</li>
<li>Compile supporting documentation (terms of service, refund policy, etc.)</li>
<li>Organize evidence according to reason code requirements</li>
<li>Draft compelling narrative explaining the transaction</li>
</ul>

<h3>Day 21-25: Review and Quality Control</h3>
<p>Never submit on the deadline day:</p>
<ul>
<li>Internal review of compiled evidence</li>
<li>Legal review if applicable</li>
<li>Quality assurance check</li>
<li>Final formatting and organization</li>
</ul>

<h3>Day 26-28: Submission and Confirmation</h3>
<ul>
<li>Submit response through payment processor portal</li>
<li>Obtain submission confirmation</li>
<li>Document submission date and time</li>
<li>Archive complete response package</li>
</ul>

<h2>Best Practices for Meeting Deadlines</h2>

<h3>1. Automated Notification Systems</h3>
<p>Implement automated alerts for:</p>
<ul>
<li>New chargeback notifications</li>
<li>Approaching deadlines (7, 3, 1 day)</li>
<li>Successful submissions</li>
</ul>

<h3>2. Centralized Evidence Storage</h3>
<p>Maintain organized repositories:</p>
<ul>
<li>Transaction logs and receipts</li>
<li>Customer communications</li>
<li>Shipping/delivery confirmations</li>
</ul>

<h3>3. Response Templates</h3>
<p>Develop reason-code-specific templates:</p>
<ul>
<li>Product not received templates</li>
<li>Unauthorized transaction responses</li>
<li>Product quality dispute responses</li>
</ul>

<h3>4. Team Training</h3>
<p>Ensure your team understands:</p>
<ul>
<li>Deadline criticality</li>
<li>Evidence requirements by reason code</li>
<li>Proper submission procedures</li>
</ul>

<blockquote>
<h3>The Cost of Missing Deadlines</h3>
<p>Missing a chargeback deadline results in automatic acceptance of the chargeback. For a $500 transaction, this costs: the transaction amount ($500), the chargeback fee ($25), and potential monitoring fees ($500+) — a total potential cost of over $1,025.</p>
</blockquote>`,
          keyTakeaways: [
            "Never rely on manual tracking alone",
            "Build in buffer time before actual deadlines",
            "Maintain organized evidence repositories",
            "Use automation tools to manage the process",
            "Train your team on deadline criticality",
            "Review and optimize your processes regularly"
          ],
          faq: [
            { q: "What happens if I miss a chargeback deadline?", a: "Missing a deadline results in automatic acceptance of the chargeback. You lose the transaction amount plus the chargeback fee, and it counts toward your chargeback ratio, which can trigger monitoring programs." },
            { q: "Do weekends count toward chargeback deadlines?", a: "Yes. All major card networks use calendar days, not business days. Weekends and holidays count toward the deadline." },
            { q: "Can I get an extension on a chargeback deadline?", a: "Generally, no. Card network deadlines are firm. In extremely rare circumstances your acquiring bank may be able to request an extension, but this should never be relied upon." }
          ],
          disclaimer: "This content is for informational purposes only and does not constitute legal or financial advice. Chargeback policies vary by card network, issuing bank, and region. Always consult your payment processor for the exact deadlines applicable to your disputes."
        }
      },
      "de-DE": {
        title: "Kompletter Leitfaden zu Chargeback-Antwortfristen",
        excerpt: "Das Einhalten von Chargeback-Fristen ist entscheidend, um Ihr Unternehmen vor Umsatzverlusten zu schützen.",
        body: {
          mainHtml: `
<p>Das Einhalten von Chargeback-Fristen ist absolut entscheidend, um Ihr Unternehmen vor Umsatzverlusten zu schützen. Eine versäumte Frist bedeutet automatische Akzeptanz des Chargebacks — verlorene Einnahmen und potenzielle Schäden an Ihrem Händlerstatus.</p>

<h2>Antwortfristen der Kartennetzwerke</h2>

<h3>Visa Claims Resolution (VCR)</h3>
<ul>
<li><strong>Erstreaktion</strong>: 30 Kalendertage ab Benachrichtigung</li>
<li><strong>Prä-Arbitration</strong>: 30 Kalendertage ab Entscheidung</li>
<li><strong>Arbitration-Einreichung</strong>: 10 Kalendertage ab Prä-Arbitration-Entscheidung</li>
</ul>
<p>Das Visa Claims Resolution Framework vereinfacht den Streitbeilegungsprozess, hält aber strenge Fristen ein. Das 30-Tage-Fenster für die Erstreaktion beginnt ab dem Moment der Benachrichtigung in Ihrem Zahlungsabwickler-System.</p>

<h3>Mastercard-Streitbeilegung</h3>
<ul>
<li><strong>Erste Chargeback-Antwort</strong>: 45 Kalendertage ab Benachrichtigung</li>
<li><strong>Zweiter Chargeback</strong>: 45 Kalendertage ab erster Entscheidung</li>
<li><strong>Arbitration</strong>: 45 Kalendertage ab zweiter Entscheidung</li>
</ul>
<p>Mastercard bietet etwas längere Fristen, hält aber die gleiche strenge Durchsetzung aufrecht.</p>

<h3>American Express</h3>
<ul>
<li><strong>Antwortfrist</strong>: 20 Kalendertage ab Anfrage</li>
<li><strong>Chargeback-Antwort</strong>: 20 Kalendertage ab Chargeback</li>
<li><strong>Einspruch</strong>: 20 Kalendertage ab Entscheidung</li>
</ul>
<p>American Express hat die strengsten Fristen der großen Kartennetzwerke. Das 20-Tage-Fenster erfordert schnelle Reaktion und effiziente Beweissammlung.</p>

<h3>Discover</h3>
<ul>
<li><strong>Antwortzeit</strong>: 20 Kalendertage ab Benachrichtigung</li>
<li><strong>Einspruch</strong>: 20 Kalendertage ab Entscheidung</li>
<li><strong>Arbitration</strong>: 20 Kalendertage ab Einspruchsentscheidung</li>
</ul>

<h2>Kritisches Fristenmanagement</h2>

<h3>Tag 0-3: Benachrichtigung und Bewertung</h3>
<ol>
<li><strong>Sofortige Prüfung</strong>: Bewerten Sie den Streitgrundcode innerhalb von 24 Stunden</li>
<li><strong>Beweissammlung</strong>: Beginnen Sie mit der Sammlung relevanter Dokumentation</li>
<li><strong>Antwortstrategie</strong>: Bestimmen Sie, ob Sie akzeptieren oder anfechten</li>
<li><strong>Teamzuweisung</strong>: Verantwortlichkeit für die Antwort zuweisen</li>
</ol>

<h3>Tag 4-20: Beweissammlung und -zusammenstellung</h3>
<ul>
<li>Transaktionsaufzeichnungen, Kundenkommunikation, Lieferbestätigungen sammeln</li>
<li>Unterstützende Dokumentation zusammenstellen (AGB, Rückgaberichtlinie usw.)</li>
<li>Beweise nach Grundcode-Anforderungen organisieren</li>
<li>Überzeugendes Narrativ zur Erklärung der Transaktion verfassen</li>
</ul>

<h3>Tag 21-25: Überprüfung und Qualitätskontrolle</h3>
<ul>
<li>Interne Überprüfung der zusammengestellten Beweise</li>
<li>Rechtliche Überprüfung falls zutreffend</li>
<li>Qualitätssicherungsprüfung</li>
<li>Endgültige Formatierung und Organisation</li>
</ul>

<h3>Tag 26-28: Einreichung und Bestätigung</h3>
<ul>
<li>Antwort über das Portal des Zahlungsabwicklers einreichen</li>
<li>Einreichungsbestätigung erhalten</li>
<li>Einreichungsdatum und -zeit dokumentieren</li>
<li>Vollständiges Antwortpaket archivieren</li>
</ul>

<blockquote>
<h3>Die Kosten versäumter Fristen</h3>
<p>Eine versäumte Frist führt zur automatischen Akzeptanz. Bei einer 500-€-Transaktion: Transaktionsbetrag (500 €), Chargeback-Gebühr (25 €), potenzielle Überwachungsgebühren (500 €+) — Gesamtkosten über 1.025 €.</p>
</blockquote>`,
          keyTakeaways: [
            "Verlassen Sie sich nie allein auf manuelle Nachverfolgung",
            "Bauen Sie Pufferzeit vor den tatsächlichen Fristen ein",
            "Pflegen Sie organisierte Beweisarchive",
            "Nutzen Sie Automatisierungstools zur Prozessverwaltung",
            "Schulen Sie Ihr Team zur Fristenkritikalität",
            "Überprüfen und optimieren Sie Ihre Prozesse regelmäßig"
          ],
          faq: [
            { q: "Was passiert, wenn ich eine Chargeback-Frist versäume?", a: "Eine versäumte Frist führt zur automatischen Akzeptanz des Chargebacks. Sie verlieren den Transaktionsbetrag plus die Gebühr, und es zählt zu Ihrer Quote." },
            { q: "Zählen Wochenenden zu Chargeback-Fristen?", a: "Ja. Alle großen Kartennetzwerke verwenden Kalendertage, nicht Geschäftstage." },
            { q: "Kann ich eine Fristverlängerung erhalten?", a: "In der Regel nein. Die Fristen der Kartennetzwerke sind verbindlich." }
          ],
          disclaimer: "Dieser Inhalt dient nur zu Informationszwecken und stellt keine Rechts- oder Finanzberatung dar."
        }
      },
      "fr-FR": {
        title: "Guide complet des délais de réponse aux rétrofacturations",
        excerpt: "Comprendre et respecter les délais de rétrofacturation est essentiel pour protéger votre entreprise contre les pertes de revenus.",
        body: {
          mainHtml: `
<p>Respecter les délais de rétrofacturation est absolument essentiel pour protéger votre entreprise. Manquer un délai signifie l'acceptation automatique de la rétrofacturation — des revenus perdus et des dommages potentiels à votre statut de commerçant.</p>

<h2>Délais de réponse par réseau de cartes</h2>

<h3>Visa Claims Resolution (VCR)</h3>
<ul>
<li><strong>Réponse initiale</strong> : 30 jours calendaires à partir de la notification</li>
<li><strong>Pré-arbitrage</strong> : 30 jours calendaires à partir de la décision</li>
<li><strong>Dépôt d'arbitrage</strong> : 10 jours calendaires à partir de la décision de pré-arbitrage</li>
</ul>
<p>Le cadre Visa Claims Resolution rationalise le processus de litige mais maintient des délais stricts. La fenêtre de 30 jours commence dès la notification dans votre système de processeur de paiement.</p>

<h3>Résolution des litiges Mastercard</h3>
<ul>
<li><strong>Première réponse</strong> : 45 jours calendaires à partir de la notification</li>
<li><strong>Deuxième rétrofacturation</strong> : 45 jours calendaires à partir de la première décision</li>
<li><strong>Arbitrage</strong> : 45 jours calendaires à partir de la deuxième décision</li>
</ul>
<p>Mastercard offre des délais légèrement plus longs mais maintient la même rigueur d'application.</p>

<h3>American Express</h3>
<ul>
<li><strong>Délai de réponse</strong> : 20 jours calendaires à partir de la demande</li>
<li><strong>Réponse à la rétrofacturation</strong> : 20 jours calendaires</li>
<li><strong>Appel</strong> : 20 jours calendaires à partir de la décision</li>
</ul>
<p>American Express maintient les délais les plus stricts. Leurs fenêtres de 20 jours exigent une réponse rapide.</p>

<h3>Discover</h3>
<ul>
<li><strong>Temps de réponse</strong> : 20 jours calendaires à partir de la notification</li>
<li><strong>Appel</strong> : 20 jours calendaires à partir de la décision</li>
<li><strong>Arbitrage</strong> : 20 jours calendaires à partir de la décision d'appel</li>
</ul>

<h2>Gestion critique des délais</h2>

<h3>Jour 0-3 : Notification et évaluation</h3>
<ol>
<li><strong>Examen immédiat</strong> : Évaluer le code de motif dans les 24 heures</li>
<li><strong>Collecte de preuves</strong> : Commencer à rassembler la documentation</li>
<li><strong>Stratégie de réponse</strong> : Décider de contester ou d'accepter</li>
<li><strong>Attribution d'équipe</strong> : Assigner la responsabilité</li>
</ol>

<h3>Jour 4-20 : Collecte et compilation des preuves</h3>
<ul>
<li>Rassembler les enregistrements de transactions, communications clients, confirmations de livraison</li>
<li>Compiler la documentation de soutien (CGV, politique de remboursement, etc.)</li>
<li>Organiser les preuves selon les exigences du code de motif</li>
<li>Rédiger un récit convaincant expliquant la transaction</li>
</ul>

<h3>Jour 21-25 : Révision et contrôle qualité</h3>
<ul>
<li>Révision interne des preuves compilées</li>
<li>Révision juridique si applicable</li>
<li>Contrôle d'assurance qualité</li>
<li>Mise en forme et organisation finales</li>
</ul>

<h3>Jour 26-28 : Soumission et confirmation</h3>
<ul>
<li>Soumettre la réponse via le portail du processeur de paiement</li>
<li>Obtenir la confirmation de soumission</li>
<li>Documenter la date et l'heure de soumission</li>
<li>Archiver le dossier de réponse complet</li>
</ul>

<blockquote>
<h3>Le coût des délais manqués</h3>
<p>Manquer un délai entraîne l'acceptation automatique. Pour une transaction de 500 € : montant (500 €), frais de rétrofacturation (25 €), frais de surveillance potentiels (500 €+) — coût total de plus de 1 025 €.</p>
</blockquote>`,
          keyTakeaways: [
            "Ne vous fiez jamais au suivi manuel seul",
            "Prévoyez un temps tampon avant les délais réels",
            "Maintenez des archives de preuves organisées",
            "Utilisez des outils d'automatisation pour gérer le processus",
            "Formez votre équipe sur la criticité des délais",
            "Révisez et optimisez vos processus régulièrement"
          ],
          faq: [
            { q: "Que se passe-t-il si je manque un délai de rétrofacturation ?", a: "Un délai manqué entraîne l'acceptation automatique. Vous perdez le montant plus les frais, et cela compte dans votre ratio." },
            { q: "Les week-ends comptent-ils dans les délais ?", a: "Oui. Tous les grands réseaux de cartes utilisent des jours calendaires, pas des jours ouvrables." },
            { q: "Puis-je obtenir une prolongation ?", a: "Généralement non. Les délais des réseaux de cartes sont fermes." }
          ],
          disclaimer: "Ce contenu est fourni à titre informatif uniquement et ne constitue pas un conseil juridique ou financier."
        }
      },
      "es-ES": {
        title: "Guía completa de plazos de respuesta a contracargos",
        excerpt: "Comprender y cumplir los plazos de contracargos es fundamental para proteger su negocio contra pérdidas de ingresos.",
        body: {
          mainHtml: `
<p>Cumplir con los plazos de contracargos es absolutamente fundamental para proteger su negocio. Incumplir un plazo significa la aceptación automática del contracargo — pérdida de ingresos y daño potencial a su reputación como comerciante.</p>

<h2>Plazos de respuesta por red de tarjetas</h2>

<h3>Visa Claims Resolution (VCR)</h3>
<ul>
<li><strong>Respuesta inicial</strong>: 30 días naturales desde la notificación</li>
<li><strong>Pre-arbitraje</strong>: 30 días naturales desde la decisión</li>
<li><strong>Solicitud de arbitraje</strong>: 10 días naturales desde la decisión de pre-arbitraje</li>
</ul>
<p>El marco Visa Claims Resolution agiliza el proceso de disputas pero mantiene plazos estrictos. La ventana de 30 días comienza desde el momento de la notificación en su sistema de procesador de pagos.</p>

<h3>Resolución de disputas Mastercard</h3>
<ul>
<li><strong>Primera respuesta</strong>: 45 días naturales desde la notificación</li>
<li><strong>Segundo contracargo</strong>: 45 días naturales desde la primera decisión</li>
<li><strong>Arbitraje</strong>: 45 días naturales desde la segunda decisión</li>
</ul>
<p>Mastercard ofrece plazos ligeramente más largos pero mantiene la misma aplicación estricta.</p>

<h3>American Express</h3>
<ul>
<li><strong>Plazo de respuesta</strong>: 20 días naturales desde la consulta</li>
<li><strong>Respuesta al contracargo</strong>: 20 días naturales</li>
<li><strong>Apelación</strong>: 20 días naturales desde la decisión</li>
</ul>
<p>American Express mantiene los plazos más estrictos. Sus ventanas de 20 días exigen respuesta rápida.</p>

<h3>Discover</h3>
<ul>
<li><strong>Tiempo de respuesta</strong>: 20 días naturales desde la notificación</li>
<li><strong>Apelación</strong>: 20 días naturales desde la decisión</li>
<li><strong>Arbitraje</strong>: 20 días naturales desde la decisión de apelación</li>
</ul>

<h2>Gestión crítica de plazos</h2>

<h3>Día 0-3: Notificación y evaluación</h3>
<ol>
<li><strong>Revisión inmediata</strong>: Evaluar el código de motivo en 24 horas</li>
<li><strong>Recopilación de evidencia</strong>: Comenzar a reunir documentación</li>
<li><strong>Estrategia de respuesta</strong>: Decidir si contestar o aceptar</li>
<li><strong>Asignación de equipo</strong>: Asignar responsabilidad</li>
</ol>

<h3>Día 4-20: Recopilación y compilación de evidencia</h3>
<ul>
<li>Reunir registros de transacciones, comunicaciones con clientes, confirmaciones de entrega</li>
<li>Compilar documentación de soporte (términos de servicio, política de reembolso, etc.)</li>
<li>Organizar evidencia según requisitos del código de motivo</li>
<li>Redactar narrativa convincente explicando la transacción</li>
</ul>

<h3>Día 21-25: Revisión y control de calidad</h3>
<ul>
<li>Revisión interna de las evidencias compiladas</li>
<li>Revisión legal si corresponde</li>
<li>Control de aseguramiento de calidad</li>
<li>Formato y organización finales</li>
</ul>

<h3>Día 26-28: Envío y confirmación</h3>
<ul>
<li>Enviar respuesta a través del portal del procesador de pagos</li>
<li>Obtener confirmación de envío</li>
<li>Documentar fecha y hora de envío</li>
<li>Archivar paquete de respuesta completo</li>
</ul>

<blockquote>
<h3>El costo de incumplir los plazos</h3>
<p>Incumplir un plazo resulta en aceptación automática. Para una transacción de 500 $: monto (500 $), tarifa de contracargo (25 $), tarifas de monitoreo potenciales (500 $+) — costo total de más de 1.025 $.</p>
</blockquote>`,
          keyTakeaways: [
            "Nunca confíe solo en el seguimiento manual",
            "Incluya tiempo de margen antes de los plazos reales",
            "Mantenga repositorios de evidencia organizados",
            "Use herramientas de automatización para gestionar el proceso",
            "Capacite a su equipo sobre la criticidad de los plazos",
            "Revise y optimice sus procesos regularmente"
          ],
          faq: [
            { q: "¿Qué pasa si incumplo un plazo de contracargo?", a: "Incumplir un plazo resulta en aceptación automática. Pierde el monto más la tarifa, y cuenta para su ratio." },
            { q: "¿Los fines de semana cuentan en los plazos?", a: "Sí. Todas las redes principales usan días naturales, no días hábiles." },
            { q: "¿Puedo obtener una extensión?", a: "Generalmente no. Los plazos de las redes de tarjetas son firmes." }
          ],
          disclaimer: "Este contenido es solo para fines informativos y no constituye asesoramiento legal o financiero."
        }
      },
      "pt-BR": {
        title: "Guia completo de prazos de resposta a chargebacks",
        excerpt: "Compreender e cumprir os prazos de chargeback é fundamental para proteger o seu negócio contra perdas de receita.",
        body: {
          mainHtml: `
<p>Cumprir os prazos de chargeback é absolutamente fundamental para proteger o seu negócio. Perder um prazo significa aceitação automática do chargeback — receita perdida e danos potenciais ao seu status de comerciante.</p>

<h2>Prazos de resposta por rede de cartões</h2>

<h3>Visa Claims Resolution (VCR)</h3>
<ul>
<li><strong>Resposta inicial</strong>: 30 dias corridos a partir da notificação</li>
<li><strong>Pré-arbitragem</strong>: 30 dias corridos a partir da decisão</li>
<li><strong>Pedido de arbitragem</strong>: 10 dias corridos a partir da decisão de pré-arbitragem</li>
</ul>
<p>O framework Visa Claims Resolution simplifica o processo de disputa mas mantém prazos rigorosos. A janela de 30 dias começa a partir do momento da notificação no sistema do seu processador de pagamentos.</p>

<h3>Resolução de disputas Mastercard</h3>
<ul>
<li><strong>Primeira resposta</strong>: 45 dias corridos a partir da notificação</li>
<li><strong>Segundo chargeback</strong>: 45 dias corridos a partir da primeira decisão</li>
<li><strong>Arbitragem</strong>: 45 dias corridos a partir da segunda decisão</li>
</ul>
<p>A Mastercard oferece prazos ligeiramente mais longos mas mantém a mesma aplicação rigorosa.</p>

<h3>American Express</h3>
<ul>
<li><strong>Prazo de resposta</strong>: 20 dias corridos a partir da consulta</li>
<li><strong>Resposta ao chargeback</strong>: 20 dias corridos</li>
<li><strong>Recurso</strong>: 20 dias corridos a partir da decisão</li>
</ul>
<p>A American Express mantém os prazos mais rigorosos. As suas janelas de 20 dias exigem resposta rápida.</p>

<h3>Discover</h3>
<ul>
<li><strong>Tempo de resposta</strong>: 20 dias corridos a partir da notificação</li>
<li><strong>Recurso</strong>: 20 dias corridos a partir da decisão</li>
<li><strong>Arbitragem</strong>: 20 dias corridos a partir da decisão do recurso</li>
</ul>

<h2>Gestão crítica de prazos</h2>

<h3>Dia 0-3: Notificação e avaliação</h3>
<ol>
<li><strong>Revisão imediata</strong>: Avaliar o código de motivo em 24 horas</li>
<li><strong>Recolha de provas</strong>: Começar a reunir documentação</li>
<li><strong>Estratégia de resposta</strong>: Decidir se contesta ou aceita</li>
<li><strong>Atribuição de equipa</strong>: Atribuir responsabilidade</li>
</ol>

<h3>Dia 4-20: Recolha e compilação de provas</h3>
<ul>
<li>Reunir registos de transações, comunicações com clientes, confirmações de entrega</li>
<li>Compilar documentação de suporte (termos de serviço, política de reembolso, etc.)</li>
<li>Organizar provas conforme requisitos do código de motivo</li>
<li>Redigir narrativa convincente explicando a transação</li>
</ul>

<h3>Dia 21-25: Revisão e controlo de qualidade</h3>
<ul>
<li>Revisão interna das provas compiladas</li>
<li>Revisão jurídica se aplicável</li>
<li>Verificação de garantia de qualidade</li>
<li>Formatação e organização finais</li>
</ul>

<h3>Dia 26-28: Submissão e confirmação</h3>
<ul>
<li>Submeter resposta pelo portal do processador de pagamentos</li>
<li>Obter confirmação de submissão</li>
<li>Documentar data e hora de submissão</li>
<li>Arquivar pacote de resposta completo</li>
</ul>

<blockquote>
<h3>O custo de perder prazos</h3>
<p>Perder um prazo resulta em aceitação automática. Para uma transação de 500 €: montante (500 €), taxa de chargeback (25 €), taxas de monitorização potenciais (500 €+) — custo total de mais de 1.025 €.</p>
</blockquote>`,
          keyTakeaways: [
            "Nunca confie apenas no rastreamento manual",
            "Inclua tempo de margem antes dos prazos reais",
            "Mantenha repositórios de provas organizados",
            "Use ferramentas de automação para gerir o processo",
            "Forme a sua equipa sobre a criticidade dos prazos",
            "Reveja e otimize os seus processos regularmente"
          ],
          faq: [
            { q: "O que acontece se eu perder um prazo de chargeback?", a: "Perder um prazo resulta em aceitação automática. Perde o montante mais a taxa, e conta para o seu rácio." },
            { q: "Os fins de semana contam nos prazos?", a: "Sim. Todas as grandes redes de cartões usam dias corridos, não dias úteis." },
            { q: "Posso obter uma extensão?", a: "Geralmente não. Os prazos das redes de cartões são firmes." }
          ],
          disclaimer: "Este conteúdo é apenas para fins informativos e não constitui aconselhamento jurídico ou financeiro."
        }
      },
      "sv-SE": {
        title: "Komplett guide till svarstider för chargebacks",
        excerpt: "Att förstå och hålla chargeback-deadlines är avgörande för att skydda ditt företag mot intäktsförluster.",
        body: {
          mainHtml: `
<p>Att hålla chargeback-deadlines är absolut avgörande för att skydda ditt företag mot intäktsförluster. Att missa en deadline innebär automatisk acceptans av chargebacken — förlorade intäkter och potentiell skada på din handlarstatus.</p>

<h2>Svarstider per kortnätverk</h2>

<h3>Visa Claims Resolution (VCR)</h3>
<ul>
<li><strong>Första svar</strong>: 30 kalenderdagar från notifiering</li>
<li><strong>Förskiljearbitration</strong>: 30 kalenderdagar från beslut</li>
<li><strong>Arbitration-ansökan</strong>: 10 kalenderdagar från förskiljearbitrationsbeslut</li>
</ul>
<p>Visa Claims Resolution-ramverket effektiviserar tvistprocessen men upprätthåller strikta deadlines. 30-dagarsfönstret börjar från det ögonblick du får meddelande i din betalprocessors system.</p>

<h3>Mastercard tvistlösning</h3>
<ul>
<li><strong>Första chargeback-svar</strong>: 45 kalenderdagar från notifiering</li>
<li><strong>Andra chargeback</strong>: 45 kalenderdagar från första beslutet</li>
<li><strong>Arbitration</strong>: 45 kalenderdagar från andra beslutet</li>
</ul>
<p>Mastercard erbjuder något längre tidsramar men upprätthåller samma strikta tillämpning.</p>

<h3>American Express</h3>
<ul>
<li><strong>Svarsfrist</strong>: 20 kalenderdagar från förfrågan</li>
<li><strong>Chargeback-svar</strong>: 20 kalenderdagar</li>
<li><strong>Överklagande</strong>: 20 kalenderdagar från beslut</li>
</ul>
<p>American Express har de striktaste tidsfristerna. Deras 20-dagarsfönster kräver snabb respons.</p>

<h3>Discover</h3>
<ul>
<li><strong>Svarstid</strong>: 20 kalenderdagar från notifiering</li>
<li><strong>Överklagande</strong>: 20 kalenderdagar från beslut</li>
<li><strong>Arbitration</strong>: 20 kalenderdagar från överklagandebeslut</li>
</ul>

<h2>Kritisk deadline-hantering</h2>

<h3>Dag 0-3: Notifiering och bedömning</h3>
<ol>
<li><strong>Omedelbar granskning</strong>: Bedöm tvistens orsakskod inom 24 timmar</li>
<li><strong>Bevisinsamling</strong>: Börja samla relevant dokumentation</li>
<li><strong>Svarsstrategi</strong>: Avgör om du ska bestrida eller acceptera</li>
<li><strong>Teamtilldelning</strong>: Tilldela ansvar för svaret</li>
</ol>

<h3>Dag 4-20: Bevisinsamling och sammanställning</h3>
<ul>
<li>Samla transaktionsregister, kundkommunikation, leveransbekräftelser</li>
<li>Sammanställ stöddokumentation (villkor, returpolicy etc.)</li>
<li>Organisera bevis efter orsakskodskrav</li>
<li>Skriv övertygande berättelse som förklarar transaktionen</li>
</ul>

<h3>Dag 21-25: Granskning och kvalitetskontroll</h3>
<ul>
<li>Intern granskning av sammanställda bevis</li>
<li>Juridisk granskning om tillämpligt</li>
<li>Kvalitetssäkringskontroll</li>
<li>Slutlig formatering och organisation</li>
</ul>

<h3>Dag 26-28: Inlämning och bekräftelse</h3>
<ul>
<li>Lämna in svar via betalprocessorns portal</li>
<li>Erhåll inlämningsbekräftelse</li>
<li>Dokumentera inlämningsdatum och -tid</li>
<li>Arkivera komplett svarspaket</li>
</ul>

<blockquote>
<h3>Kostnaden för missade deadlines</h3>
<p>Att missa en deadline resulterar i automatisk acceptans. För en transaktion på 5 000 kr: transaktionsbelopp (5 000 kr), chargeback-avgift (250 kr), potentiella övervakningsavgifter (5 000 kr+) — total potentiell kostnad över 10 250 kr.</p>
</blockquote>`,
          keyTakeaways: [
            "Förlita dig aldrig enbart på manuell spårning",
            "Bygg in bufferttid före faktiska deadlines",
            "Upprätthåll organiserade bevisarkiv",
            "Använd automatiseringsverktyg för att hantera processen",
            "Utbilda ditt team om deadline-kritikalitet",
            "Granska och optimera dina processer regelbundet"
          ],
          faq: [
            { q: "Vad händer om jag missar en chargeback-deadline?", a: "En missad deadline resulterar i automatisk acceptans. Du förlorar beloppet plus avgiften, och det räknas mot din kvot." },
            { q: "Räknas helger in i chargeback-deadlines?", a: "Ja. Alla stora kortnätverk använder kalenderdagar, inte arbetsdagar." },
            { q: "Kan jag få förlängning?", a: "Generellt nej. Kortnätverkens deadlines är fasta." }
          ],
          disclaimer: "Detta innehåll är endast för informationsändamål och utgör inte juridisk eller finansiell rådgivning."
        }
      }
    }
  },
];

// ---------------------------------------------------------------------------
// SEED LOGIC (unchanged structure, updated to use ARTICLES content)
// ---------------------------------------------------------------------------

function excerptFor(title) {
  return `${title.slice(0, 140)}…`;
}

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

/**
 * Idempotent: updates existing hub row that used the legacy case-study slug or the new slug,
 * so production DBs get the new article without `--force` full reseed.
 */
async function syncTopChargebackManagementToolsArticle(author, cta, tagIds) {
  const entry = TOP_CHARGEBACK_ARTICLE;
  const { data: locRows, error: locErr } = await sb
    .from("content_localizations")
    .select("content_item_id")
    .eq("route_kind", "resources")
    .in("slug", [TOP_CHARGEBACK_SLUG, TOP_CHARGEBACK_LEGACY_SLUG])
    .limit(1);
  if (locErr) throw locErr;

  let itemId = locRows?.[0]?.content_item_id;

  const insertLocalizations = async (item) => {
    for (const locale of LOCALES) {
      const localeContent = entry.content[locale];
      if (!localeContent) continue;
      const metaTitle =
        localeContent.metaTitle ?? `${localeContent.title} | DisputeDesk`;
      const metaDesc = (localeContent.metaDescription ?? localeContent.excerpt).slice(0, 160);
      const ogTitle = localeContent.ogTitle ?? localeContent.metaTitle ?? localeContent.title;
      const ogDesc = (
        localeContent.ogDescription ??
        localeContent.metaDescription ??
        localeContent.excerpt
      ).slice(0, 200);
      await sb.from("content_localizations").upsert(
        {
          content_item_id: item.id,
          locale,
          route_kind: "resources",
          title: localeContent.title,
          slug: entry.slug,
          excerpt: localeContent.excerpt,
          body_json: localeContent.body,
          meta_title: metaTitle,
          meta_description: metaDesc,
          og_title: ogTitle,
          og_description: ogDesc,
          reading_time_minutes: entry.readingTime || 8,
          is_published: true,
          translation_status: "complete",
          last_updated_at: new Date().toISOString(),
        },
        { onConflict: "content_item_id,locale" }
      );
    }
  };

  if (itemId) {
    const { error: upErr } = await sb
      .from("content_items")
      .update({
        content_type: entry.type,
        primary_pillar: entry.pillar,
        workflow_status: "published",
        author_id: author?.id,
        primary_cta_id: cta?.id,
        published_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    if (upErr) throw upErr;

    await sb.from("content_item_tags").delete().eq("content_item_id", itemId);
    for (const tagKey of entry.tags || []) {
      if (tagIds[tagKey]) {
        await sb.from("content_item_tags").insert({ content_item_id: itemId, tag_id: tagIds[tagKey] });
      }
    }

    const { data: itemRow, error: itemErr } = await sb
      .from("content_items")
      .select("id")
      .eq("id", itemId)
      .single();
    if (itemErr) throw itemErr;
    await insertLocalizations(itemRow);
    console.log(`  ✓ synced ${TOP_CHARGEBACK_SLUG} (upsert existing item)`);
    return;
  }

  const { data: newItem, error: ie } = await sb
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
  for (const tagKey of entry.tags || []) {
    if (tagIds[tagKey]) {
      await sb.from("content_item_tags").insert({ content_item_id: newItem.id, tag_id: tagIds[tagKey] });
    }
  }
  await insertLocalizations(newItem);
  console.log(`  ✓ synced ${TOP_CHARGEBACK_SLUG} (insert new item)`);
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
    .eq("slug", ARTICLES[0].slug)
    .eq("locale", "en-US");

  if (!force && existingArticles && existingArticles > 0) {
    console.log("Seed skipped: launch content already present (first slug exists). Use --force to replace.");
  } else {
    for (const entry of ARTICLES) {
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

      for (const tagKey of (entry.tags || [])) {
        if (tagIds[tagKey]) {
          await sb.from("content_item_tags").insert({ content_item_id: item.id, tag_id: tagIds[tagKey] });
        }
      }

      for (const locale of LOCALES) {
        const localeContent = entry.content[locale];
        if (!localeContent) continue;

        const metaTitle =
          localeContent.metaTitle ?? `${localeContent.title} | DisputeDesk`;
        const metaDesc = (localeContent.metaDescription ?? localeContent.excerpt).slice(0, 160);
        const ogTitle = localeContent.ogTitle ?? localeContent.metaTitle ?? localeContent.title;
        const ogDesc = (
          localeContent.ogDescription ??
          localeContent.metaDescription ??
          localeContent.excerpt
        ).slice(0, 200);

        await sb.from("content_localizations").insert({
          content_item_id: item.id,
          locale,
          route_kind: "resources",
          title: localeContent.title,
          slug: entry.slug,
          excerpt: localeContent.excerpt,
          body_json: localeContent.body,
          meta_title: metaTitle,
          meta_description: metaDesc,
          og_title: ogTitle,
          og_description: ogDesc,
          reading_time_minutes: entry.readingTime || 8,
          is_published: true,
          translation_status: "complete",
          last_updated_at: new Date().toISOString(),
        });
      }
      console.log(`  ✓ ${entry.slug}`);
    }
  }

  await syncTopChargebackManagementToolsArticle(author, cta, tagIds);

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
      const kw = `${pillar} dispute`;
      const pillarLabel = pillar.replace(/-/g, " ");
      const proposedTitle = `${pillarLabel.replace(/\b\w/g, (c) => c.toUpperCase())} cluster: ${kw.replace(/\b\w/g, (c) => c.toUpperCase())}`;
      const summary = `Informational cluster article on “${kw}” for the ${pillarLabel} pillar. Aim: merchant-facing explanation, practical framing, and alignment with the resources hub—not generic filler. Priority tier ${i < 30 ? "high" : i < 60 ? "medium" : "standard"} in this seed batch.`;
      await sb.from("content_archive_items").insert({
        proposed_title: proposedTitle,
        proposed_slug: `archive-${i + 1}`,
        target_locale_set: LOCALES,
        content_type: "cluster_article",
        primary_pillar: pillar,
        priority_score: p,
        target_keyword: kw,
        search_intent: "informational",
        summary,
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
