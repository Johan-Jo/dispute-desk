// One-shot: shorten the 3-DS auth label and inject + translate kpi*Info
// tooltips across every locale file under messages/. Idempotent.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";

// New short labels for "3-D Secure authentication" — keep the
// industry-standard "3-DS" prefix uniform across languages.
const SHORT_3DS_LABEL = {
  en: "3-DS auth",
  "en-US": "3-DS auth",
  de: "3-DS-Auth.",
  "de-DE": "3-DS-Auth.",
  es: "Auten. 3-DS",
  "es-ES": "Auten. 3-DS",
  fr: "Auth. 3-DS",
  "fr-FR": "Auth. 3-DS",
  pt: "Auten. 3-DS",
  "pt-BR": "Auten. 3-DS",
  sv: "3-DS-aut.",
  "sv-SE": "3-DS-aut.",
};

// Tooltip / info text for each KPI tile, per locale. Kept to 1–2 short
// sentences; the goal is "I can recognize what this metric is" not
// "comprehensive method documentation."
const INFO = {
  en: {
    kpiAcceptanceRateInfo:
      "Share of analyzed orders Shopify accepted at checkout — meaning the fraud analysis did not block them. Excludes orders still pending fraud analysis.",
    kpiHighRiskRateInfo:
      "Share of orders Shopify classified as HIGH risk during fraud analysis. A higher number signals more exposure to chargebacks.",
    kpiFraudDisputeRateInfo:
      "Share of orders that became a Shopify Payments fraud dispute (reason = FRAUDULENT) in this window.",
    kpi3dsAuthInfo:
      "Share of Shopify Payments card orders where 3-D Secure authentication completed successfully. Authenticated payments shift liability to the issuer for fraud chargebacks.",
    kpiProtectCoverageInfo:
      "Of orders Shopify Protect was eligible to underwrite, the share marked PROTECTED. Protected orders do not reach you as chargebacks.",
    kpiMedianFulfillmentInfo:
      "Median time between order placement and fulfillment, across orders fulfilled in this window. Faster fulfillment generally improves customer-service signals.",
    kpiHighRiskFulfilledInfo:
      "Of orders Shopify classified HIGH risk, the share that still reached a fulfilled state. A high number means you are absorbing the fraud risk Shopify flagged.",
    kpiConfirmedDeliveryInfo:
      "Of fulfilled orders, the share where the carrier returned a delivered status. Carrier-attested delivery is strong dispute evidence.",
    kpiSignedForInfo:
      "Of confirmed deliveries, the share where the carrier recorded a signature. Signature confirmation is the strongest delivery evidence for fraud chargebacks.",
  },
  de: {
    kpiAcceptanceRateInfo:
      "Anteil der analysierten Bestellungen, die Shopify beim Checkout akzeptiert hat — die Betrugsanalyse hat sie also nicht blockiert. Bestellungen mit ausstehender Analyse sind ausgenommen.",
    kpiHighRiskRateInfo:
      "Anteil der Bestellungen, die Shopify in der Betrugsanalyse als HOHES Risiko eingestuft hat. Ein höherer Wert bedeutet mehr Exposition gegenüber Rückbuchungen.",
    kpiFraudDisputeRateInfo:
      "Anteil der Bestellungen, aus denen in diesem Zeitraum eine Shopify-Payments-Betrugsanfechtung (Grund = FRAUDULENT) wurde.",
    kpi3dsAuthInfo:
      "Anteil der Shopify-Payments-Kartenzahlungen, bei denen die 3-D-Secure-Authentifizierung erfolgreich abgeschlossen wurde. Authentifizierte Zahlungen verlagern die Haftung für Betrugsrückbuchungen auf den Aussteller.",
    kpiProtectCoverageInfo:
      "Anteil der durch Shopify Protect förderfähigen Bestellungen, die als PROTECTED gekennzeichnet sind. Geschützte Bestellungen erreichen dich nicht als Rückbuchungen.",
    kpiMedianFulfillmentInfo:
      "Mittlere Zeit zwischen Bestelleingang und Fulfillment für die in diesem Zeitraum abgewickelten Bestellungen. Schnelleres Fulfillment verbessert in der Regel die Service-Signale.",
    kpiHighRiskFulfilledInfo:
      "Anteil der von Shopify als HOHES Risiko eingestuften Bestellungen, die dennoch ausgeliefert wurden. Ein hoher Wert bedeutet, dass du das von Shopify markierte Betrugsrisiko übernimmst.",
    kpiConfirmedDeliveryInfo:
      "Anteil der ausgelieferten Bestellungen, bei denen der Spediteur einen Zustellstatus zurückgemeldet hat. Vom Spediteur bestätigte Zustellungen sind starke Beweise im Streitfall.",
    kpiSignedForInfo:
      "Anteil der bestätigten Zustellungen, bei denen der Spediteur eine Unterschrift erfasst hat. Die Empfangsbestätigung ist der stärkste Zustellbeweis bei Betrugsrückbuchungen.",
  },
  es: {
    kpiAcceptanceRateInfo:
      "Porcentaje de pedidos analizados que Shopify aceptó al pagar — es decir, que el análisis de fraude no bloqueó. Se excluyen pedidos con análisis pendiente.",
    kpiHighRiskRateInfo:
      "Porcentaje de pedidos que Shopify clasificó como riesgo ALTO durante el análisis de fraude. Cuanto más alto, mayor exposición a contracargos.",
    kpiFraudDisputeRateInfo:
      "Porcentaje de pedidos que se convirtieron en una disputa por fraude de Shopify Payments (motivo = FRAUDULENT) en este período.",
    kpi3dsAuthInfo:
      "Porcentaje de pedidos con tarjeta de Shopify Payments donde la autenticación 3-D Secure se completó correctamente. Los pagos autenticados trasladan la responsabilidad por fraude al emisor.",
    kpiProtectCoverageInfo:
      "De los pedidos elegibles para Shopify Protect, el porcentaje marcado como PROTECTED. Los pedidos protegidos no llegan como contracargos.",
    kpiMedianFulfillmentInfo:
      "Tiempo mediano entre la realización del pedido y el cumplimiento, en los pedidos completados en este período. Un cumplimiento más rápido mejora las señales de servicio al cliente.",
    kpiHighRiskFulfilledInfo:
      "De los pedidos clasificados por Shopify como riesgo ALTO, el porcentaje que aun así se cumplió. Un valor alto indica que estás asumiendo el riesgo de fraude que Shopify marcó.",
    kpiConfirmedDeliveryInfo:
      "De los pedidos cumplidos, el porcentaje en los que el transportista devolvió un estado de entregado. La entrega confirmada por el transportista es una prueba sólida en disputas.",
    kpiSignedForInfo:
      "De las entregas confirmadas, el porcentaje en las que el transportista registró una firma. La firma de recepción es la prueba de entrega más fuerte para contracargos por fraude.",
  },
  fr: {
    kpiAcceptanceRateInfo:
      "Part des commandes analysées que Shopify a acceptées au paiement — c'est-à-dire que l'analyse de fraude ne les a pas bloquées. Les commandes en attente d'analyse sont exclues.",
    kpiHighRiskRateInfo:
      "Part des commandes classées en risque ÉLEVÉ par l'analyse de fraude de Shopify. Plus le chiffre est haut, plus l'exposition aux contestations augmente.",
    kpiFraudDisputeRateInfo:
      "Part des commandes devenues une contestation pour fraude Shopify Payments (motif = FRAUDULENT) sur cette période.",
    kpi3dsAuthInfo:
      "Part des paiements par carte Shopify Payments où l'authentification 3-D Secure a abouti. Les paiements authentifiés transfèrent la responsabilité des contestations pour fraude à l'émetteur.",
    kpiProtectCoverageInfo:
      "Sur les commandes éligibles à Shopify Protect, la part marquée PROTECTED. Les commandes protégées ne vous parviennent pas sous forme de contestations.",
    kpiMedianFulfillmentInfo:
      "Délai médian entre la passation de la commande et l'expédition, pour les commandes traitées sur cette période. Un traitement plus rapide améliore généralement les signaux service client.",
    kpiHighRiskFulfilledInfo:
      "Sur les commandes classées risque ÉLEVÉ par Shopify, la part qui a tout de même été expédiée. Un chiffre élevé indique que vous absorbez le risque de fraude signalé par Shopify.",
    kpiConfirmedDeliveryInfo:
      "Sur les commandes expédiées, la part dont le transporteur a confirmé la livraison. Une livraison attestée par le transporteur est une preuve solide en contestation.",
    kpiSignedForInfo:
      "Sur les livraisons confirmées, la part dont le transporteur a enregistré une signature. La signature à la réception est la preuve de livraison la plus forte pour les contestations de fraude.",
  },
  pt: {
    kpiAcceptanceRateInfo:
      "Percentual de pedidos analisados que a Shopify aceitou no checkout — ou seja, que a análise de fraude não bloqueou. Pedidos com análise pendente são excluídos.",
    kpiHighRiskRateInfo:
      "Percentual de pedidos que a Shopify classificou como risco ALTO na análise de fraude. Quanto maior, maior a exposição a estornos.",
    kpiFraudDisputeRateInfo:
      "Percentual de pedidos que viraram uma disputa por fraude do Shopify Payments (motivo = FRAUDULENT) neste período.",
    kpi3dsAuthInfo:
      "Percentual de pedidos com cartão no Shopify Payments em que a autenticação 3-D Secure foi concluída com êxito. Pagamentos autenticados transferem a responsabilidade por fraude para o emissor.",
    kpiProtectCoverageInfo:
      "Dos pedidos elegíveis ao Shopify Protect, o percentual marcado como PROTECTED. Pedidos protegidos não chegam até você como estornos.",
    kpiMedianFulfillmentInfo:
      "Tempo mediano entre a realização do pedido e o atendimento, para os pedidos atendidos neste período. Um atendimento mais rápido melhora os sinais de serviço ao cliente.",
    kpiHighRiskFulfilledInfo:
      "Dos pedidos classificados pela Shopify como risco ALTO, o percentual que mesmo assim foi atendido. Um valor alto indica que você está absorvendo o risco de fraude sinalizado.",
    kpiConfirmedDeliveryInfo:
      "Dos pedidos atendidos, o percentual em que a transportadora retornou um status de entregue. A entrega confirmada pela transportadora é uma evidência forte em disputa.",
    kpiSignedForInfo:
      "Das entregas confirmadas, o percentual em que a transportadora registrou uma assinatura. A confirmação por assinatura é a evidência de entrega mais forte para estornos por fraude.",
  },
  sv: {
    kpiAcceptanceRateInfo:
      "Andelen analyserade order som Shopify accepterade vid kassan — det vill säga som bedrägeriskanningen inte blockerade. Order med pågående analys räknas inte.",
    kpiHighRiskRateInfo:
      "Andelen order som Shopify klassade som HÖG risk i bedrägerianalysen. Ett högre värde innebär ökad exponering för återkrediteringar.",
    kpiFraudDisputeRateInfo:
      "Andelen order som blev en bedrägeritvist från Shopify Payments (orsak = FRAUDULENT) under perioden.",
    kpi3dsAuthInfo:
      "Andelen kortköp via Shopify Payments där 3-D Secure-autentiseringen slutfördes. Autentiserade betalningar flyttar ansvaret för bedrägeritvister till utgivaren.",
    kpiProtectCoverageInfo:
      "Av de order som Shopify Protect kunde teckna, andelen som markerats PROTECTED. Skyddade order når dig inte som återkrediteringar.",
    kpiMedianFulfillmentInfo:
      "Mediantid mellan lagd order och utskick, för order som hanterats under perioden. Snabbare hantering förbättrar generellt kundsignalerna.",
    kpiHighRiskFulfilledInfo:
      "Av order som Shopify klassat som HÖG risk, andelen som ändå skickades. Ett högt värde innebär att du bär den bedrägeririsk som Shopify flaggade.",
    kpiConfirmedDeliveryInfo:
      "Av skickade order, andelen där transportören rapporterat levererad status. Bekräftad leverans av transportören är stark bevisning i tvist.",
    kpiSignedForInfo:
      "Av bekräftade leveranser, andelen där transportören registrerat en signatur. Signaturbekräftelse är det starkaste leveransbeviset vid bedrägeritvister.",
  },
};

// Region-specific copies (en-US copies en, de-DE copies de, etc.)
INFO["en-US"] = INFO.en;
INFO["de-DE"] = INFO.de;
INFO["es-ES"] = INFO.es;
INFO["fr-FR"] = INFO.fr;
INFO["pt-BR"] = INFO.pt;
INFO["sv-SE"] = INFO.sv;

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
let touched = 0;
for (const f of files) {
  const locale = f.replace(".json", "");
  const p = join(DIR, f);
  const m = JSON.parse(readFileSync(p, "utf8"));
  if (!m.fraudIntel) continue;

  const shortLabel = SHORT_3DS_LABEL[locale];
  const tooltips = INFO[locale];
  if (!shortLabel || !tooltips) {
    console.warn(`No copy for locale ${locale}; skipping`);
    continue;
  }

  m.fraudIntel.kpi3dsAuth = shortLabel;
  for (const [k, v] of Object.entries(tooltips)) {
    m.fraudIntel[k] = v;
  }

  writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  touched++;
  console.log(`Updated ${f}`);
}
console.log(`\nDone — ${touched} files updated.`);
