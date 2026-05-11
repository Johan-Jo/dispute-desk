// One-shot: translates the fraudIntel namespace (+ the dashboard.
// recentActivity rename) into the 5 non-English locale languages
// supported by DisputeDesk. Regional variants mirror their base
// locale (de == de-DE, etc.) — same convention used by the existing
// translation surface elsewhere in the codebase.
//
// Run once after adding new fraudIntel keys. Idempotent — overwrites
// the listed keys with the translations below regardless of their
// current locale value.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";

// language code → list of locale-file basenames it should populate
const LOCALE_FILES = {
  de: ["de.json", "de-DE.json"],
  es: ["es.json", "es-ES.json"],
  fr: ["fr.json", "fr-FR.json"],
  pt: ["pt.json", "pt-BR.json"],
  sv: ["sv.json", "sv-SE.json"],
  // English locales are written elsewhere (inject-fraud-intel-i18n.mjs)
};

// Helper: build a structured translation map. Each key holds the
// translated value for each language code. Placeholders like
// {count}, {high}, {fulfilled}, {ratio}, {status}, {num}, {den},
// {total}, {window} are preserved literally.
const T = {
  fraudIntel: {
    title: {
      de: "Übersicht Betrugsrisiko",
      es: "Resumen de riesgo de fraude",
      fr: "Aperçu du risque de fraude",
      pt: "Visão geral do risco de fraude",
      sv: "Översikt över bedrägeririsk",
    },
    subtitle: {
      de: "Operativer Kontext aus Shopifys Betrugsanalyse — kein Werkzeug zur Betrugsprävention.",
      es: "Contexto operacional del análisis de fraude de Shopify — no es una herramienta de decisión para prevenir fraude.",
      fr: "Contexte opérationnel issu de l'analyse de fraude de Shopify — pas un outil de décision de prévention.",
      pt: "Contexto operacional da análise de fraude do Shopify — não é uma ferramenta de decisão para prevenir fraude.",
      sv: "Operativ kontext från Shopifys bedrägerianalys — inte ett beslutsverktyg för bedrägeriförebyggande.",
    },
    window30: { de: "Letzte 30 Tage", es: "Últimos 30 días", fr: "30 derniers jours", pt: "Últimos 30 dias", sv: "Senaste 30 dagarna" },
    window90: { de: "Letzte 90 Tage", es: "Últimos 90 días", fr: "90 derniers jours", pt: "Últimos 90 dias", sv: "Senaste 90 dagarna" },
    window365: { de: "Letzte 365 Tage", es: "Últimos 365 días", fr: "365 derniers jours", pt: "Últimos 365 dias", sv: "Senaste 365 dagarna" },
    windowAll: { de: "Gesamter Zeitraum", es: "Todo el tiempo", fr: "Toute la période", pt: "Todo o período", sv: "Hela perioden" },
    queuedTitle: {
      de: "Übersicht Betrugsrisiko wird vorbereitet",
      es: "Preparando tu resumen de riesgo de fraude",
      fr: "Préparation de votre aperçu du risque de fraude",
      pt: "Preparando sua visão geral de risco de fraude",
      sv: "Förbereder din översikt över bedrägeririsk",
    },
    queuedBody: {
      de: "Wir haben eine Analyse Ihres Bestellverlaufs in die Warteschlange gestellt. Dies beginnt normalerweise innerhalb weniger Minuten — aktualisieren Sie in Kürze, um den Fortschritt zu sehen.",
      es: "Hemos puesto en cola un análisis de tu historial de pedidos. Normalmente comienza en unos minutos — actualiza en un momento para ver el progreso.",
      fr: "Nous avons mis en file d'attente une analyse de votre historique de commandes. Cela démarre généralement en quelques minutes — actualisez d'ici peu pour voir la progression.",
      pt: "Colocamos uma análise do seu histórico de pedidos na fila. Geralmente começa em poucos minutos — atualize em breve para ver o progresso.",
      sv: "Vi har köat en analys av din orderhistorik. Detta startar oftast inom några minuter — uppdatera om en stund för att se framstegen.",
    },
    analyzingTitle: {
      de: "Ihr Bestellverlauf wird analysiert",
      es: "Analizando tu historial de pedidos",
      fr: "Analyse de votre historique de commandes en cours",
      pt: "Analisando seu histórico de pedidos",
      sv: "Analyserar din orderhistorik",
    },
    analyzingBody: {
      de: "Wir haben bisher {count} Bestellungen analysiert. Die Risikoübersicht wird verfügbar, sobald wir fertig sind.",
      es: "Hemos analizado {count} pedidos hasta ahora. El resumen de riesgo se desbloqueará en cuanto terminemos.",
      fr: "Nous avons analysé {count} commandes jusqu'à présent. L'aperçu du risque se déverrouille dès que nous avons terminé.",
      pt: "Analisamos {count} pedidos até agora. A visão geral do risco será desbloqueada assim que terminarmos.",
      sv: "Vi har analyserat {count} ordrar hittills. Riskanalysen låses upp så fort vi är klara.",
    },
    failedTitle: {
      de: "Bei der Analyse Ihrer Bestellungen ist ein Problem aufgetreten",
      es: "Hubo un problema al analizar tus pedidos",
      fr: "Un souci est survenu lors de l'analyse de vos commandes",
      pt: "Tivemos um problema ao analisar seus pedidos",
      sv: "Vi stötte på problem när vi analyserade dina ordrar",
    },
    failedBody: {
      de: "Unser Hintergrundprozess konnte nicht abgeschlossen werden. Wir versuchen es automatisch erneut — aktualisieren Sie in einigen Minuten.",
      es: "Nuestro trabajo en segundo plano no se completó. Reintentaremos automáticamente — actualiza en unos minutos.",
      fr: "Notre tâche en arrière-plan n'a pas abouti. Nous réessaierons automatiquement — actualisez dans quelques minutes.",
      pt: "Nossa tarefa em segundo plano não concluiu. Tentaremos novamente automaticamente — atualize em alguns minutos.",
      sv: "Vårt bakgrundsjobb slutfördes inte. Vi försöker igen automatiskt — uppdatera om några minuter.",
    },
    kpiAcceptanceRate: { de: "Akzeptanzrate", es: "Tasa de aceptación", fr: "Taux d'acceptation", pt: "Taxa de aceitação", sv: "Acceptansgrad" },
    tooltipAcceptanceRate: {
      de: "Anteil der analysierten Bestellungen, die Shopify freigegeben oder als geringes/mittleres Risiko eingestuft hat. Bestellungen, deren Betrugsanalyse noch aussteht, sind ausgeschlossen; Bestellungen, die Shopify als ohne Risikohinweise markiert hat, zählen als akzeptiert.",
      es: "Porcentaje de pedidos analizados que Shopify aprobó o calificó como riesgo bajo/medio. Los pedidos pendientes de análisis están excluidos; los pedidos sin indicadores de riesgo cuentan como aceptados.",
      fr: "Part des commandes analysées que Shopify a validées ou classées en risque faible/moyen. Les commandes dont l'analyse est en attente sont exclues ; celles sans indicateurs de risque sont comptées comme acceptées.",
      pt: "Porcentagem dos pedidos analisados que o Shopify aprovou ou classificou como risco baixo/médio. Pedidos pendentes de análise são excluídos; pedidos sem indicadores de risco contam como aceitos.",
      sv: "Andel analyserade ordrar som Shopify godkände eller klassificerade som låg/medel risk. Ordrar som väntar på bedrägerianalys exkluderas; ordrar utan riskindikatorer räknas som accepterade.",
    },
    kpiHighRiskRate: { de: "Hochrisiko-Bestellungen", es: "Pedidos de alto riesgo", fr: "Commandes à haut risque", pt: "Pedidos de alto risco", sv: "Högrisk-ordrar" },
    tooltipHighRiskRate: {
      de: "Anteil der Bestellungen, die Shopify in der Betrugsanalyse als HOCH-Risiko eingestuft hat.",
      es: "Porcentaje de pedidos que Shopify clasificó como ALTO riesgo durante el análisis de fraude.",
      fr: "Part des commandes classées par Shopify en risque ÉLEVÉ lors de l'analyse de fraude.",
      pt: "Porcentagem de pedidos que o Shopify classificou como ALTO risco durante a análise de fraude.",
      sv: "Andel ordrar som Shopify klassificerade som HÖG risk under bedrägerianalysen.",
    },
    kpiFraudDisputeRate: { de: "Betrugs-Chargeback-Rate", es: "Tasa de disputas por fraude", fr: "Taux de litiges pour fraude", pt: "Taxa de disputas por fraude", sv: "Frekvens bedrägeritvister" },
    tooltipFraudDisputeRate: {
      de: "Anteil der Bestellungen, die in diesem Zeitraum zu einem Shopify-Payments-Betrugs-Chargeback (Grund = FRAUDULENT) wurden.",
      es: "Porcentaje de pedidos que se convirtieron en una disputa por fraude de Shopify Payments (motivo = FRAUDULENT) en este período.",
      fr: "Part des commandes devenues un litige fraude Shopify Payments (raison = FRAUDULENT) sur cette période.",
      pt: "Porcentagem de pedidos que se tornaram uma disputa por fraude do Shopify Payments (motivo = FRAUDULENT) neste período.",
      sv: "Andel ordrar som blev en Shopify Payments-bedrägeritvist (orsak = FRAUDULENT) under denna period.",
    },
    kpiHighRiskFulfilled: { de: "Hochrisiko erfüllt", es: "Alto riesgo cumplidos", fr: "Haut risque expédiées", pt: "Alto risco atendidos", sv: "Högrisk uppfyllda" },
    tooltipHighRiskFulfilled: {
      de: "Von den als HOCH-Risiko eingestuften Bestellungen der Anteil, der trotzdem den Status erfüllt erreicht hat. Ein hoher Wert kann auf operative Exposition hindeuten.",
      es: "De los pedidos clasificados como ALTO riesgo, el porcentaje que aún así se cumplió. Un número alto puede indicar exposición operativa.",
      fr: "Parmi les commandes classées en risque ÉLEVÉ, la part qui a malgré tout été expédiée. Un chiffre élevé peut signaler une exposition opérationnelle.",
      pt: "Dos pedidos classificados como ALTO risco, a porcentagem que ainda assim foi atendida. Um número alto pode indicar exposição operacional.",
      sv: "Av ordrar klassade som HÖG risk, andelen som ändå nådde uppfyllt-status. En hög siffra kan signalera operativ exponering.",
    },
    kpiProtectCoverage: { de: "Shopify Protect-Abdeckung", es: "Cobertura de Shopify Protect", fr: "Couverture Shopify Protect", pt: "Cobertura do Shopify Protect", sv: "Shopify Protect-täckning" },
    tooltipProtectCoverage: {
      de: "Vom Bestellwert, für den Shopify Protect zur Übernahme berechtigt war, der Anteil, der als PROTECTED markiert wurde.",
      es: "Del valor de los pedidos elegibles para la cobertura de Shopify Protect, la parte marcada como PROTECTED.",
      fr: "Sur la valeur de commande éligible à la couverture Shopify Protect, la part marquée comme PROTECTED.",
      pt: "Do valor dos pedidos elegíveis para a cobertura do Shopify Protect, a parcela marcada como PROTECTED.",
      sv: "Av ordervärdet som Shopify Protect var berättigad att täcka, andelen som markerades som PROTECTED.",
    },
    kpiProtectSubtext: {
      de: "Geschützter Wert ÷ förderfähiger Wert",
      es: "Valor protegido ÷ valor elegible",
      fr: "Valeur protégée ÷ valeur éligible",
      pt: "Valor protegido ÷ valor elegível",
      sv: "Skyddat värde ÷ behörigt värde",
    },
    kpiOrdersAnalyzed: { de: "Analysierte Bestellungen", es: "Pedidos analizados", fr: "Commandes analysées", pt: "Pedidos analisados", sv: "Analyserade ordrar" },
    tooltipOrdersAnalyzed: {
      de: "Gesamtzahl der Shopify-Bestellungen in diesem Zeitraum. Das historische Backfill richtet sich nach dem für die App freigegebenen Umfang.",
      es: "Total de pedidos de Shopify cubiertos por este período. El backfill se ancla al alcance histórico otorgado a la aplicación.",
      fr: "Total des commandes Shopify couvertes par cette période. Le backfill historique s'aligne sur la portée accordée à l'application.",
      pt: "Total de pedidos do Shopify cobertos por este período. O backfill histórico se baseia no escopo concedido ao app.",
      sv: "Totalt antal Shopify-ordrar i denna period. Det historiska backfill-jobbet följer det historiska scope som beviljats appen.",
    },
    kpiOrdersSubtext: { de: "{window}", es: "{window}", fr: "{window}", pt: "{window}", sv: "{window}" },
    kpiSubtextFraction: { de: "{num} von {den}", es: "{num} de {den}", fr: "{num} sur {den}", pt: "{num} de {den}", sv: "{num} av {den}" },
    kpiSubtextOf: { de: "{num} von {total}", es: "{num} de {total}", fr: "{num} sur {total}", pt: "{num} de {total}", sv: "{num} av {total}" },
    kpiUnavailable: { de: "Nicht genug Daten", es: "Datos insuficientes", fr: "Données insuffisantes", pt: "Dados insuficientes", sv: "Otillräckliga data" },
    // Insight banner + initial-analysis page
    bannerHeadline: {
      de: "Wir haben {count} historische Shopify-Bestellungen analysiert.",
      es: "Hemos analizado {count} pedidos históricos de Shopify.",
      fr: "Nous avons analysé {count} commandes Shopify historiques.",
      pt: "Analisamos {count} pedidos históricos do Shopify.",
      sv: "Vi har analyserat {count} historiska Shopify-ordrar.",
    },
    bannerBody: {
      de: "{high}% der jüngsten Bestellungen wurden von Shopifys Betrugsanalyse als hochriskant eingestuft. {fulfilled}% der hochriskanten Shopify-Bestellungen wurden trotzdem erfüllt. Sie können das Betrugsrisiko, operative Muster und Streittrends jetzt direkt in DisputeDesk überwachen.",
      es: "{high}% de los pedidos recientes fueron clasificados como alto riesgo por el análisis de fraude de Shopify. El {fulfilled}% de los pedidos de alto riesgo de Shopify aún así se cumplieron. Ahora puedes monitorear la exposición al riesgo de fraude, los patrones operativos y las tendencias de disputas directamente desde DisputeDesk.",
      fr: "{high} % des commandes récentes ont été classées en haut risque par l'analyse de fraude de Shopify. {fulfilled} % des commandes Shopify à haut risque ont été expédiées malgré tout. Vous pouvez désormais suivre l'exposition au risque de fraude, les schémas opérationnels et les tendances des litiges directement dans DisputeDesk.",
      pt: "{high}% dos pedidos recentes foram classificados como alto risco pela análise de fraude do Shopify. {fulfilled}% dos pedidos de alto risco do Shopify foram atendidos mesmo assim. Você pode agora monitorar a exposição ao risco de fraude, padrões operacionais e tendências de disputas diretamente no DisputeDesk.",
      sv: "{high}% av de senaste ordrarna klassades som högrisk av Shopifys bedrägerianalys. {fulfilled}% av Shopifys högriskordrar uppfylldes ändå. Du kan nu följa bedrägerirsikexponering, operativa mönster och tvisttrender direkt i DisputeDesk.",
    },
    bannerHealthLine: {
      de: "Aktueller Chargeback-Zustand: {status}",
      es: "Estado actual de contracargos: {status}",
      fr: "État actuel des chargebacks : {status}",
      pt: "Status atual de chargebacks: {status}",
      sv: "Aktuell chargeback-status: {status}",
    },
    bannerHealth_good: { de: "Im gesunden Bereich", es: "Dentro del rango saludable", fr: "Dans la zone saine", pt: "Dentro da faixa saudável", sv: "Inom hälsosamt intervall" },
    bannerHealth_at_risk: { de: "Nähert sich dem Schwellenwert", es: "Acercándose al umbral", fr: "Approche du seuil", pt: "Aproximando-se do limite", sv: "Närmar sig tröskeln" },
    bannerHealth_elevated: { de: "Über dem Schwellenwert", es: "Por encima del umbral", fr: "Au-dessus du seuil", pt: "Acima do limite", sv: "Över tröskeln" },
    bannerHealth_unknown: { de: "Noch nicht gemessen", es: "Aún no medido", fr: "Pas encore mesuré", pt: "Ainda não medido", sv: "Ännu inte mätt" },
    bannerHealthInsufficient: {
      de: "Baseline wird aufgebaut — noch zu wenige aktuelle Bestellungen, um eine aussagekräftige Quote auszuweisen.",
      es: "Construyendo base de comparación — aún no hay suficientes pedidos recientes para mostrar una tasa significativa.",
      fr: "Constitution de la base de référence — encore trop peu de commandes récentes pour afficher un taux significatif.",
      pt: "Construindo a base de comparação — ainda há poucos pedidos recentes para apresentar uma taxa significativa.",
      sv: "Bygger upp basvärde — ännu för få aktuella ordrar för att visa en meningsfull frekvens.",
    },
    bannerCtaRiskAnalysis: { de: "Risikoanalyse öffnen", es: "Abrir análisis de riesgo", fr: "Ouvrir l'analyse des risques", pt: "Abrir análise de risco", sv: "Öppna riskanalys" },
    bannerCtaDisputeQueue: { de: "Streitfall-Queue öffnen", es: "Abrir cola de disputas", fr: "Ouvrir la file des litiges", pt: "Abrir fila de disputas", sv: "Öppna tvistkö" },
    bannerCtaRiskProfile: { de: "Risikoanalyse öffnen", es: "Abrir análisis de riesgo", fr: "Ouvrir l'analyse des risques", pt: "Abrir análise de risco", sv: "Öppna riskanalys" },
    bannerCtaChargebackHealth: { de: "Streitfall-Queue öffnen", es: "Abrir cola de disputas", fr: "Ouvrir la file des litiges", pt: "Abrir fila de disputas", sv: "Öppna tvistkö" },
    chargebackHealthInsufficientTitle: { de: "Unzureichende Streitfall-Historie", es: "Historial de disputas insuficiente", fr: "Historique de litiges insuffisant", pt: "Histórico de disputas insuficiente", sv: "Otillräcklig tvisthistorik" },
    chargebackHealthInsufficientBody: {
      de: "Wir haben in den letzten 90 Tagen {count} Bestellungen beobachtet — nicht genug, um die Chargeback-Gesundheit in einen aussagekräftigen Bereich einzuordnen. Die Einschätzung erscheint automatisch, sobald das Volumen steigt.",
      es: "Hemos observado {count} pedidos en los últimos 90 días — no son suficientes para clasificar el estado de contracargos en una banda significativa. El veredicto aparecerá automáticamente cuando aumente el volumen.",
      fr: "Nous avons observé {count} commandes ces 90 derniers jours — pas assez pour classer l'état des chargebacks dans une plage significative. Le verdict apparaîtra automatiquement dès que le volume augmente.",
      pt: "Observamos {count} pedidos nos últimos 90 dias — não é suficiente para classificar a saúde de chargebacks em uma faixa significativa. O veredicto aparecerá automaticamente quando o volume aumentar.",
      sv: "Vi har observerat {count} ordrar de senaste 90 dagarna — inte tillräckligt för att klassificera chargeback-hälsan i ett meningsfullt intervall. Bedömningen visas automatiskt när volymen ökar.",
    },
    pageTitle: { de: "Erstanalyse", es: "Análisis inicial", fr: "Analyse initiale", pt: "Análise inicial", sv: "Inledande analys" },
    pageSubtitle: {
      de: "Operativer Kontext aus Shopifys Betrugssignalen — keine Entscheidung zur Betrugsprävention.",
      es: "Contexto operacional a partir de las señales de fraude de Shopify — no es una decisión de prevención de fraude.",
      fr: "Contexte opérationnel issu des signaux de fraude de Shopify — pas une décision de prévention de fraude.",
      pt: "Contexto operacional a partir dos sinais de fraude do Shopify — não é uma decisão de prevenção de fraude.",
      sv: "Operativ kontext från Shopifys bedrägerisignaler — inte ett beslut om bedrägeriförebyggande.",
    },
    pageHeadline: {
      de: "Wir haben {count} historische Shopify-Bestellungen analysiert.",
      es: "Hemos analizado {count} pedidos históricos de Shopify.",
      fr: "Nous avons analysé {count} commandes Shopify historiques.",
      pt: "Analisamos {count} pedidos históricos do Shopify.",
      sv: "Vi har analyserat {count} historiska Shopify-ordrar.",
    },
    pageBody: {
      de: "{high}% der jüngsten Bestellungen wurden von Shopifys Betrugsanalyse als hochriskant eingestuft. {fulfilled}% dieser Hochrisiko-Bestellungen wurden trotzdem erfüllt. Nutzen Sie diese Ansicht, um Exposition, operative Muster und Streittrends zu beobachten.",
      es: "{high}% de los pedidos recientes fueron clasificados como alto riesgo por el análisis de fraude de Shopify. El {fulfilled}% de esos pedidos de alto riesgo aún se cumplieron. Usa esta vista para monitorear exposición, patrones operativos y tendencias de disputas.",
      fr: "{high} % des commandes récentes ont été classées en haut risque par l'analyse de fraude de Shopify. {fulfilled} % de ces commandes à haut risque ont été expédiées malgré tout. Utilisez cette vue pour suivre l'exposition, les schémas opérationnels et les tendances des litiges.",
      pt: "{high}% dos pedidos recentes foram classificados como alto risco pela análise de fraude do Shopify. {fulfilled}% desses pedidos de alto risco foram atendidos mesmo assim. Use esta visão para monitorar exposição, padrões operacionais e tendências de disputas.",
      sv: "{high}% av de senaste ordrarna klassades som högrisk av Shopifys bedrägerianalys. {fulfilled}% av dessa högriskordrar uppfylldes ändå. Använd den här vyn för att följa exponering, operativa mönster och tvisttrender.",
    },
    pageScopeNoteDefault: {
      de: "Ihr Shop hat den Standard-Bestellverlauf-Umfang gewährt, daher umfasst diese Analyse die letzten 60 Tage. Das Fenster erweitert sich automatisch, sobald Shopify erweiterten historischen Zugriff genehmigt.",
      es: "Tu tienda otorgó el alcance estándar de historial de pedidos, por lo que este análisis cubre los últimos 60 días. La ventana se ampliará automáticamente una vez que Shopify apruebe el acceso histórico extendido.",
      fr: "Votre boutique a accordé la portée standard d'historique de commandes, donc cette analyse couvre les 60 derniers jours. La fenêtre s'élargira automatiquement dès que Shopify approuvera l'accès historique étendu.",
      pt: "Sua loja concedeu o escopo padrão de histórico de pedidos, portanto esta análise cobre os últimos 60 dias. A janela se expande automaticamente assim que o Shopify aprovar o acesso histórico estendido.",
      sv: "Din butik har beviljat standard-scopet för orderhistorik, så denna analys täcker de senaste 60 dagarna. Fönstret utökas automatiskt när Shopify godkänner utökad historisk åtkomst.",
    },
    pageSection90d: { de: "Letzte 90 Tage", es: "Últimos 90 días", fr: "90 derniers jours", pt: "Últimos 90 dias", sv: "Senaste 90 dagarna" },
    riskBreakdownTitle: {
      de: "Shopify-Risikoklassifizierung – Aufschlüsselung",
      es: "Desglose de la clasificación de riesgo de Shopify",
      fr: "Répartition de la classification de risque Shopify",
      pt: "Desdobramento da classificação de risco do Shopify",
      sv: "Fördelning av Shopifys riskklassificering",
    },
    riskHigh: { de: "Hoch", es: "Alto", fr: "Élevé", pt: "Alto", sv: "Hög" },
    riskMedium: { de: "Mittel", es: "Medio", fr: "Moyen", pt: "Médio", sv: "Medel" },
    riskLow: { de: "Niedrig", es: "Bajo", fr: "Faible", pt: "Baixo", sv: "Låg" },
    riskPending: { de: "Analyse ausstehend", es: "Análisis pendiente", fr: "Analyse en attente", pt: "Análise pendente", sv: "Analys väntar" },
    riskNone: { de: "Freigegeben", es: "Aprobado", fr: "Validé", pt: "Aprovado", sv: "Godkänd" },
    chargebackHealthTitle: { de: "Chargeback-Zustand", es: "Estado de contracargos", fr: "État des chargebacks", pt: "Saúde de chargebacks", sv: "Chargeback-status" },
    chargebackHealthExplain: {
      de: "Berechnet aus Ihrer rollierenden 90-Tage-Chargeback-Quote. Die Branchen-Schwellenwerte entsprechen den Programmen der Kartennetzwerke.",
      es: "Calculado a partir de tu tasa de contracargos de los últimos 90 días. Los umbrales de monitoreo coinciden con los programas de las redes de tarjetas.",
      fr: "Calculé à partir de votre taux de chargebacks glissant sur 90 jours. Les seuils de surveillance s'alignent sur les programmes des réseaux de cartes.",
      pt: "Calculado a partir da sua taxa de chargebacks móvel de 90 dias. Os limites de monitoramento estão alinhados com os programas das bandeiras.",
      sv: "Beräknat från din rullande 90-dagars chargeback-frekvens. Branschens tröskelvärden följer kortnätverkens program.",
    },
    chargebackHealthBands: {
      de: "Gut < 0,40 % · Risiko 0,40–0,60 % · Erhöht > 0,60 %",
      es: "Bueno < 0,40 % · Riesgo 0,40–0,60 % · Elevado > 0,60 %",
      fr: "Bon < 0,40 % · À risque 0,40–0,60 % · Élevé > 0,60 %",
      pt: "Bom < 0,40 % · Risco 0,40–0,60 % · Elevado > 0,60 %",
      sv: "Bra < 0,40 % · Risk 0,40–0,60 % · Förhöjt > 0,60 %",
    },
    whatThisMeansTitle: { de: "Was das bedeutet", es: "Qué significa esto", fr: "Ce que cela signifie", pt: "O que isto significa", sv: "Vad detta betyder" },
    whatThisMeansBody: {
      de: "Die Betrugsrisiko-Klassifizierung ist eines von vielen operativen Signalen. DisputeDesk behandelt sie als Kontext für die Streitfall-Korrelation und merchant-seitige Abläufe — niemals als Urteil über einzelne Bestellungen.",
      es: "La clasificación de riesgo de fraude es una señal operativa entre muchas. DisputeDesk la trata como contexto para la correlación de disputas y las operaciones del comerciante — nunca como un veredicto sobre pedidos individuales.",
      fr: "La classification de risque de fraude n'est qu'un signal opérationnel parmi d'autres. DisputeDesk la traite comme un contexte pour la corrélation avec les litiges et les opérations du marchand — jamais comme un verdict sur des commandes individuelles.",
      pt: "A classificação de risco de fraude é um sinal operacional entre vários. O DisputeDesk a trata como contexto para correlação com disputas e operações do lojista — nunca como veredicto sobre pedidos individuais.",
      sv: "Bedrägeririskklassificeringen är en operativ signal bland flera. DisputeDesk behandlar den som kontext för tvistsamvariation och köpmannens operativa arbete — aldrig som ett utlåtande om enskilda ordrar.",
    },
    // Tier 2 insight strip
    stripTitle: { de: "Operative Erkenntnisse", es: "Información operacional", fr: "Aperçus opérationnels", pt: "Insights operacionais", sv: "Operativa insikter" },
    stripBody: {
      de: "Wir haben {count} historische Shopify-Bestellungen analysiert. {high}% wurden von Shopifys Betrugsanalyse als hochriskant eingestuft. {fulfilled}% dieser hochriskanten Bestellungen wurden trotzdem erfüllt.",
      es: "Hemos analizado {count} pedidos históricos de Shopify. El {high}% fueron clasificados como alto riesgo por el análisis de fraude de Shopify. El {fulfilled}% de esos pedidos de alto riesgo aún se cumplieron.",
      fr: "Nous avons analysé {count} commandes Shopify historiques. {high} % ont été classées en haut risque par l'analyse de fraude de Shopify. {fulfilled} % de ces commandes à haut risque ont été expédiées malgré tout.",
      pt: "Analisamos {count} pedidos históricos do Shopify. {high}% foram classificados como alto risco pela análise de fraude do Shopify. {fulfilled}% desses pedidos de alto risco foram atendidos mesmo assim.",
      sv: "Vi har analyserat {count} historiska Shopify-ordrar. {high}% klassades som högrisk av Shopifys bedrägerianalys. {fulfilled}% av dessa högriskordrar uppfylldes ändå.",
    },
    stripPreparingBody: {
      de: "Operative Erkenntnisse werden vorbereitet — Ihre historische Analyse läuft noch. Die Zusammenfassung erscheint hier, sobald sie fertig ist.",
      es: "Preparando información operacional — tu análisis histórico aún está en curso. El resumen aparecerá aquí en cuanto termine.",
      fr: "Préparation des aperçus opérationnels — votre analyse historique est encore en cours. Le résumé apparaîtra ici une fois terminé.",
      pt: "Preparando insights operacionais — sua análise histórica ainda está em andamento. O resumo aparecerá aqui assim que terminar.",
      sv: "Förbereder operativa insikter — din historiska analys pågår fortfarande. Sammanfattningen visas här när den är klar.",
    },
    stripCta: { de: "Operative Analyse ansehen", es: "Ver análisis operacional", fr: "Voir l'analyse opérationnelle", pt: "Ver análise operacional", sv: "Visa operativ analys" },
    // Risk-bucket definitions
    breakdownExplainTitle: { de: "Was diese bedeuten", es: "Qué significan", fr: "Ce que ces termes signifient", pt: "O que estes significam", sv: "Vad dessa betyder" },
    breakdownExplainBannerTitle: {
      de: "Freigegeben vs. Niedrig — wo liegt der Unterschied?",
      es: "Aprobado vs. Bajo — ¿cuál es la diferencia?",
      fr: "Validé vs. Faible — quelle est la différence ?",
      pt: "Aprovado vs. Baixo — qual é a diferença?",
      sv: "Godkänd vs. Låg — vad är skillnaden?",
    },
    breakdownExplainBannerBody: {
      de: "Niedrig bedeutet, dass Shopify ausdrücklich POSITIVE Signale gefunden hat (Stammkunde, Übereinstimmung von Rechnung/Versand, etablierte E-Mail-Domain). Freigegeben bedeutet, dass Shopify die Bestellung analysiert, aber in keine Richtung starke Signale gefunden hat — keine Warnzeichen UND keine positiven Bestätigungen. Beide sind sicher zu akzeptieren; Niedrig stützt sich nur auf mehr positive Belege. In einem gesunden Shop landet die Mehrheit der Bestellungen in Freigegeben, einfach weil die meisten Kunden nichts Bemerkenswertes auslösen.",
      es: "Bajo significa que Shopify encontró señales POSITIVAS explícitas (cliente recurrente, coincidencia de facturación/envío, dominio de email establecido). Aprobado significa que Shopify analizó el pedido pero no encontró señales fuertes en ninguna dirección — ni alertas rojas NI respaldos positivos. Ambos son seguros para aceptar; Bajo simplemente tiene más evidencia positiva detrás. En una tienda saludable, la mayoría de los pedidos terminan en Aprobado simplemente porque la mayoría de los clientes no desencadenan nada notable.",
      fr: "Faible signifie que Shopify a trouvé des signaux POSITIFS explicites (client récurrent, concordance facturation/livraison, domaine e-mail établi). Validé signifie que Shopify a analysé la commande mais n'a trouvé aucun signal fort dans un sens ou dans l'autre — aucun signal d'alarme NI aucune validation explicite. Les deux sont sûrs à accepter ; Faible repose simplement sur davantage de preuves positives. Dans une boutique saine, la majorité des commandes se retrouvent dans Validé simplement parce que la plupart des clients ne déclenchent rien de notable.",
      pt: "Baixo significa que o Shopify encontrou sinais POSITIVOS explícitos (cliente recorrente, correspondência entre cobrança e entrega, domínio de e-mail estabelecido). Aprovado significa que o Shopify analisou o pedido, mas não encontrou sinais fortes em nenhuma direção — nem alertas vermelhos NEM aprovações explícitas. Ambos são seguros para aceitar; Baixo apenas tem mais evidências positivas por trás. Em uma loja saudável, a maioria dos pedidos termina em Aprovado simplesmente porque a maior parte dos clientes não dispara nada notável.",
      sv: "Låg betyder att Shopify hittade uttryckligen POSITIVA signaler (återkommande kund, matchning fakturerings-/leveransadress, etablerad e-postdomän). Godkänd betyder att Shopify analyserade ordern men inte hittade starka signaler åt något håll — varken röda flaggor ELLER uttryckliga positiva bekräftelser. Båda är trygga att acceptera; Låg har bara mer positivt underlag bakom sig. På en hälsosam butik hamnar majoriteten av ordrarna i Godkänd helt enkelt för att de flesta kunder inte triggar något anmärkningsvärt.",
    },
    breakdownExplainHigh: {
      de: "Shopify hat mehrere NEGATIVE Signale erkannt (z. B. VPN-Nutzung, Adresse eines Paketversenders, Abweichung zwischen Rechnungs- und Versandadresse in einer Hochbetrugsregion). Manuelle Prüfung empfohlen.",
      es: "Shopify detectó múltiples señales NEGATIVAS (p. ej. uso de VPN, dirección de un reenviador de paquetes, discrepancia entre facturación y envío en una región de alto fraude). Se recomienda revisión manual.",
      fr: "Shopify a détecté plusieurs signaux NÉGATIFS (par ex. utilisation de VPN, adresse de réexpéditeur, incohérence facturation/livraison dans une région à forte fraude). Examen manuel recommandé.",
      pt: "O Shopify detectou múltiplos sinais NEGATIVOS (por exemplo, uso de VPN, endereço de redistribuidor de encomendas, divergência entre cobrança/entrega em região de alto risco). Recomenda-se revisão manual.",
      sv: "Shopify upptäckte flera NEGATIVA signaler (t.ex. VPN-användning, paketvidarebefordrare-adress, avvikelse mellan fakturerings- och leveransadress i högriskregion). Manuell granskning rekommenderas.",
    },
    breakdownExplainMedium: {
      de: "Einige neutrale oder mehrdeutige Signale, die einen zweiten Blick wert sind (z. B. Erstkunde, Bestellung außerhalb der typischen Geschäftszeiten).",
      es: "Algunas señales neutras o ambiguas que merecen una segunda mirada (p. ej. cliente nuevo, pedido fuera del horario habitual de la tienda).",
      fr: "Quelques signaux neutres ou ambigus méritant un second regard (par ex. nouveau client, commande passée en dehors des horaires habituels).",
      pt: "Alguns sinais neutros ou ambíguos que merecem um segundo olhar (por exemplo, cliente novo, pedido fora do horário típico da loja).",
      sv: "Några neutrala eller tvetydiga signaler värda en andra titt (t.ex. förstagångskund, order lagd utanför butikens vanliga tider).",
    },
    breakdownExplainLow: {
      de: "Shopify hat ausdrücklich POSITIVE Signale gefunden — Stammkunde mit erfolgreichen früheren Bestellungen, Übereinstimmung von Rechnung und Versand, etablierte E-Mail-Domain. Hohe Vertrauenswürdigkeit der Bestellung.",
      es: "Shopify encontró señales POSITIVAS explícitas — cliente recurrente con pedidos exitosos previos, coincidencia entre facturación y envío, dominio de email establecido. Alta confianza en que el pedido es legítimo.",
      fr: "Shopify a trouvé des signaux POSITIFS explicites — client récurrent avec des commandes précédentes réussies, concordance facturation/livraison, domaine e-mail établi. Forte confiance que la commande est légitime.",
      pt: "O Shopify encontrou sinais POSITIVOS explícitos — cliente recorrente com pedidos anteriores bem-sucedidos, correspondência entre cobrança e entrega, domínio de e-mail estabelecido. Alta confiança de que o pedido é legítimo.",
      sv: "Shopify hittade uttryckligen POSITIVA signaler — återkommande kund med tidigare lyckade ordrar, matchande fakturerings-/leveransadress, etablerad e-postdomän. Hög tilltro till att ordern är legitim.",
    },
    breakdownExplainPending: {
      de: "Shopify hat seine Betrugsprüfung für diese Bestellung noch nicht abgeschlossen — ein Urteil erscheint später.",
      es: "Shopify aún no ha terminado su verificación de fraude para este pedido — el veredicto aparecerá más tarde.",
      fr: "Shopify n'a pas encore terminé son contrôle de fraude pour cette commande — le verdict apparaîtra plus tard.",
      pt: "O Shopify ainda não concluiu a verificação de fraude para este pedido — o veredicto aparecerá depois.",
      sv: "Shopify har inte slutfört bedrägerikontrollen för denna order — bedömningen kommer senare.",
    },
    breakdownExplainCleared: {
      de: "Shopify hat seine Analyse abgeschlossen, aber in keine Richtung starke Signale gefunden — weder Warnzeichen NOCH explizite positive Indikatoren. Unterschied zu Niedrig: Niedrig bedeutet „Ich sehe Gründe, das zu vertrauen\"; Freigegeben bedeutet „Ich sehe keinen Grund, das zu markieren.\" Die meisten Bestellungen landen in einem gesunden Shop hier.",
      es: "Shopify completó su análisis pero no encontró señales fuertes en ninguna dirección — ni alertas rojas NI indicadores positivos explícitos. Diferente de Bajo: Bajo significa \"veo razones para confiar en esto\"; Aprobado significa \"no veo razón para marcarlo\". La mayoría de los pedidos terminan aquí en una tienda saludable.",
      fr: "Shopify a terminé son analyse mais n'a trouvé aucun signal fort dans un sens ou dans l'autre — aucun signal d'alarme NI indicateur positif explicite. Différent de Faible : Faible veut dire « je vois des raisons d'avoir confiance » ; Validé veut dire « je ne vois aucune raison de signaler cela ». Dans une boutique saine, la majorité des commandes se retrouvent ici.",
      pt: "O Shopify concluiu sua análise, mas não encontrou sinais fortes em nenhuma direção — nem alertas vermelhos NEM indicadores positivos explícitos. Diferente de Baixo: Baixo significa \"vejo motivos para confiar\"; Aprovado significa \"não vejo motivo para sinalizar\". A maioria dos pedidos termina aqui em uma loja saudável.",
      sv: "Shopify slutförde sin analys men hittade inga starka signaler åt något håll — varken röda flaggor ELLER uttryckliga positiva indikatorer. Skiljer sig från Låg: Låg betyder \"jag ser skäl att lita på detta\"; Godkänd betyder \"jag ser ingen anledning att flagga detta\". På en hälsosam butik hamnar de flesta ordrar här.",
    },
    // Risk-to-dispute correlation
    correlationTitle: {
      de: "Risikoklassifizierung vs. Streitfall-Ausgang",
      es: "Clasificación de riesgo vs. resultado de disputas",
      fr: "Classification de risque vs. issue des litiges",
      pt: "Classificação de risco vs. resultado de disputas",
      sv: "Riskklassificering vs. tvistutfall",
    },
    correlationSubtitle: {
      de: "Wie oft jede Shopify-Risikostufe in Ihrem Shop tatsächlich zu einem Streitfall wurde. Beobachtet, nicht prognostiziert.",
      es: "Con qué frecuencia cada nivel de riesgo de Shopify en tu tienda se ha convertido en una disputa real. Observado, no predicho.",
      fr: "À quelle fréquence chaque niveau de risque Shopify de votre boutique s'est transformé en un litige réel. Observé, et non prédit.",
      pt: "Com que frequência cada nível de risco do Shopify na sua loja se converteu em uma disputa real. Observado, não previsto.",
      sv: "Hur ofta varje Shopify-risknivå i din butik faktiskt blev en tvist. Observerat, inte förutsagt.",
    },
    correlationInsufficient: { de: "Stichprobe zu klein", es: "Muestra insuficiente", fr: "Échantillon insuffisant", pt: "Amostra insuficiente", sv: "Otillräckligt urval" },
    correlationObservationStrong: {
      de: "In Ihrem Shop wurden Bestellungen, die Shopify als hochriskant eingestuft hat, etwa {ratio}-mal häufiger zu Streitfällen als Bestellungen, die Shopify freigegeben oder als niedriges Risiko bewertet hat. Eine starke beobachtete Korrelation — Hochrisiko-Bestellungen sind eine manuelle Prüfung wert.",
      es: "En tu tienda, los pedidos que Shopify clasificó como alto riesgo se convirtieron en disputas aproximadamente {ratio} veces más a menudo que los pedidos que Shopify aprobó o calificó como bajo riesgo. Es una correlación observada fuerte — vale la pena revisar manualmente los pedidos de alto riesgo.",
      fr: "Dans votre boutique, les commandes que Shopify a classées en haut risque sont devenues des litiges environ {ratio} fois plus souvent que les commandes validées ou classées en faible risque. Forte corrélation observée — les commandes à haut risque méritent un examen manuel.",
      pt: "Na sua loja, pedidos que o Shopify classificou como alto risco se tornaram disputas cerca de {ratio} vezes com mais frequência do que pedidos que o Shopify aprovou ou classificou como baixo risco. Forte correlação observada — vale a pena revisar manualmente os pedidos de alto risco.",
      sv: "I din butik blev ordrar som Shopify klassade som högrisk till tvister cirka {ratio} gånger oftare än ordrar som Shopify godkände eller bedömde som låg risk. En stark observerad samvariation — högriskordrar är värda manuell granskning.",
    },
    correlationObservationMild: {
      de: "In Ihrem Shop wurden Bestellungen, die Shopify als hochriskant eingestuft hat, etwa {ratio}-mal häufiger zu Streitfällen als Bestellungen, die Shopify freigegeben oder als niedriges Risiko bewertet hat. Das Signal ist mild, nicht überwältigend.",
      es: "En tu tienda, los pedidos que Shopify clasificó como alto riesgo se convirtieron en disputas aproximadamente {ratio} veces más a menudo que los pedidos que Shopify aprobó o calificó como bajo riesgo. La señal es leve, no abrumadora.",
      fr: "Dans votre boutique, les commandes classées en haut risque par Shopify sont devenues des litiges environ {ratio} fois plus souvent que les commandes validées ou en faible risque. Le signal est modéré, pas écrasant.",
      pt: "Na sua loja, pedidos que o Shopify classificou como alto risco se tornaram disputas cerca de {ratio} vezes com mais frequência do que pedidos aprovados ou de baixo risco. O sinal é moderado, não esmagador.",
      sv: "I din butik blev ordrar som Shopify klassade som högrisk till tvister cirka {ratio} gånger oftare än ordrar som Shopify godkände eller bedömde som låg risk. Signalen är måttlig, inte överväldigande.",
    },
    correlationObservationFlat: {
      de: "In Ihrem Shop sind Hochrisiko- und Niedrigrisiko-Bestellungen bisher in ähnlichen Anteilen zu Streitfällen geworden. Shopifys Klassifizierung hat für Ihren Datensatz noch keine starke prognostische Trennung gezeigt.",
      es: "En tu tienda, los pedidos de alto y bajo riesgo se han convertido en disputas en tasas similares hasta ahora. La clasificación de Shopify aún no ha proporcionado una separación predictiva fuerte para tu conjunto de datos.",
      fr: "Dans votre boutique, les commandes à haut et à faible risque se sont converties en litiges à des taux similaires jusqu'ici. La classification de Shopify n'a pas fourni de séparation prédictive forte pour vos données pour l'instant.",
      pt: "Na sua loja, pedidos de alto e baixo risco se converteram em disputas em taxas similares até agora. A classificação do Shopify ainda não forneceu uma separação preditiva forte para seus dados.",
      sv: "I din butik har högrisk- och lågriskordrar hittills blivit tvister i liknande utsträckning. Shopifys klassificering har ännu inte gett stark prediktiv separation för ditt dataset.",
    },
    correlationObservationInverted: {
      de: "Ungewöhnlich — in Ihrem Shop wurden Hochrisiko-Bestellungen in ähnlichem oder geringerem Maße zu Streitfällen wie freigegebene Bestellungen. Das kann passieren, wenn die Streitfall-Stichprobe klein ist oder Streitfälle eher durch Nachkauf-Probleme (Lieferung, Produkt) als durch Betrugssignale getrieben werden.",
      es: "Inusual — en tu tienda, los pedidos de alto riesgo se han convertido en disputas a una tasa similar o menor que los pedidos aprobados. Esto puede ocurrir cuando la muestra de disputas es pequeña o cuando las disputas están impulsadas por problemas post-compra (entrega, producto) en lugar de señales de fraude.",
      fr: "Inhabituel — dans votre boutique, les commandes à haut risque se sont converties en litiges à un taux similaire ou inférieur aux commandes validées. Cela peut arriver lorsque l'échantillon de litiges est restreint ou lorsque les litiges sont portés par des problèmes post-achat (livraison, produit) plutôt que par des signaux de fraude.",
      pt: "Incomum — na sua loja, pedidos de alto risco se converteram em disputas a uma taxa similar ou menor à dos pedidos aprovados. Isto pode acontecer quando a amostra de disputas é pequena ou quando as disputas são impulsionadas por problemas pós-compra (entrega, produto) em vez de sinais de fraude.",
      sv: "Ovanligt — i din butik har högriskordrar omvandlats till tvister i liknande eller lägre takt än godkända ordrar. Detta kan inträffa när tvistsamlingen är liten eller när tvister drivs av efterköpsproblem (leverans, produkt) snarare än bedrägerisignaler.",
    },
    correlationObservationNeedHigh: {
      de: "Bisher noch nicht genug Hochrisiko-Bestellungen beobachtet, um eine aussagekräftige Korrelation zu berechnen. Konversionsraten erscheinen hier, sobald das Volumen steigt.",
      es: "Aún no se han observado suficientes pedidos de alto riesgo para calcular una correlación significativa. Las tasas de conversión aparecerán aquí cuando aumente el volumen.",
      fr: "Pas encore assez de commandes à haut risque observées pour calculer une corrélation significative. Les taux de conversion apparaîtront ici dès que le volume augmentera.",
      pt: "Ainda não há pedidos de alto risco suficientes para calcular uma correlação significativa. As taxas de conversão aparecerão aqui quando o volume crescer.",
      sv: "Inte tillräckligt med högriskordrar observerade ännu för att räkna fram en meningsfull samvariation. Konverteringskvoter visas här när volymen ökar.",
    },
    correlationObservationNeedSafe: {
      de: "Bisher noch nicht genug niedrigriskante oder freigegebene Bestellungen beobachtet, um eine sinnvolle Korrelations-Baseline zu berechnen.",
      es: "Aún no se han observado suficientes pedidos de bajo riesgo o aprobados para calcular una base de correlación significativa.",
      fr: "Pas encore assez de commandes à faible risque ou validées pour établir une base de comparaison significative.",
      pt: "Ainda não há pedidos de baixo risco ou aprovados suficientes para calcular uma base de correlação significativa.",
      sv: "Inte tillräckligt med lågrisk- eller godkända ordrar observerade ännu för att beräkna en meningsfull samvariationsbaslinje.",
    },
    // Scope-upgrade nudge
    scopeUpgradeTitle: {
      de: "Vollständigen Bestellverlauf freischalten",
      es: "Desbloquea tu historial completo de pedidos",
      fr: "Débloquez votre historique de commandes complet",
      pt: "Desbloqueie seu histórico completo de pedidos",
      sv: "Lås upp din fullständiga orderhistorik",
    },
    scopeUpgradeBody: {
      de: "DisputeDesk unterstützt jetzt die Analyse Ihres gesamten historischen Bestellverlaufs, nicht nur der letzten 60 Tage. Erneut autorisieren, um die Risikoübersicht um Saisonalität, langfristige Trends und Risiko-zu-Streit-Korrelation zu erweitern.",
      es: "DisputeDesk ahora puede analizar todo tu historial de pedidos, no solo los últimos 60 días. Vuelve a autorizar para ampliar el resumen de riesgo con estacionalidad, tendencias a largo plazo y correlación riesgo-disputa.",
      fr: "DisputeDesk prend désormais en charge l'analyse de l'intégralité de votre historique de commandes, et plus seulement des 60 derniers jours. Réautorisez pour enrichir l'aperçu du risque avec la saisonnalité, les tendances longues et la corrélation risque-litige.",
      pt: "O DisputeDesk agora pode analisar todo o seu histórico de pedidos, e não apenas os últimos 60 dias. Reautorize para ampliar a visão de risco com sazonalidade, tendências de longo prazo e correlação risco-disputa.",
      sv: "DisputeDesk stödjer nu analys av hela din orderhistorik, inte bara de senaste 60 dagarna. Återauktorisera för att utöka riskanalysen med säsongsvariation, långa trender och korrelation mellan risk och tvist.",
    },
    scopeUpgradeCta: {
      de: "Auf Shopify erneut autorisieren",
      es: "Reautorizar en Shopify",
      fr: "Réautoriser sur Shopify",
      pt: "Reautorizar no Shopify",
      sv: "Återauktorisera på Shopify",
    },
    // Risk Intelligence page v2
    pageTitleV2: {
      de: "Risiko-Intelligenz", es: "Inteligencia de riesgo",
      fr: "Intelligence des risques", pt: "Inteligência de risco",
      sv: "Riskintelligens",
    },
    heroNumberLabel: {
      de: "Analysierte historische Shopify-Bestellungen",
      es: "Pedidos históricos de Shopify analizados",
      fr: "Commandes Shopify historiques analysées",
      pt: "Pedidos históricos do Shopify analisados",
      sv: "Analyserade historiska Shopify-ordrar",
    },
    heroMiniBarLabel: {
      de: "Verteilung der Risikoklassifizierung",
      es: "Distribución de la clasificación de riesgo",
      fr: "Répartition de la classification de risque",
      pt: "Distribuição da classificação de risco",
      sv: "Fördelning av riskklassificering",
    },
    section30dTitle: {
      de: "Letzte 30 Tage", es: "Últimos 30 días",
      fr: "30 derniers jours", pt: "Últimos 30 dias",
      sv: "Senaste 30 dagarna",
    },
    section30dSubtitle: {
      de: "Aktuelle Momentaufnahme mit Veränderung gegenüber dem Vormonat",
      es: "Instantánea actual con cambio mes a mes",
      fr: "Instantané actuel avec variation par rapport au mois précédent",
      pt: "Visão atual com variação mês a mês",
      sv: "Aktuell ögonblicksbild med månadsvis förändring",
    },
    ordersWordTotal: {
      de: "Bestellungen insgesamt", es: "pedidos totales",
      fr: "commandes au total", pt: "pedidos no total",
      sv: "ordrar totalt",
    },
    deltaVsLast: {
      de: "ggü. letzten 30 T.", es: "vs. últimos 30 d.",
      fr: "vs. 30 j précédents", pt: "vs. últimos 30 d.",
      sv: "jmf. senaste 30 d.",
    },
    deltaStable: {
      de: "stabil", es: "estable", fr: "stable", pt: "estável", sv: "stabilt",
    },
    deltaNoComparison: {
      de: "kein Vergleichszeitraum",
      es: "sin período comparable",
      fr: "pas de période de comparaison",
      pt: "sem período de comparação",
      sv: "ingen jämförelseperiod",
    },
    sparklineTitle: {
      de: "Chargeback-Quote – Trend",
      es: "Tendencia de la tasa de contracargos",
      fr: "Tendance du taux de chargebacks",
      pt: "Tendência da taxa de chargebacks",
      sv: "Chargeback-frekvens – trend",
    },
    sparklineSubtitle: {
      de: "Wöchentlich, letzte 8 Wochen",
      es: "Semanal, últimas 8 semanas",
      fr: "Hebdomadaire, 8 dernières semaines",
      pt: "Semanal, últimas 8 semanas",
      sv: "Veckovis, senaste 8 veckorna",
    },
    gauge90dLabel: {
      de: "90-Tage-Chargeback-Quote",
      es: "Tasa de contracargos a 90 días",
      fr: "Taux de chargebacks sur 90 jours",
      pt: "Taxa de chargebacks em 90 dias",
      sv: "90-dagars chargeback-frekvens",
    },
    kpi3dsAuth: {
      de: "3-D-Secure-Authentifizierung",
      es: "Autenticación 3-D Secure",
      fr: "Authentification 3-D Secure",
      pt: "Autenticação 3-D Secure",
      sv: "3-D Secure-autentisering",
    },
    kpi3dsAuthContext: {
      de: "{num} von {den} Shopify-Payments-Bestellungen",
      es: "{num} de {den} pedidos de Shopify Payments",
      fr: "{num} sur {den} commandes Shopify Payments",
      pt: "{num} de {den} pedidos do Shopify Payments",
      sv: "{num} av {den} Shopify Payments-ordrar",
    },
    kpiMedianFulfillment: {
      de: "Median-Zeit bis zur Erfüllung",
      es: "Tiempo mediano de cumplimiento",
      fr: "Délai médian d'expédition",
      pt: "Tempo mediano de atendimento",
      sv: "Median tid till uppfyllelse",
    },
    kpiMedianFulfillmentContext: {
      de: "{count} erfüllte Bestellungen",
      es: "{count} pedidos cumplidos",
      fr: "{count} commandes expédiées",
      pt: "{count} pedidos atendidos",
      sv: "{count} uppfyllda ordrar",
    },
    kpiConfirmedDelivery: {
      de: "Bestätigte Zustellungen",
      es: "Entregas confirmadas",
      fr: "Livraisons confirmées",
      pt: "Entregas confirmadas",
      sv: "Bekräftade leveranser",
    },
    kpiConfirmedDeliveryContext: {
      de: "{num} von {den} erfüllten Bestellungen",
      es: "{num} de {den} pedidos cumplidos",
      fr: "{num} sur {den} commandes expédiées",
      pt: "{num} de {den} pedidos atendidos",
      sv: "{num} av {den} uppfyllda ordrar",
    },
    kpiSignedFor: {
      de: "Bei Zustellung unterzeichnet",
      es: "Firmado en la entrega",
      fr: "Signée à la livraison",
      pt: "Assinada na entrega",
      sv: "Signerad vid leverans",
    },
    kpiSignedForContext: {
      de: "{num} von {den} zugestellt",
      es: "{num} de {den} entregados",
      fr: "{num} sur {den} livrées",
      pt: "{num} de {den} entregues",
      sv: "{num} av {den} levererade",
    },
    gaugeBandGood: {
      de: "Gut < 0,4 %", es: "Bueno < 0,4 %",
      fr: "Bon < 0,4 %", pt: "Bom < 0,4 %", sv: "Bra < 0,4 %",
    },
    gaugeBandAtRisk: {
      de: "Risiko 0,4–0,6 %", es: "Riesgo 0,4–0,6 %",
      fr: "À risque 0,4–0,6 %", pt: "Risco 0,4–0,6 %",
      sv: "Risk 0,4–0,6 %",
    },
    gaugeBandElevated: {
      de: "Erhöht > 0,6 %", es: "Elevado > 0,6 %",
      fr: "Élevé > 0,6 %", pt: "Elevado > 0,6 %",
      sv: "Förhöjt > 0,6 %",
    },
  },
  dashboard: {
    recentActivity: {
      de: "Automatisierung & Einreichungs-Aktivität",
      es: "Actividad de automatización y envío",
      fr: "Activité d'automatisation et de soumission",
      pt: "Atividade de automação e envio",
      sv: "Automatisering och inlämningsaktivitet",
    },
  },
};

// Apply T to all locale files.
let totalKeysUpdated = 0;
for (const [lang, files] of Object.entries(LOCALE_FILES)) {
  for (const filename of files) {
    const path = join(DIR, filename);
    const obj = JSON.parse(readFileSync(path, "utf8"));
    for (const [namespace, keys] of Object.entries(T)) {
      if (!obj[namespace]) obj[namespace] = {};
      for (const [key, translations] of Object.entries(keys)) {
        const value = translations[lang];
        if (value !== undefined) {
          obj[namespace][key] = value;
          totalKeysUpdated += 1;
        }
      }
    }
    writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
    console.log(`  ${filename}: updated`);
  }
}
console.log(`\nTotal key writes across all locales: ${totalKeysUpdated}`);
process.exit(0);
