// One-shot: inject Operational Checkpoints i18n keys across every
// locale file under messages/. Native translations per locale —
// English fallback is never shipped to non-English merchants.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";

const COPY = {
  en: {
    checkpointsTitle: "Operational checkpoints",
    checkpointsSubtitle:
      "Where you stand relative to card-network rules and your own 30-day baseline.",
    checkpointSourcePrefix: "Source",

    checkpoint_chargeback_rate_vs_vamp_healthy_title:
      "Below Visa's monitoring band.",
    checkpoint_chargeback_rate_vs_vamp_healthy_body:
      "Your 90-day chargeback rate is {current}. Visa's VAMP Excessive threshold is {vampExcessive}; the operationally watched 'approaching' band begins around {vampApproaching}.",
    checkpoint_chargeback_rate_vs_vamp_consider_title:
      "Approaching Visa's VAMP threshold.",
    checkpoint_chargeback_rate_vs_vamp_consider_body:
      "Your 90-day chargeback rate is {current} — inside the {vampApproaching}–{vampExcessive} 'approaching' band. Acquirers face $8 per disputed transaction once Excessive ({vampExcessive}) is reached.",
    checkpoint_chargeback_rate_vs_vamp_breach_title:
      "Above Visa's VAMP Excessive threshold.",
    checkpoint_chargeback_rate_vs_vamp_breach_body:
      "Your 90-day chargeback rate is {current}, at or above Visa's VAMP Excessive threshold of {vampExcessive}. Acquirers face $8 per disputed transaction at this level.",

    checkpoint_chargeback_rate_vs_ecm_healthy_title:
      "Below Mastercard's ECM threshold.",
    checkpoint_chargeback_rate_vs_ecm_healthy_body:
      "Your 90-day chargeback rate is {current}, well below Mastercard's ECM ratio of {ecmRatio} (which also requires {ecmCount}+ chargebacks per month).",
    checkpoint_chargeback_rate_vs_ecm_consider_title:
      "Approaching Mastercard's ECM threshold.",
    checkpoint_chargeback_rate_vs_ecm_consider_body:
      "Your 90-day chargeback rate is {current}. Mastercard's ECM activates at {ecmRatio} ratio with {ecmCount}+ chargebacks per month (you average ~{monthlyEstimate}).",
    checkpoint_chargeback_rate_vs_ecm_breach_title:
      "Above Mastercard's ECM thresholds.",
    checkpoint_chargeback_rate_vs_ecm_breach_body:
      "Your 90-day chargeback rate is {current} and you average ~{monthlyEstimate} chargebacks per month. Both ECM criteria ({ecmRatio} ratio, {ecmCount}+/month) are now met.",

    checkpoint_high_risk_fulfilled_consider_title:
      "{current} of HIGH-risk orders were fulfilled.",
    checkpoint_high_risk_fulfilled_consider_body:
      "Each fulfilled HIGH-risk order is absorbed exposure — Shopify's risk model flagged but did not block. Consider an auto-hold or manual-review rule for HIGH-risk orders above a value threshold.",

    checkpoint_signature_capture_low_consider_title:
      "Signature captured on {current} of confirmed deliveries.",
    checkpoint_signature_capture_low_consider_body:
      "Carrier-attested signature confirmation is the strongest delivery evidence in fraud-coded chargebacks. Requiring signature on higher-value shipments meaningfully strengthens dispute defense.",

    checkpoint_threeds_auth_healthy_title:
      "3-DS authentication on {current} of eligible card orders.",
    checkpoint_threeds_auth_healthy_body:
      "Authenticated payments shift fraud-chargeback liability to the issuer under Visa's liability-shift rules. Coverage at this level is operationally strong.",
    checkpoint_threeds_auth_info_title:
      "3-DS authentication on {current} of eligible card orders.",
    checkpoint_threeds_auth_info_body:
      "Visa's liability shift moves fraud-chargeback responsibility to the issuer for authenticated payments. Coverage above 25% is the operationally strong band.",
    checkpoint_threeds_auth_consider_title:
      "3-DS authentication on {current} of eligible card orders.",
    checkpoint_threeds_auth_consider_body:
      "Authenticated payments shift fraud-chargeback liability to the issuer. Coverage this low leaves most card-not-present fraud disputes recoverable only through evidence packs.",

    checkpoint_protect_coverage_low_info_title:
      "Shopify Protect coverage at {current}.",
    checkpoint_protect_coverage_low_info_body:
      "Underwritten orders do not reach you as chargebacks. Lower coverage means a larger share of disputes are yours to defend with evidence packs.",

    checkpoint_fulfillment_baseline_degraded_consider_title:
      "Median fulfillment slowed to {current}.",
    checkpoint_fulfillment_baseline_degraded_consider_body:
      "Up {delta} versus prior 30 days ({prior}). Faster fulfillment generally strengthens customer-service signals — and is a routinely cited dispute factor.",

    checkpoint_fulfillment_baseline_improved_healthy_title:
      "Median fulfillment improved to {current}.",
    checkpoint_fulfillment_baseline_improved_healthy_body:
      "Down {delta} versus prior 30 days ({prior}). Faster fulfillment strengthens customer-service signals in non-fraud disputes.",
  },

  de: {
    checkpointsTitle: "Operative Checkpoints",
    checkpointsSubtitle:
      "Wo du im Verhältnis zu den Kartennetzregeln und deinem eigenen 30-Tage-Basiswert stehst.",
    checkpointSourcePrefix: "Quelle",

    checkpoint_chargeback_rate_vs_vamp_healthy_title:
      "Unter Visas Überwachungsband.",
    checkpoint_chargeback_rate_vs_vamp_healthy_body:
      "Deine 90-Tage-Rückbuchungsquote liegt bei {current}. Visas VAMP-Schwelle für „Excessive“ liegt bei {vampExcessive}; das operative „Nähert-sich“-Band beginnt etwa bei {vampApproaching}.",
    checkpoint_chargeback_rate_vs_vamp_consider_title:
      "Nähert sich Visas VAMP-Schwelle.",
    checkpoint_chargeback_rate_vs_vamp_consider_body:
      "Deine 90-Tage-Rückbuchungsquote liegt bei {current} — im Band {vampApproaching}–{vampExcessive}. Bei Erreichen der Excessive-Marke ({vampExcessive}) entstehen Acquirer-Gebühren von 8 USD pro angefochtener Transaktion.",
    checkpoint_chargeback_rate_vs_vamp_breach_title:
      "Über Visas VAMP-Excessive-Schwelle.",
    checkpoint_chargeback_rate_vs_vamp_breach_body:
      "Deine 90-Tage-Rückbuchungsquote liegt bei {current}, auf oder über Visas Excessive-Schwelle von {vampExcessive}. Acquirer zahlen auf diesem Niveau 8 USD pro angefochtener Transaktion.",

    checkpoint_chargeback_rate_vs_ecm_healthy_title:
      "Unter Mastercards ECM-Schwelle.",
    checkpoint_chargeback_rate_vs_ecm_healthy_body:
      "Deine 90-Tage-Rückbuchungsquote liegt bei {current}, deutlich unter Mastercards ECM-Quote von {ecmRatio} (zusätzlich erforderlich: {ecmCount}+ Rückbuchungen pro Monat).",
    checkpoint_chargeback_rate_vs_ecm_consider_title:
      "Nähert sich Mastercards ECM-Schwelle.",
    checkpoint_chargeback_rate_vs_ecm_consider_body:
      "Deine 90-Tage-Rückbuchungsquote liegt bei {current}. Mastercards ECM aktiviert bei {ecmRatio} Quote und {ecmCount}+ Rückbuchungen/Monat (Durchschnitt: ~{monthlyEstimate}).",
    checkpoint_chargeback_rate_vs_ecm_breach_title:
      "Über Mastercards ECM-Schwellen.",
    checkpoint_chargeback_rate_vs_ecm_breach_body:
      "Deine 90-Tage-Rückbuchungsquote liegt bei {current} und du erreichst durchschnittlich ~{monthlyEstimate} Rückbuchungen/Monat. Beide ECM-Kriterien ({ecmRatio} Quote, {ecmCount}+/Monat) sind erfüllt.",

    checkpoint_high_risk_fulfilled_consider_title:
      "{current} der HOCH-Risiko-Bestellungen wurden ausgeliefert.",
    checkpoint_high_risk_fulfilled_consider_body:
      "Jede ausgelieferte HOCH-Risiko-Bestellung ist übernommene Exposition — Shopifys Risikomodell hat markiert, aber nicht blockiert. Erwäge eine Auto-Hold- oder Manuelle-Prüfung-Regel für HOCH-Risiko-Bestellungen oberhalb eines Wertes.",

    checkpoint_signature_capture_low_consider_title:
      "Unterschrift bei {current} der bestätigten Zustellungen erfasst.",
    checkpoint_signature_capture_low_consider_body:
      "Vom Spediteur bestätigte Empfangsunterschriften sind der stärkste Zustellbeweis bei betrugsbedingten Rückbuchungen. Eine Unterschriftspflicht bei höheren Sendungswerten stärkt die Streitfallabwehr deutlich.",

    checkpoint_threeds_auth_healthy_title:
      "3-DS-Authentifizierung bei {current} der berechtigten Kartenzahlungen.",
    checkpoint_threeds_auth_healthy_body:
      "Authentifizierte Zahlungen verlagern die Haftung für Betrugsrückbuchungen auf den Aussteller (Visa Liability Shift). Deine Abdeckung ist auf diesem Niveau operativ stark.",
    checkpoint_threeds_auth_info_title:
      "3-DS-Authentifizierung bei {current} der berechtigten Kartenzahlungen.",
    checkpoint_threeds_auth_info_body:
      "Visas Liability Shift überträgt die Verantwortung für Betrugsrückbuchungen bei authentifizierten Zahlungen an den Aussteller. Werte über 25% sind operativ stark.",
    checkpoint_threeds_auth_consider_title:
      "3-DS-Authentifizierung bei {current} der berechtigten Kartenzahlungen.",
    checkpoint_threeds_auth_consider_body:
      "Authentifizierte Zahlungen verlagern die Haftung für Betrugsrückbuchungen auf den Aussteller. Bei so niedriger Abdeckung sind die meisten CNP-Betrugstreitfälle nur über Beweispakete rückgewinnbar.",

    checkpoint_protect_coverage_low_info_title:
      "Shopify-Protect-Abdeckung bei {current}.",
    checkpoint_protect_coverage_low_info_body:
      "Übernommene Bestellungen erreichen dich nicht als Rückbuchungen. Bei geringerer Abdeckung musst du einen größeren Anteil der Streitfälle selbst mit Beweispaketen verteidigen.",

    checkpoint_fulfillment_baseline_degraded_consider_title:
      "Mittlere Bearbeitungszeit verschlechtert auf {current}.",
    checkpoint_fulfillment_baseline_degraded_consider_body:
      "Plus {delta} gegenüber den vorherigen 30 Tagen ({prior}). Schnellere Bearbeitung stärkt grundsätzlich die Kundenservice-Signale — und ist ein häufig genannter Faktor in Streitfällen.",

    checkpoint_fulfillment_baseline_improved_healthy_title:
      "Mittlere Bearbeitungszeit verbessert auf {current}.",
    checkpoint_fulfillment_baseline_improved_healthy_body:
      "Minus {delta} gegenüber den vorherigen 30 Tagen ({prior}). Schnellere Bearbeitung stärkt die Kundenservice-Signale in Nicht-Betrugstreitfällen.",
  },

  es: {
    checkpointsTitle: "Puntos de control operativos",
    checkpointsSubtitle:
      "Tu posición frente a las reglas de las redes de tarjetas y tu propio promedio de los últimos 30 días.",
    checkpointSourcePrefix: "Fuente",

    checkpoint_chargeback_rate_vs_vamp_healthy_title:
      "Por debajo de la banda de monitoreo de Visa.",
    checkpoint_chargeback_rate_vs_vamp_healthy_body:
      "Tu tasa de contracargos a 90 días es de {current}. El umbral Excessive de VAMP de Visa es {vampExcessive}; la banda operativa de 'acercándose' comienza en torno a {vampApproaching}.",
    checkpoint_chargeback_rate_vs_vamp_consider_title:
      "Acercándose al umbral VAMP de Visa.",
    checkpoint_chargeback_rate_vs_vamp_consider_body:
      "Tu tasa de contracargos a 90 días es de {current}, dentro de la banda {vampApproaching}–{vampExcessive}. Los adquirentes enfrentan 8 USD por transacción disputada al alcanzar el nivel Excessive ({vampExcessive}).",
    checkpoint_chargeback_rate_vs_vamp_breach_title:
      "Por encima del umbral Excessive de VAMP.",
    checkpoint_chargeback_rate_vs_vamp_breach_body:
      "Tu tasa de contracargos a 90 días es {current}, igual o superior al umbral Excessive de VAMP ({vampExcessive}). Los adquirentes enfrentan 8 USD por transacción disputada en este nivel.",

    checkpoint_chargeback_rate_vs_ecm_healthy_title:
      "Por debajo del umbral ECM de Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_healthy_body:
      "Tu tasa de contracargos a 90 días es {current}, muy por debajo del ratio ECM de Mastercard de {ecmRatio} (que además exige {ecmCount}+ contracargos/mes).",
    checkpoint_chargeback_rate_vs_ecm_consider_title:
      "Acercándose al umbral ECM de Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_consider_body:
      "Tu tasa de contracargos a 90 días es {current}. ECM de Mastercard activa con un ratio de {ecmRatio} y {ecmCount}+ contracargos/mes (promedio: ~{monthlyEstimate}).",
    checkpoint_chargeback_rate_vs_ecm_breach_title:
      "Por encima de los umbrales ECM de Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_breach_body:
      "Tu tasa de contracargos a 90 días es {current} y promedias ~{monthlyEstimate} contracargos/mes. Ambos criterios ECM ({ecmRatio} ratio, {ecmCount}+/mes) están cumplidos.",

    checkpoint_high_risk_fulfilled_consider_title:
      "Se cumplió el {current} de los pedidos de riesgo ALTO.",
    checkpoint_high_risk_fulfilled_consider_body:
      "Cada pedido de riesgo ALTO cumplido es exposición absorbida — el modelo de Shopify lo marcó pero no lo bloqueó. Considera una regla de retención automática o revisión manual para pedidos ALTOS por encima de un umbral de valor.",

    checkpoint_signature_capture_low_consider_title:
      "Se registró firma en el {current} de las entregas confirmadas.",
    checkpoint_signature_capture_low_consider_body:
      "La firma de recepción atestiguada por el transportista es la prueba de entrega más fuerte en contracargos por fraude. Exigir firma en envíos de mayor valor refuerza notablemente la defensa de las disputas.",

    checkpoint_threeds_auth_healthy_title:
      "Autenticación 3-DS en el {current} de los pedidos con tarjeta elegibles.",
    checkpoint_threeds_auth_healthy_body:
      "Los pagos autenticados trasladan la responsabilidad por contracargos de fraude al emisor (liability shift de Visa). Tu cobertura es operativamente fuerte a este nivel.",
    checkpoint_threeds_auth_info_title:
      "Autenticación 3-DS en el {current} de los pedidos con tarjeta elegibles.",
    checkpoint_threeds_auth_info_body:
      "El liability shift de Visa traslada la responsabilidad por contracargos de fraude al emisor para los pagos autenticados. Coberturas por encima del 25% son operativamente fuertes.",
    checkpoint_threeds_auth_consider_title:
      "Autenticación 3-DS en el {current} de los pedidos con tarjeta elegibles.",
    checkpoint_threeds_auth_consider_body:
      "Los pagos autenticados trasladan la responsabilidad por contracargos de fraude al emisor. Una cobertura tan baja deja la mayoría de las disputas CNP recuperables solo vía paquetes de pruebas.",

    checkpoint_protect_coverage_low_info_title:
      "Cobertura de Shopify Protect en {current}.",
    checkpoint_protect_coverage_low_info_body:
      "Los pedidos asegurados no llegan a ti como contracargos. Una cobertura más baja significa que una mayor proporción de las disputas las defenderás tú mismo con paquetes de pruebas.",

    checkpoint_fulfillment_baseline_degraded_consider_title:
      "Tiempo mediano de cumplimiento desacelerado a {current}.",
    checkpoint_fulfillment_baseline_degraded_consider_body:
      "Más {delta} respecto a los 30 días anteriores ({prior}). Un cumplimiento más rápido fortalece las señales de servicio al cliente — y es un factor citado habitualmente en disputas.",

    checkpoint_fulfillment_baseline_improved_healthy_title:
      "Tiempo mediano de cumplimiento mejorado a {current}.",
    checkpoint_fulfillment_baseline_improved_healthy_body:
      "Menos {delta} respecto a los 30 días anteriores ({prior}). Un cumplimiento más rápido fortalece las señales de servicio al cliente en disputas no relacionadas con fraude.",
  },

  fr: {
    checkpointsTitle: "Points de contrôle opérationnels",
    checkpointsSubtitle:
      "Votre position face aux règles des réseaux de cartes et à votre propre référence sur 30 jours.",
    checkpointSourcePrefix: "Source",

    checkpoint_chargeback_rate_vs_vamp_healthy_title:
      "Sous la bande de surveillance de Visa.",
    checkpoint_chargeback_rate_vs_vamp_healthy_body:
      "Votre taux de contestation sur 90 jours est de {current}. Le seuil Excessive du VAMP de Visa est {vampExcessive} ; la bande opérationnelle « approche » commence vers {vampApproaching}.",
    checkpoint_chargeback_rate_vs_vamp_consider_title:
      "Approche du seuil VAMP de Visa.",
    checkpoint_chargeback_rate_vs_vamp_consider_body:
      "Votre taux de contestation sur 90 jours est de {current} — dans la bande {vampApproaching}–{vampExcessive}. Les acquéreurs s'exposent à 8 USD par transaction contestée une fois le seuil Excessive ({vampExcessive}) atteint.",
    checkpoint_chargeback_rate_vs_vamp_breach_title:
      "Au-dessus du seuil Excessive de VAMP.",
    checkpoint_chargeback_rate_vs_vamp_breach_body:
      "Votre taux de contestation sur 90 jours est de {current}, à ou au-dessus du seuil Excessive de VAMP ({vampExcessive}). Les acquéreurs s'exposent à 8 USD par transaction contestée à ce niveau.",

    checkpoint_chargeback_rate_vs_ecm_healthy_title:
      "Sous le seuil ECM de Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_healthy_body:
      "Votre taux de contestation sur 90 jours est de {current}, bien en dessous du ratio ECM de Mastercard de {ecmRatio} (qui exige aussi {ecmCount}+ contestations/mois).",
    checkpoint_chargeback_rate_vs_ecm_consider_title:
      "Approche du seuil ECM de Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_consider_body:
      "Votre taux de contestation sur 90 jours est de {current}. L'ECM de Mastercard s'active à {ecmRatio} et {ecmCount}+ contestations/mois (moyenne : ~{monthlyEstimate}).",
    checkpoint_chargeback_rate_vs_ecm_breach_title:
      "Au-dessus des seuils ECM de Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_breach_body:
      "Votre taux de contestation sur 90 jours est de {current} et vous totalisez ~{monthlyEstimate} contestations/mois. Les deux critères ECM ({ecmRatio} ratio, {ecmCount}+/mois) sont atteints.",

    checkpoint_high_risk_fulfilled_consider_title:
      "{current} des commandes à risque ÉLEVÉ ont été expédiées.",
    checkpoint_high_risk_fulfilled_consider_body:
      "Chaque commande à risque ÉLEVÉ expédiée est une exposition absorbée — le modèle de Shopify a signalé sans bloquer. Envisagez une règle d'auto-blocage ou d'examen manuel pour les commandes ÉLEVÉES au-dessus d'un seuil de valeur.",

    checkpoint_signature_capture_low_consider_title:
      "Signature enregistrée sur {current} des livraisons confirmées.",
    checkpoint_signature_capture_low_consider_body:
      "La signature attestée par le transporteur est la preuve de livraison la plus forte dans les contestations pour fraude. Exiger la signature sur les expéditions de valeur supérieure renforce nettement la défense des contestations.",

    checkpoint_threeds_auth_healthy_title:
      "Authentification 3-DS sur {current} des paiements par carte éligibles.",
    checkpoint_threeds_auth_healthy_body:
      "Les paiements authentifiés transfèrent la responsabilité des contestations pour fraude à l'émetteur (liability shift de Visa). Votre couverture est opérationnellement forte à ce niveau.",
    checkpoint_threeds_auth_info_title:
      "Authentification 3-DS sur {current} des paiements par carte éligibles.",
    checkpoint_threeds_auth_info_body:
      "Le liability shift de Visa transfère la responsabilité des contestations pour fraude à l'émetteur pour les paiements authentifiés. Au-delà de 25%, la couverture est opérationnellement forte.",
    checkpoint_threeds_auth_consider_title:
      "Authentification 3-DS sur {current} des paiements par carte éligibles.",
    checkpoint_threeds_auth_consider_body:
      "Les paiements authentifiés transfèrent la responsabilité des contestations pour fraude à l'émetteur. Une couverture aussi faible rend la plupart des contestations CNP de fraude récupérables uniquement via des dossiers de preuves.",

    checkpoint_protect_coverage_low_info_title:
      "Couverture Shopify Protect à {current}.",
    checkpoint_protect_coverage_low_info_body:
      "Les commandes couvertes ne vous parviennent pas sous forme de contestations. Une couverture plus faible signifie qu'une plus grande part des contestations est à défendre vous-même avec des dossiers de preuves.",

    checkpoint_fulfillment_baseline_degraded_consider_title:
      "Délai médian d'expédition ralenti à {current}.",
    checkpoint_fulfillment_baseline_degraded_consider_body:
      "En hausse de {delta} par rapport aux 30 jours précédents ({prior}). Un traitement plus rapide renforce généralement les signaux service client — facteur régulièrement cité dans les contestations.",

    checkpoint_fulfillment_baseline_improved_healthy_title:
      "Délai médian d'expédition amélioré à {current}.",
    checkpoint_fulfillment_baseline_improved_healthy_body:
      "En baisse de {delta} par rapport aux 30 jours précédents ({prior}). Un traitement plus rapide renforce les signaux service client dans les contestations hors fraude.",
  },

  pt: {
    checkpointsTitle: "Pontos de controle operacionais",
    checkpointsSubtitle:
      "Sua posição em relação às regras das redes de cartões e à sua própria média dos últimos 30 dias.",
    checkpointSourcePrefix: "Fonte",

    checkpoint_chargeback_rate_vs_vamp_healthy_title:
      "Abaixo da faixa de monitoramento da Visa.",
    checkpoint_chargeback_rate_vs_vamp_healthy_body:
      "Sua taxa de estornos em 90 dias é de {current}. O limite Excessive do VAMP da Visa é {vampExcessive}; a faixa operacional 'aproximando-se' começa por volta de {vampApproaching}.",
    checkpoint_chargeback_rate_vs_vamp_consider_title:
      "Aproximando-se do limite VAMP da Visa.",
    checkpoint_chargeback_rate_vs_vamp_consider_body:
      "Sua taxa de estornos em 90 dias é {current} — dentro da faixa {vampApproaching}–{vampExcessive}. Adquirentes sofrem multa de 8 USD por transação contestada quando o nível Excessive ({vampExcessive}) é atingido.",
    checkpoint_chargeback_rate_vs_vamp_breach_title:
      "Acima do limite Excessive do VAMP.",
    checkpoint_chargeback_rate_vs_vamp_breach_body:
      "Sua taxa de estornos em 90 dias é {current}, igual ou acima do limite Excessive do VAMP ({vampExcessive}). Adquirentes sofrem multa de 8 USD por transação contestada neste nível.",

    checkpoint_chargeback_rate_vs_ecm_healthy_title:
      "Abaixo do limite ECM da Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_healthy_body:
      "Sua taxa de estornos em 90 dias é {current}, bem abaixo do ratio ECM da Mastercard de {ecmRatio} (que também exige {ecmCount}+ estornos/mês).",
    checkpoint_chargeback_rate_vs_ecm_consider_title:
      "Aproximando-se do limite ECM da Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_consider_body:
      "Sua taxa de estornos em 90 dias é {current}. O ECM da Mastercard ativa com ratio de {ecmRatio} e {ecmCount}+ estornos/mês (média: ~{monthlyEstimate}).",
    checkpoint_chargeback_rate_vs_ecm_breach_title:
      "Acima dos limites ECM da Mastercard.",
    checkpoint_chargeback_rate_vs_ecm_breach_body:
      "Sua taxa de estornos em 90 dias é {current} e você acumula ~{monthlyEstimate} estornos/mês. Ambos os critérios ECM ({ecmRatio} ratio, {ecmCount}+/mês) estão atingidos.",

    checkpoint_high_risk_fulfilled_consider_title:
      "{current} dos pedidos de risco ALTO foram atendidos.",
    checkpoint_high_risk_fulfilled_consider_body:
      "Cada pedido de risco ALTO atendido é exposição absorvida — o modelo da Shopify sinalizou mas não bloqueou. Considere uma regra de auto-retenção ou revisão manual para pedidos ALTOS acima de um valor.",

    checkpoint_signature_capture_low_consider_title:
      "Assinatura registrada em {current} das entregas confirmadas.",
    checkpoint_signature_capture_low_consider_body:
      "A assinatura atestada pela transportadora é a evidência de entrega mais forte em estornos por fraude. Exigir assinatura em remessas de maior valor fortalece notavelmente a defesa de disputas.",

    checkpoint_threeds_auth_healthy_title:
      "Autenticação 3-DS em {current} dos pedidos com cartão elegíveis.",
    checkpoint_threeds_auth_healthy_body:
      "Pagamentos autenticados transferem a responsabilidade por estornos de fraude ao emissor (liability shift da Visa). Sua cobertura é operacionalmente forte neste nível.",
    checkpoint_threeds_auth_info_title:
      "Autenticação 3-DS em {current} dos pedidos com cartão elegíveis.",
    checkpoint_threeds_auth_info_body:
      "O liability shift da Visa transfere a responsabilidade por estornos de fraude ao emissor para pagamentos autenticados. Coberturas acima de 25% são operacionalmente fortes.",
    checkpoint_threeds_auth_consider_title:
      "Autenticação 3-DS em {current} dos pedidos com cartão elegíveis.",
    checkpoint_threeds_auth_consider_body:
      "Pagamentos autenticados transferem a responsabilidade por estornos de fraude ao emissor. Cobertura tão baixa deixa a maioria das disputas CNP de fraude recuperáveis apenas via pacotes de evidências.",

    checkpoint_protect_coverage_low_info_title:
      "Cobertura do Shopify Protect em {current}.",
    checkpoint_protect_coverage_low_info_body:
      "Pedidos cobertos não chegam até você como estornos. Cobertura menor significa que uma maior proporção das disputas precisará ser defendida por você com pacotes de evidências.",

    checkpoint_fulfillment_baseline_degraded_consider_title:
      "Tempo mediano de atendimento aumentou para {current}.",
    checkpoint_fulfillment_baseline_degraded_consider_body:
      "Mais {delta} versus os 30 dias anteriores ({prior}). Um atendimento mais rápido fortalece os sinais de serviço ao cliente — fator frequentemente citado em disputas.",

    checkpoint_fulfillment_baseline_improved_healthy_title:
      "Tempo mediano de atendimento melhorou para {current}.",
    checkpoint_fulfillment_baseline_improved_healthy_body:
      "Menos {delta} versus os 30 dias anteriores ({prior}). Um atendimento mais rápido fortalece os sinais de serviço ao cliente em disputas que não envolvem fraude.",
  },

  sv: {
    checkpointsTitle: "Operativa kontrollpunkter",
    checkpointsSubtitle:
      "Var du befinner dig i förhållande till kortnätsreglerna och din egen 30-dagars baslinje.",
    checkpointSourcePrefix: "Källa",

    checkpoint_chargeback_rate_vs_vamp_healthy_title:
      "Under Visas övervakningsband.",
    checkpoint_chargeback_rate_vs_vamp_healthy_body:
      "Din 90-dagars återkrediteringsfrekvens är {current}. Visas VAMP Excessive-tröskel är {vampExcessive}; det operativa 'närmar sig'-bandet börjar kring {vampApproaching}.",
    checkpoint_chargeback_rate_vs_vamp_consider_title:
      "Närmar sig Visas VAMP-tröskel.",
    checkpoint_chargeback_rate_vs_vamp_consider_body:
      "Din 90-dagars återkrediteringsfrekvens är {current} — inom bandet {vampApproaching}–{vampExcessive}. Acquirers betalar 8 USD per ifrågasatt transaktion när Excessive-nivån ({vampExcessive}) nås.",
    checkpoint_chargeback_rate_vs_vamp_breach_title:
      "Över Visas VAMP Excessive-tröskel.",
    checkpoint_chargeback_rate_vs_vamp_breach_body:
      "Din 90-dagars återkrediteringsfrekvens är {current}, på eller över Visas Excessive-tröskel ({vampExcessive}). Acquirers betalar 8 USD per ifrågasatt transaktion på denna nivå.",

    checkpoint_chargeback_rate_vs_ecm_healthy_title:
      "Under Mastercards ECM-tröskel.",
    checkpoint_chargeback_rate_vs_ecm_healthy_body:
      "Din 90-dagars återkrediteringsfrekvens är {current}, klart under Mastercards ECM-kvot på {ecmRatio} (kräver dessutom {ecmCount}+ återkrediteringar/månad).",
    checkpoint_chargeback_rate_vs_ecm_consider_title:
      "Närmar sig Mastercards ECM-tröskel.",
    checkpoint_chargeback_rate_vs_ecm_consider_body:
      "Din 90-dagars återkrediteringsfrekvens är {current}. Mastercards ECM aktiveras vid {ecmRatio}-kvot och {ecmCount}+ återkrediteringar/månad (snitt: ~{monthlyEstimate}).",
    checkpoint_chargeback_rate_vs_ecm_breach_title:
      "Över Mastercards ECM-trösklar.",
    checkpoint_chargeback_rate_vs_ecm_breach_body:
      "Din 90-dagars återkrediteringsfrekvens är {current} och du har ~{monthlyEstimate} återkrediteringar/månad. Båda ECM-kriterierna ({ecmRatio}-kvot, {ecmCount}+/månad) är uppfyllda.",

    checkpoint_high_risk_fulfilled_consider_title:
      "{current} av HÖG-risk-order skickades.",
    checkpoint_high_risk_fulfilled_consider_body:
      "Varje skickad HÖG-risk-order är absorberad exponering — Shopifys riskmodell flaggade men blockerade inte. Överväg en auto-håll- eller manuell granskning-regel för HÖG-risk-order över ett värde.",

    checkpoint_signature_capture_low_consider_title:
      "Signatur registrerad på {current} av bekräftade leveranser.",
    checkpoint_signature_capture_low_consider_body:
      "Transportör-attesterad signaturbekräftelse är det starkaste leveransbeviset vid bedrägeri-kodade återkrediteringar. Att kräva signatur på leveranser av högre värde stärker tvistförsvaret betydligt.",

    checkpoint_threeds_auth_healthy_title:
      "3-DS-autentisering på {current} av kvalificerade kortbetalningar.",
    checkpoint_threeds_auth_healthy_body:
      "Autentiserade betalningar flyttar ansvaret för bedrägeri-återkrediteringar till utgivaren (Visas liability shift). Din täckning är operativt stark på denna nivå.",
    checkpoint_threeds_auth_info_title:
      "3-DS-autentisering på {current} av kvalificerade kortbetalningar.",
    checkpoint_threeds_auth_info_body:
      "Visas liability shift flyttar ansvaret för bedrägeri-återkrediteringar till utgivaren för autentiserade betalningar. Täckning över 25% är operativt stark.",
    checkpoint_threeds_auth_consider_title:
      "3-DS-autentisering på {current} av kvalificerade kortbetalningar.",
    checkpoint_threeds_auth_consider_body:
      "Autentiserade betalningar flyttar ansvaret för bedrägeri-återkrediteringar till utgivaren. Så låg täckning gör att de flesta CNP-bedrägeritvister endast kan återvinnas via bevispaket.",

    checkpoint_protect_coverage_low_info_title:
      "Shopify Protect-täckning på {current}.",
    checkpoint_protect_coverage_low_info_body:
      "Tecknade order når dig inte som återkrediteringar. Lägre täckning betyder att en större andel tvister måste försvaras av dig själv med bevispaket.",

    checkpoint_fulfillment_baseline_degraded_consider_title:
      "Median utskickstid försämrad till {current}.",
    checkpoint_fulfillment_baseline_degraded_consider_body:
      "Upp {delta} jämfört med föregående 30 dagar ({prior}). Snabbare hantering stärker generellt kundsignalerna — en faktor som regelbundet åberopas i tvister.",

    checkpoint_fulfillment_baseline_improved_healthy_title:
      "Median utskickstid förbättrad till {current}.",
    checkpoint_fulfillment_baseline_improved_healthy_body:
      "Ned {delta} jämfört med föregående 30 dagar ({prior}). Snabbare hantering stärker kundsignalerna i tvister som inte rör bedrägeri.",
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
  for (const [k, v] of Object.entries(c)) {
    m.fraudIntel[k] = v;
  }
  writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  touched++;
  console.log(`Updated ${f}`);
}
console.log(`\nDone — ${touched} files updated.`);
