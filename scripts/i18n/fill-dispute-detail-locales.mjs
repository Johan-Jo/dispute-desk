#!/usr/bin/env node
/**
 * One-shot translation backfill for the dispute-detail Plan v2 redesign.
 *
 * Plan v2 (the 13-commit redesign that produced disputes.overview.hero,
 * .timeline, .coverage, .submissionSummary, .monitoring; the cardholder
 * acknowledgement upload; the Inclusion Review section; and the new
 * row.packageStatus / row.bankArgumentStatus labels) only landed in
 * `en` and `en-US`. This script writes the localized blocks into:
 *
 *   es, es-ES, fr, fr-FR, pt, pt-BR, sv, sv-SE
 *
 * Run: `node scripts/i18n/fill-dispute-detail-locales.mjs`
 *
 * The script is idempotent — it merges new keys without touching keys
 * that already exist in the locale file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCALES_DIR = resolve(process.cwd(), "messages");

/**
 * Translations for `disputes.overview`. Structure mirrors en.json.
 * Plurals use the same ICU keys as English; CLDR rules handle the
 * grammar per locale.
 */
const TRANSLATIONS = {
  es: {
    overview: {
      monitoring: {
        title: "DisputeDesk está supervisando este pedido",
        bodyWithDeadline: "Si la información de envío, la confirmación de entrega, la verificación de pago u otras pruebas derivadas del sistema están disponibles antes de tu plazo ({deadline}), DisputeDesk actualizará automáticamente el paquete de defensa. No necesitas hacer nada.",
        bodyNoDeadline: "Si la información de envío, la confirmación de entrega, la verificación de pago u otras pruebas derivadas del sistema están disponibles antes de tu plazo, DisputeDesk actualizará automáticamente el paquete de defensa. No necesitas hacer nada.",
      },
      rowSourceCaptionPendingSystem: "Pendiente de actividad del pedido — se completará automáticamente cuando Shopify lo informe",
      timeline: {
        defencePackagePrepared: {
          titleDone: "Paquete de defensa preparado",
          titleActive: "Preparando paquete de defensa",
          titlePending: "Preparar paquete de defensa",
          helperDone: "DisputeDesk recopiló las pruebas disponibles para este caso.",
          helperActive: "Se está preparando el paquete.",
          helperPending: "Genera el paquete de pruebas para comenzar.",
        },
        reviewAndSubmit: {
          title: "Revisar y enviar",
          helperWithDeadline: "Fecha límite de envío: {deadline}",
          helperNoDeadline: "Revisa el paquete y envíalo a Shopify antes de la fecha límite.",
        },
        evidenceSavedToShopify: {
          title: "Pruebas guardadas en Shopify",
          helperWithDate: "Guardado el {savedDate}",
          helperNoDate: "Guardado en Shopify",
        },
        awaitingShopifyForwarding: {
          title: "Esperando que Shopify lo reenvíe a la red de tarjetas",
          helperWithDeadline: "Shopify reenvía las pruebas a tu red de tarjetas antes de la fecha límite ({deadline}) o antes si haces clic en Enviar en el Shopify Admin. DisputeDesk no puede verificar de forma independiente cuándo ocurre el reenvío.",
          helperNoDeadline: "Shopify reenvía las pruebas a tu red de tarjetas antes de la fecha límite o antes si haces clic en Enviar en el Shopify Admin. DisputeDesk no puede verificar de forma independiente cuándo ocurre el reenvío.",
        },
        submittedToCardNetwork: {
          title: "Enviado a la red de tarjetas",
          helper: "Shopify ha reenviado las pruebas — la red de tarjetas las está revisando.",
        },
        cardNetworkReview: {
          title: "Revisión por la red de tarjetas",
          helperActive: "Duración estimada: 30–75 días.",
          helperPending: "Comienza cuando Shopify reenvíe las pruebas a tu red de tarjetas.",
        },
        outcomePosted: {
          title: "Resultado publicado en Shopify",
          helperWithOutcome: "Resultado: {outcome}",
          helperPending: "Te avisaremos por email cuando se tome una decisión.",
        },
      },
      submissionSummary: {
        titlePreSave: "Lo que se guardará en Shopify",
        titlePostSave: "Lo que se guardó en Shopify",
        subtitlePreSave: "Estos elementos llegarán a Shopify cuando DisputeDesk guarde el paquete de defensa.",
        subtitlePostSave: "Shopify recibió los elementos listados a continuación. El PDF contiene el argumento dirigido al banco; los campos estructurados solo contienen la identidad del cliente.",
        shopifyFieldsLabel: "Guardado como campos estructurados de Shopify",
        shopifyFieldsHelper: "Nombre y correo del cliente — los únicos campos estructurados que envía DisputeDesk. Las pruebas viajan dentro del PDF.",
        shopifyFieldsCustomerFirstName: "Nombre del cliente",
        shopifyFieldsCustomerLastName: "Apellido del cliente",
        shopifyFieldsCustomerEmail: "Correo del cliente",
        shopifyFieldsNoneOnFile: "—",
        includedInPackageLabel: "Incluido en el paquete de defensa",
        includedInPackageHelper: "Hechos probatorios que aparecen en el PDF que recibe el banco.",
        includedInPackageEmpty: "No hay hechos probatorios incluidos en el paquete.",
        includedInPackagePdfLine: "PDF: {pdfFileName}",
        bankArgumentLabel: "Usado como argumento positivo ante el banco",
        bankArgumentHelper: "Pruebas que la narrativa de defensa cita como prueba decisiva.",
        bankArgumentEmpty: "No hay pruebas decisivas para el banco disponibles para esta disputa.",
        contextOnlyLabel: "Solo contexto",
        contextOnlyHelper: "Incluidas en el paquete como antecedentes; no se citan como prueba decisiva.",
        keptInternalLabel: "Mantenido interno",
        keptInternalHelper: "Señales que te ayudan a entender el caso, pero no se incluyen en el argumento ante el banco porque podrían debilitar la respuesta.",
        keptInternalSeeEvidenceTab: "Ve la pestaña Pruebas → Señales solo internas para más detalles.",
        notIncludedLabel: "No incluido",
        notIncludedHelper: "Elementos excluidos, no compatibles o con error de subida. Ninguno llega a Shopify.",
        notIncludedFailedUpload: "Subida fallida para {count, plural, =1 {1 elemento} other {# elementos}}.",
        notIncludedExcluded: "{count, plural, =1 {1 elemento excluido} other {# elementos excluidos}} por ti.",
        notIncludedWaived: "{count, plural, =1 {1 elemento marcado} other {# elementos marcados}} como no aplicable.",
        notIncludedNotSupported: "{count, plural, =1 {1 elemento} other {# elementos}} sin espacio para envío al banco.",
      },
      coverage: {
        title: "Cobertura de pruebas",
        sectionsFound: "{count, plural, =0 {No se encontraron secciones de pruebas} =1 {1 sección de pruebas encontrada} other {# secciones de pruebas encontradas}}",
        includedInPackage: "{count, plural, =0 {Nada incluido en el paquete de defensa} =1 {1 elemento incluido en el paquete de defensa} other {# elementos incluidos en el paquete de defensa}}",
        usedAsPositiveBankArgument: "{count, plural, =0 {0 usados como argumento positivo ante el banco} =1 {1 usado como argumento positivo ante el banco} other {# usados como argumento positivo ante el banco}}",
        keptInternal: "{count, plural, =0 {0 mantenidos internos} =1 {1 mantenido interno} other {# mantenidos internos}}",
        tileSectionsFound: "Secciones de pruebas encontradas",
        tileIncludedInPackage: "Incluido en paquete de defensa",
        tileUsedAsBankArgument: "Usado como argumento positivo ante el banco",
        tileKeptInternal: "Mantenido interno",
        missingDecisiveLabel: "Falta prueba decisiva",
        missingDecisiveNone: "Todas las pruebas decisivas están presentes.",
        missingDecisiveFraud: "verificación de pago, entrega confirmada, reconocimiento de compra por el cliente",
        summarySentence: "Encontramos {found, plural, =1 {1 sección de pruebas} other {# secciones de pruebas}}{savedClause, select, none {} other {{savedClause}}}.{weakClause, select, none {} other { {weakClause}}}",
        savedClauseSaved: " y guardamos el paquete de defensa en Shopify",
        savedClauseDraft: "",
        weakClauseHardToWin: "El caso sigue siendo débil porque las pruebas disponibles son en su mayoría contexto de apoyo, mientras que faltan pruebas decisivas de {family}.",
        weakClauseNotHardToWin: "",
      },
      hero: {
        title: {
          preSubmit: {
            likely_to_win: "Caso sólido para impugnar",
            could_win: "Revisar antes de impugnar",
            needs_strengthening: "Revisar antes de impugnar",
            hard_to_win: "Documentación completa, defensa débil",
            covered: "Cubierto por Shopify Protect",
          },
          saved: {
            likely_to_win: "Defensa sólida guardada en Shopify",
            could_win: "Defensa moderada guardada en Shopify",
            needs_strengthening: "Defensa moderada guardada en Shopify",
            hard_to_win: "Defensa débil guardada en Shopify",
            covered: "Cubierto por Shopify Protect",
          },
          awaiting: {
            likely_to_win: "Defensa sólida reenviada a Shopify",
            could_win: "Defensa moderada reenviada a Shopify",
            needs_strengthening: "Defensa moderada reenviada a Shopify",
            hard_to_win: "Defensa débil reenviada a Shopify",
            covered: "Cubierto por Shopify Protect",
          },
          submitted_to_network: {
            likely_to_win: "Defensa sólida enviada a la red de tarjetas",
            could_win: "Defensa moderada enviada a la red de tarjetas",
            needs_strengthening: "Defensa moderada enviada a la red de tarjetas",
            hard_to_win: "Defensa débil enviada a la red de tarjetas",
            covered: "Cubierto por Shopify Protect",
          },
          closed: {
            won: "Disputa ganada",
            lost: "Disputa perdida",
            unknown: "Disputa cerrada",
          },
        },
        subtitle: {
          draftWithReason: "{strengthReason}",
          savedWithReason: "{strengthReason} Guardado en Shopify el {savedDate}.",
          savedWithReasonAndDeadline: "{strengthReason} Guardado en Shopify el {savedDate}. Shopify reenviará las pruebas a tu red de tarjetas antes de la fecha límite ({deadline}). Puedes seguir añadiendo pruebas hasta entonces.",
          savedNoDate: "{strengthReason} Guardado en Shopify — esperando el reenvío de Shopify a tu red de tarjetas.",
          awaitingForward: "{strengthReason} Shopify tiene el paquete y lo reenviará a tu red de tarjetas. DisputeDesk puede confirmar que las pruebas se guardaron en Shopify, pero no puede verificar de forma independiente cuándo ocurre el reenvío.",
          submittedToNetwork: "{strengthReason} La red de tarjetas está revisando esta defensa. El resultado suele publicarse en 30–75 días.",
          submittedToNetworkWithDate: "Enviado a tu red de tarjetas el {submittedDate}. El resultado suele publicarse en 30–75 días.",
          closedWon: "Resultado: ganada{submittedDate, select, none {} other { (decidida el {submittedDate})}}.",
          closedLost: "Resultado: perdida{submittedDate, select, none {} other { (decidida el {submittedDate})}}.",
          closedUnknown: "Resultado informado por Shopify: {outcome}.",
        },
      },
    },
    cardholderAck: {
      title: "Añadir reconocimiento del titular de la tarjeta",
      subtitle: "Si tienes un correo, chat u otro mensaje en el que el titular de la tarjeta confirma que realizó y recibió este pedido, pégalo aquí. El reconocimiento del titular es prueba decisiva en disputas de fraude — eleva la comunicación con el cliente de contexto de apoyo a un argumento positivo ante el banco.",
      textareaLabel: "Mensaje del titular de la tarjeta",
      textareaPlaceholder: "Pega el correo, chat o mensaje del titular de la tarjeta. Incluye la fecha y cualquier contexto que lo vincule a este pedido.",
      textareaHint: "Mínimo 20 caracteres. El texto se incluye textualmente en el PDF del paquete de defensa.",
      checkboxLabel: "Confirmo que este mensaje proviene del titular de la tarjeta y demuestra que realizó y/o recibió el pedido de esta disputa.",
      checkboxHelper: "Al marcar esta casilla atestiguas que el titular de la tarjeta redactó este mensaje. DisputeDesk registra la confirmación en el historial de auditoría de la disputa.",
      submit: "Guardar reconocimiento",
      submitting: "Guardando…",
      successTitle: "Reconocimiento del titular guardado",
      successBody: "La comunicación con el cliente queda marcada como prueba decisiva. DisputeDesk está regenerando el paquete de defensa — podrás revisar el resultado en un momento.",
      errorTooShort: "Pega al menos 20 caracteres del mensaje del titular de la tarjeta.",
      errorConfirmationRequired: "Confirma que el mensaje proviene del titular de la tarjeta antes de guardar.",
      errorWindowClosed: "Shopify ya reenvió esta disputa al banco, por lo que ya no se pueden añadir nuevos reconocimientos.",
      errorGeneric: "No se pudo guardar el reconocimiento ({code}). Inténtalo de nuevo.",
      charCount: "{count}/{max}",
    },
    inclusion: {
      title: "Revisión de inclusión",
      subtitle: "Verifica qué llega al banco antes de guardar. El paquete de defensa es el único canal hacia el banco — DisputeDesk no envía campos estructurados de prueba a Shopify.",
      groups: {
        usedAsBankArgument: "Usado como argumento positivo ante el banco",
        contextOnly: "Solo contexto",
        keptInternal: "Mantenido interno",
        notIncluded: "No incluido",
        excludedByMerchant: "Excluido por ti",
      },
      groupHelpers: {
        usedAsBankArgument: "Pruebas que la narrativa de defensa cita como evidencia decisiva. Solo lectura — añadir o quitar pruebas decisivas requiere modificar la carga subyacente.",
        contextOnly: "Contexto de fondo en el paquete. Solo lectura — el sistema decide si cada elemento se eleva a prueba decisiva.",
        keptInternal: "Señales que podrían debilitar el caso si se muestran al banco. Promoverlas requiere un flujo de confirmación que no está disponible en la Fase 1.",
        notIncluded: "Elementos en el expediente pero no en el paquete. Las filas seguras pueden incluirse manualmente como contexto de apoyo (nunca como prueba decisiva).",
        excludedByMerchant: "Elementos que has excluido explícitamente. Quita la anulación para restaurar el estado natural.",
      },
      toggle: {
        include: "Incluir en paquete",
        restore: "Restaurar predeterminado",
        disabledInternalOnly: "Promover una señal solo interna a la vista del banco requiere un flujo de confirmación que aún no está disponible.",
        disabledNoPayload: "No hay nada que incluir — los datos detrás de esta fila provienen de una fuente fuera del control de DisputeDesk (la pasarela de pago, el transportista o el motor de riesgo de Shopify).",
      },
      emptyGroup: "—",
      emptyAll: "Todavía no hay filas de pruebas disponibles para esta disputa. Genera o reconstruye el paquete de defensa para poblar esta sección.",
      errorOverride: "No se pudo actualizar la inclusión ({code}). Inténtalo de nuevo.",
      errorOverrideNeedsConfirmation: "Esta señal requiere un flujo de confirmación que aún no está disponible. La Fase 2 añadirá el aviso y el registro de auditoría de la anulación.",
    },
    packageStatus: {
      included: "Incluido en paquete de defensa",
      internal_only: "Solo interno",
      not_included: "No incluido",
      not_supported: "No compatible",
      excluded: "Excluido",
      failed_upload: "Subida fallida",
      waived: "Marcado como no aplicable",
    },
    bankArgumentStatus: {
      used: "Usado como argumento ante el banco",
      context_only: "Solo contexto",
      not_used: "No usado en argumento ante el banco",
    },
  },

  fr: {
    overview: {
      monitoring: {
        title: "DisputeDesk surveille cette commande",
        bodyWithDeadline: "Si le suivi d’expédition, la confirmation de livraison, la vérification de paiement ou d’autres preuves dérivées du système deviennent disponibles avant votre échéance ({deadline}), DisputeDesk mettra à jour automatiquement le dossier de défense. Aucune action requise de votre part.",
        bodyNoDeadline: "Si le suivi d’expédition, la confirmation de livraison, la vérification de paiement ou d’autres preuves dérivées du système deviennent disponibles avant votre échéance, DisputeDesk mettra à jour automatiquement le dossier de défense. Aucune action requise de votre part.",
      },
      rowSourceCaptionPendingSystem: "En attente d’activité sur la commande — se remplit automatiquement dès que Shopify le signale",
      timeline: {
        defencePackagePrepared: {
          titleDone: "Dossier de défense préparé",
          titleActive: "Préparation du dossier de défense",
          titlePending: "Préparer le dossier de défense",
          helperDone: "DisputeDesk a rassemblé les preuves disponibles pour ce dossier.",
          helperActive: "Le dossier est en cours de préparation.",
          helperPending: "Générez le dossier de preuves pour commencer.",
        },
        reviewAndSubmit: {
          title: "Réviser et envoyer",
          helperWithDeadline: "Échéance d’envoi : {deadline}",
          helperNoDeadline: "Révisez le dossier et envoyez-le à Shopify avant l’échéance.",
        },
        evidenceSavedToShopify: {
          title: "Preuves enregistrées dans Shopify",
          helperWithDate: "Enregistré le {savedDate}",
          helperNoDate: "Enregistré dans Shopify",
        },
        awaitingShopifyForwarding: {
          title: "En attente du transfert par Shopify au réseau de cartes",
          helperWithDeadline: "Shopify transfère les preuves à votre réseau de cartes avant l’échéance ({deadline}) ou plus tôt si vous cliquez sur Envoyer dans l’Admin Shopify. DisputeDesk ne peut pas vérifier indépendamment quand le transfert a lieu.",
          helperNoDeadline: "Shopify transfère les preuves à votre réseau de cartes avant l’échéance ou plus tôt si vous cliquez sur Envoyer dans l’Admin Shopify. DisputeDesk ne peut pas vérifier indépendamment quand le transfert a lieu.",
        },
        submittedToCardNetwork: {
          title: "Envoyé au réseau de cartes",
          helper: "Shopify a transféré les preuves — le réseau de cartes est en train de les examiner.",
        },
        cardNetworkReview: {
          title: "Examen par le réseau de cartes",
          helperActive: "Durée estimée : 30–75 jours.",
          helperPending: "Commence dès que Shopify transfère les preuves à votre réseau de cartes.",
        },
        outcomePosted: {
          title: "Résultat publié dans Shopify",
          helperWithOutcome: "Résultat : {outcome}",
          helperPending: "Vous serez notifié par email lorsqu’une décision sera prise.",
        },
      },
      submissionSummary: {
        titlePreSave: "Ce qui sera enregistré dans Shopify",
        titlePostSave: "Ce qui a été enregistré dans Shopify",
        subtitlePreSave: "Ces éléments seront transmis à Shopify lorsque DisputeDesk enregistrera le dossier de défense.",
        subtitlePostSave: "Shopify a reçu les éléments listés ci-dessous. Le PDF contient l’argumentaire destiné à la banque ; les champs structurés ne contiennent que l’identité du client.",
        shopifyFieldsLabel: "Enregistré en tant que champs Shopify structurés",
        shopifyFieldsHelper: "Nom et email du client — les seuls champs structurés envoyés par DisputeDesk. Les preuves voyagent dans le PDF.",
        shopifyFieldsCustomerFirstName: "Prénom du client",
        shopifyFieldsCustomerLastName: "Nom du client",
        shopifyFieldsCustomerEmail: "Email du client",
        shopifyFieldsNoneOnFile: "—",
        includedInPackageLabel: "Inclus dans le dossier de défense",
        includedInPackageHelper: "Faits probatoires qui apparaissent dans le PDF reçu par la banque.",
        includedInPackageEmpty: "Aucun fait probatoire n’est inclus dans le dossier.",
        includedInPackagePdfLine: "PDF : {pdfFileName}",
        bankArgumentLabel: "Utilisé comme argument positif auprès de la banque",
        bankArgumentHelper: "Preuves que le narratif de défense cite comme preuve décisive.",
        bankArgumentEmpty: "Aucune preuve décisive pour la banque n’est disponible pour ce litige.",
        contextOnlyLabel: "Contexte uniquement",
        contextOnlyHelper: "Incluses dans le dossier comme contexte ; non citées comme preuve décisive.",
        keptInternalLabel: "Gardé en interne",
        keptInternalHelper: "Signaux affichés pour vous aider à comprendre le dossier, mais non inclus dans l’argumentaire envoyé à la banque car ils pourraient affaiblir la réponse.",
        keptInternalSeeEvidenceTab: "Voir l’onglet Preuves → Signaux uniquement internes pour plus de détails.",
        notIncludedLabel: "Non inclus",
        notIncludedHelper: "Éléments exclus, non pris en charge ou dont l’envoi a échoué. Aucun n’est transmis à Shopify.",
        notIncludedFailedUpload: "Échec d’envoi pour {count, plural, =1 {1 élément} other {# éléments}}.",
        notIncludedExcluded: "{count, plural, =1 {1 élément exclu} other {# éléments exclus}} par vous.",
        notIncludedWaived: "{count, plural, =1 {1 élément marqué} other {# éléments marqués}} non applicable.",
        notIncludedNotSupported: "{count, plural, =1 {1 élément} other {# éléments}} sans emplacement destiné à la banque.",
      },
      coverage: {
        title: "Couverture des preuves",
        sectionsFound: "{count, plural, =0 {Aucune section de preuves trouvée} =1 {1 section de preuves trouvée} other {# sections de preuves trouvées}}",
        includedInPackage: "{count, plural, =0 {Rien inclus dans le dossier de défense} =1 {1 élément inclus dans le dossier de défense} other {# éléments inclus dans le dossier de défense}}",
        usedAsPositiveBankArgument: "{count, plural, =0 {0 utilisé comme argument positif auprès de la banque} =1 {1 utilisé comme argument positif auprès de la banque} other {# utilisés comme arguments positifs auprès de la banque}}",
        keptInternal: "{count, plural, =0 {0 gardé en interne} =1 {1 gardé en interne} other {# gardés en interne}}",
        tileSectionsFound: "Sections de preuves trouvées",
        tileIncludedInPackage: "Inclus dans le dossier de défense",
        tileUsedAsBankArgument: "Utilisé comme argument positif auprès de la banque",
        tileKeptInternal: "Gardé en interne",
        missingDecisiveLabel: "Preuve décisive manquante",
        missingDecisiveNone: "Toutes les preuves décisives sont présentes.",
        missingDecisiveFraud: "vérification de paiement, livraison confirmée, reconnaissance d’achat par le client",
        summarySentence: "Nous avons trouvé {found, plural, =1 {1 section de preuves} other {# sections de preuves}}{savedClause, select, none {} other {{savedClause}}}.{weakClause, select, none {} other { {weakClause}}}",
        savedClauseSaved: " et avons enregistré le dossier de défense dans Shopify",
        savedClauseDraft: "",
        weakClauseHardToWin: "Le dossier reste faible car les preuves disponibles sont principalement du contexte de soutien, tandis que des preuves décisives de {family} sont manquantes.",
        weakClauseNotHardToWin: "",
      },
      hero: {
        title: {
          preSubmit: {
            likely_to_win: "Dossier solide à contester",
            could_win: "À examiner avant de contester",
            needs_strengthening: "À examiner avant de contester",
            hard_to_win: "Documentation complète, défense faible",
            covered: "Couvert par Shopify Protect",
          },
          saved: {
            likely_to_win: "Défense solide enregistrée dans Shopify",
            could_win: "Défense modérée enregistrée dans Shopify",
            needs_strengthening: "Défense modérée enregistrée dans Shopify",
            hard_to_win: "Défense faible enregistrée dans Shopify",
            covered: "Couvert par Shopify Protect",
          },
          awaiting: {
            likely_to_win: "Défense solide transférée à Shopify",
            could_win: "Défense modérée transférée à Shopify",
            needs_strengthening: "Défense modérée transférée à Shopify",
            hard_to_win: "Défense faible transférée à Shopify",
            covered: "Couvert par Shopify Protect",
          },
          submitted_to_network: {
            likely_to_win: "Défense solide envoyée au réseau de cartes",
            could_win: "Défense modérée envoyée au réseau de cartes",
            needs_strengthening: "Défense modérée envoyée au réseau de cartes",
            hard_to_win: "Défense faible envoyée au réseau de cartes",
            covered: "Couvert par Shopify Protect",
          },
          closed: {
            won: "Litige gagné",
            lost: "Litige perdu",
            unknown: "Litige clos",
          },
        },
        subtitle: {
          draftWithReason: "{strengthReason}",
          savedWithReason: "{strengthReason} Enregistré dans Shopify le {savedDate}.",
          savedWithReasonAndDeadline: "{strengthReason} Enregistré dans Shopify le {savedDate}. Shopify transférera les preuves à votre réseau de cartes avant l’échéance ({deadline}). Vous pouvez continuer à ajouter des preuves jusque-là.",
          savedNoDate: "{strengthReason} Enregistré dans Shopify — en attente du transfert par Shopify à votre réseau de cartes.",
          awaitingForward: "{strengthReason} Shopify a le dossier et le transférera à votre réseau de cartes. DisputeDesk peut confirmer que les preuves ont été enregistrées dans Shopify, mais ne peut pas vérifier indépendamment quand le transfert a lieu.",
          submittedToNetwork: "{strengthReason} Le réseau de cartes examine cette défense. Le résultat est généralement publié dans 30–75 jours.",
          submittedToNetworkWithDate: "Envoyé à votre réseau de cartes le {submittedDate}. Le résultat est généralement publié dans 30–75 jours.",
          closedWon: "Résultat : gagné{submittedDate, select, none {} other { (décidé le {submittedDate})}}.",
          closedLost: "Résultat : perdu{submittedDate, select, none {} other { (décidé le {submittedDate})}}.",
          closedUnknown: "Résultat signalé par Shopify : {outcome}.",
        },
      },
    },
    cardholderAck: {
      title: "Ajouter la reconnaissance du titulaire de la carte",
      subtitle: "Si vous avez un email, un chat ou un autre message dans lequel le titulaire de la carte confirme qu’il a passé et reçu cette commande, collez-le ici. La reconnaissance du titulaire est une preuve décisive pour les litiges de fraude — elle élève la communication client du contexte de soutien à un argument positif auprès de la banque.",
      textareaLabel: "Message du titulaire de la carte",
      textareaPlaceholder: "Collez l’email, le chat ou le message du titulaire de la carte. Incluez la date et tout contexte qui le rattache à cette commande.",
      textareaHint: "Minimum 20 caractères. Le texte est inclus tel quel dans le PDF du dossier de défense.",
      checkboxLabel: "Je confirme que ce message provient du titulaire de la carte et démontre qu’il a passé et/ou reçu la commande de ce litige.",
      checkboxHelper: "En cochant cette case, vous attestez que le titulaire de la carte a rédigé ce message. DisputeDesk enregistre la confirmation dans la piste d’audit du litige.",
      submit: "Enregistrer la reconnaissance",
      submitting: "Enregistrement…",
      successTitle: "Reconnaissance du titulaire enregistrée",
      successBody: "La communication client est désormais marquée comme preuve décisive. DisputeDesk est en train de régénérer le dossier de défense — vous pourrez examiner le résultat dans un instant.",
      errorTooShort: "Veuillez coller au moins 20 caractères du message du titulaire de la carte.",
      errorConfirmationRequired: "Veuillez confirmer que le message provient du titulaire de la carte avant d’enregistrer.",
      errorWindowClosed: "Shopify a déjà transféré ce litige à la banque, donc aucune nouvelle reconnaissance ne peut être ajoutée.",
      errorGeneric: "Impossible d’enregistrer la reconnaissance ({code}). Veuillez réessayer.",
      charCount: "{count}/{max}",
    },
    inclusion: {
      title: "Révision d’inclusion",
      subtitle: "Vérifiez ce qui parvient à la banque avant d’enregistrer. Le dossier de défense est le seul canal vers la banque — DisputeDesk n’envoie pas de champs de preuves structurés à Shopify.",
      groups: {
        usedAsBankArgument: "Utilisé comme argument positif auprès de la banque",
        contextOnly: "Contexte uniquement",
        keptInternal: "Gardé en interne",
        notIncluded: "Non inclus",
        excludedByMerchant: "Exclu par vous",
      },
      groupHelpers: {
        usedAsBankArgument: "Preuves que le narratif de défense cite comme preuve décisive. Lecture seule — ajouter ou retirer des preuves décisives nécessite de modifier la charge utile sous-jacente.",
        contextOnly: "Contexte de fond dans le dossier. Lecture seule — le système décide si chaque élément s’élève au rang de preuve décisive.",
        keptInternal: "Signaux qui pourraient affaiblir le dossier s’ils étaient présentés à la banque. Leur promotion nécessite un flux de confirmation non disponible en Phase 1.",
        notIncluded: "Éléments présents au dossier mais pas dans le paquet. Les lignes sûres peuvent être incluses manuellement comme contexte de soutien (jamais comme preuve décisive).",
        excludedByMerchant: "Éléments que vous avez explicitement exclus. Supprimez la dérogation pour restaurer l’état naturel.",
      },
      toggle: {
        include: "Inclure dans le dossier",
        restore: "Restaurer par défaut",
        disabledInternalOnly: "Promouvoir un signal uniquement interne vers la banque nécessite un flux de confirmation pas encore disponible.",
        disabledNoPayload: "Rien à inclure — les données derrière cette ligne proviennent d’une source hors du contrôle de DisputeDesk (la passerelle de paiement, le transporteur, ou le moteur de risque de Shopify).",
      },
      emptyGroup: "—",
      emptyAll: "Aucune ligne de preuve n’est encore disponible pour ce litige. Générez ou reconstruisez le dossier de défense pour remplir cette section.",
      errorOverride: "Impossible de mettre à jour l’inclusion ({code}). Veuillez réessayer.",
      errorOverrideNeedsConfirmation: "Ce signal nécessite un flux de confirmation pas encore disponible. La Phase 2 ajoutera l’avertissement et la piste d’audit de la dérogation.",
    },
    packageStatus: {
      included: "Inclus dans le dossier de défense",
      internal_only: "Uniquement interne",
      not_included: "Non inclus",
      not_supported: "Non pris en charge",
      excluded: "Exclu",
      failed_upload: "Échec de l’envoi",
      waived: "Marqué non applicable",
    },
    bankArgumentStatus: {
      used: "Utilisé comme argument auprès de la banque",
      context_only: "Contexte uniquement",
      not_used: "Non utilisé dans l’argument auprès de la banque",
    },
  },

  pt: {
    overview: {
      monitoring: {
        title: "O DisputeDesk está monitorando este pedido",
        bodyWithDeadline: "Se o rastreamento de envio, a confirmação de entrega, a verificação de pagamento ou outras provas derivadas do sistema ficarem disponíveis antes do seu prazo ({deadline}), o DisputeDesk atualizará o pacote de defesa automaticamente. Nenhuma ação necessária da sua parte.",
        bodyNoDeadline: "Se o rastreamento de envio, a confirmação de entrega, a verificação de pagamento ou outras provas derivadas do sistema ficarem disponíveis antes do seu prazo, o DisputeDesk atualizará o pacote de defesa automaticamente. Nenhuma ação necessária da sua parte.",
      },
      rowSourceCaptionPendingSystem: "Aguardando atividade do pedido — será preenchido automaticamente quando o Shopify informar",
      timeline: {
        defencePackagePrepared: {
          titleDone: "Pacote de defesa preparado",
          titleActive: "Preparando pacote de defesa",
          titlePending: "Preparar pacote de defesa",
          helperDone: "O DisputeDesk reuniu as provas disponíveis para este caso.",
          helperActive: "O pacote está sendo preparado.",
          helperPending: "Gere o pacote de provas para começar.",
        },
        reviewAndSubmit: {
          title: "Revisar e enviar",
          helperWithDeadline: "Prazo de envio: {deadline}",
          helperNoDeadline: "Revise o pacote e envie ao Shopify antes do prazo.",
        },
        evidenceSavedToShopify: {
          title: "Provas salvas no Shopify",
          helperWithDate: "Salvo em {savedDate}",
          helperNoDate: "Salvo no Shopify",
        },
        awaitingShopifyForwarding: {
          title: "Aguardando o Shopify encaminhar à rede de cartões",
          helperWithDeadline: "O Shopify encaminha as provas à sua rede de cartões até o prazo ({deadline}) ou antes, se você clicar em Enviar no Shopify Admin. O DisputeDesk não pode verificar de forma independente quando o encaminhamento ocorre.",
          helperNoDeadline: "O Shopify encaminha as provas à sua rede de cartões até o prazo ou antes, se você clicar em Enviar no Shopify Admin. O DisputeDesk não pode verificar de forma independente quando o encaminhamento ocorre.",
        },
        submittedToCardNetwork: {
          title: "Enviado à rede de cartões",
          helper: "O Shopify encaminhou as provas — a rede de cartões está analisando.",
        },
        cardNetworkReview: {
          title: "Análise pela rede de cartões",
          helperActive: "Duração estimada: 30–75 dias.",
          helperPending: "Começa assim que o Shopify encaminhar as provas à sua rede de cartões.",
        },
        outcomePosted: {
          title: "Resultado publicado no Shopify",
          helperWithOutcome: "Resultado: {outcome}",
          helperPending: "Você será notificado por e-mail quando uma decisão for tomada.",
        },
      },
      submissionSummary: {
        titlePreSave: "O que será salvo no Shopify",
        titlePostSave: "O que foi salvo no Shopify",
        subtitlePreSave: "Estes itens chegarão ao Shopify quando o DisputeDesk salvar o pacote de defesa.",
        subtitlePostSave: "O Shopify recebeu os itens listados abaixo. O PDF contém o argumento dirigido ao banco; os campos estruturados contêm apenas a identidade do cliente.",
        shopifyFieldsLabel: "Salvo como campos estruturados do Shopify",
        shopifyFieldsHelper: "Nome e e-mail do cliente — os únicos campos estruturados que o DisputeDesk envia. As provas viajam dentro do PDF.",
        shopifyFieldsCustomerFirstName: "Nome do cliente",
        shopifyFieldsCustomerLastName: "Sobrenome do cliente",
        shopifyFieldsCustomerEmail: "E-mail do cliente",
        shopifyFieldsNoneOnFile: "—",
        includedInPackageLabel: "Incluído no pacote de defesa",
        includedInPackageHelper: "Fatos probatórios que aparecem no PDF que o banco recebe.",
        includedInPackageEmpty: "Nenhum fato probatório está incluído no pacote.",
        includedInPackagePdfLine: "PDF: {pdfFileName}",
        bankArgumentLabel: "Usado como argumento positivo ao banco",
        bankArgumentHelper: "Provas que a narrativa de defesa cita como prova decisiva.",
        bankArgumentEmpty: "Nenhuma prova decisiva para o banco está disponível para esta disputa.",
        contextOnlyLabel: "Apenas contexto",
        contextOnlyHelper: "Incluídas no pacote como pano de fundo; não citadas como prova decisiva.",
        keptInternalLabel: "Mantido interno",
        keptInternalHelper: "Sinais exibidos para ajudar você a entender o caso, mas não incluídos no argumento dirigido ao banco porque podem enfraquecer a resposta.",
        keptInternalSeeEvidenceTab: "Veja a aba Provas → Sinais apenas internos para detalhes.",
        notIncludedLabel: "Não incluído",
        notIncludedHelper: "Itens excluídos, não suportados ou com falha de upload. Nenhum deles chega ao Shopify.",
        notIncludedFailedUpload: "Upload falhou para {count, plural, =1 {1 item} other {# itens}}.",
        notIncludedExcluded: "{count, plural, =1 {1 item excluído} other {# itens excluídos}} por você.",
        notIncludedWaived: "{count, plural, =1 {1 item marcado} other {# itens marcados}} como não aplicável.",
        notIncludedNotSupported: "{count, plural, =1 {1 item} other {# itens}} sem espaço para envio ao banco.",
      },
      coverage: {
        title: "Cobertura de provas",
        sectionsFound: "{count, plural, =0 {Nenhuma seção de provas encontrada} =1 {1 seção de provas encontrada} other {# seções de provas encontradas}}",
        includedInPackage: "{count, plural, =0 {Nada incluído no pacote de defesa} =1 {1 item incluído no pacote de defesa} other {# itens incluídos no pacote de defesa}}",
        usedAsPositiveBankArgument: "{count, plural, =0 {0 usados como argumento positivo ao banco} =1 {1 usado como argumento positivo ao banco} other {# usados como argumento positivo ao banco}}",
        keptInternal: "{count, plural, =0 {0 mantidos internos} =1 {1 mantido interno} other {# mantidos internos}}",
        tileSectionsFound: "Seções de provas encontradas",
        tileIncludedInPackage: "Incluído no pacote de defesa",
        tileUsedAsBankArgument: "Usado como argumento positivo ao banco",
        tileKeptInternal: "Mantido interno",
        missingDecisiveLabel: "Falta prova decisiva",
        missingDecisiveNone: "Todas as provas decisivas estão presentes.",
        missingDecisiveFraud: "verificação de pagamento, entrega confirmada, reconhecimento de compra pelo cliente",
        summarySentence: "Encontramos {found, plural, =1 {1 seção de provas} other {# seções de provas}}{savedClause, select, none {} other {{savedClause}}}.{weakClause, select, none {} other { {weakClause}}}",
        savedClauseSaved: " e salvamos o pacote de defesa no Shopify",
        savedClauseDraft: "",
        weakClauseHardToWin: "O caso continua fraco porque as provas disponíveis são em sua maioria contexto de apoio, enquanto faltam provas decisivas de {family}.",
        weakClauseNotHardToWin: "",
      },
      hero: {
        title: {
          preSubmit: {
            likely_to_win: "Caso forte para contestar",
            could_win: "Revisar antes de contestar",
            needs_strengthening: "Revisar antes de contestar",
            hard_to_win: "Documentação completa, defesa fraca",
            covered: "Coberto pelo Shopify Protect",
          },
          saved: {
            likely_to_win: "Defesa forte salva no Shopify",
            could_win: "Defesa moderada salva no Shopify",
            needs_strengthening: "Defesa moderada salva no Shopify",
            hard_to_win: "Defesa fraca salva no Shopify",
            covered: "Coberto pelo Shopify Protect",
          },
          awaiting: {
            likely_to_win: "Defesa forte encaminhada ao Shopify",
            could_win: "Defesa moderada encaminhada ao Shopify",
            needs_strengthening: "Defesa moderada encaminhada ao Shopify",
            hard_to_win: "Defesa fraca encaminhada ao Shopify",
            covered: "Coberto pelo Shopify Protect",
          },
          submitted_to_network: {
            likely_to_win: "Defesa forte enviada à rede de cartões",
            could_win: "Defesa moderada enviada à rede de cartões",
            needs_strengthening: "Defesa moderada enviada à rede de cartões",
            hard_to_win: "Defesa fraca enviada à rede de cartões",
            covered: "Coberto pelo Shopify Protect",
          },
          closed: {
            won: "Disputa vencida",
            lost: "Disputa perdida",
            unknown: "Disputa encerrada",
          },
        },
        subtitle: {
          draftWithReason: "{strengthReason}",
          savedWithReason: "{strengthReason} Salvo no Shopify em {savedDate}.",
          savedWithReasonAndDeadline: "{strengthReason} Salvo no Shopify em {savedDate}. O Shopify encaminhará as provas à sua rede de cartões até o prazo ({deadline}). Você pode continuar adicionando provas até lá.",
          savedNoDate: "{strengthReason} Salvo no Shopify — aguardando o Shopify encaminhar à sua rede de cartões.",
          awaitingForward: "{strengthReason} O Shopify tem o pacote e o encaminhará à sua rede de cartões. O DisputeDesk pode confirmar que as provas foram salvas no Shopify, mas não pode verificar independentemente quando o encaminhamento ocorre.",
          submittedToNetwork: "{strengthReason} A rede de cartões está analisando esta defesa. O resultado costuma ser publicado em 30–75 dias.",
          submittedToNetworkWithDate: "Enviado à sua rede de cartões em {submittedDate}. O resultado costuma ser publicado em 30–75 dias.",
          closedWon: "Resultado: vencida{submittedDate, select, none {} other { (decidida em {submittedDate})}}.",
          closedLost: "Resultado: perdida{submittedDate, select, none {} other { (decidida em {submittedDate})}}.",
          closedUnknown: "Resultado informado pelo Shopify: {outcome}.",
        },
      },
    },
    cardholderAck: {
      title: "Adicionar reconhecimento do titular do cartão",
      subtitle: "Se você tem um e-mail, chat ou outra mensagem em que o titular do cartão confirma ter feito e recebido este pedido, cole aqui. O reconhecimento do titular é prova decisiva em disputas de fraude — eleva a comunicação com o cliente de contexto de apoio a um argumento positivo ao banco.",
      textareaLabel: "Mensagem do titular do cartão",
      textareaPlaceholder: "Cole o e-mail, chat ou mensagem do titular do cartão. Inclua a data e qualquer contexto que vincule a mensagem a este pedido.",
      textareaHint: "Mínimo de 20 caracteres. O texto é incluído literalmente no PDF do pacote de defesa.",
      checkboxLabel: "Confirmo que esta mensagem é do titular do cartão e demonstra que ele realizou e/ou recebeu o pedido desta disputa.",
      checkboxHelper: "Ao marcar esta caixa, você atesta que o titular do cartão escreveu esta mensagem. O DisputeDesk registra a confirmação no histórico de auditoria da disputa.",
      submit: "Salvar reconhecimento",
      submitting: "Salvando…",
      successTitle: "Reconhecimento do titular salvo",
      successBody: "A comunicação com o cliente agora está marcada como prova decisiva. O DisputeDesk está regenerando o pacote de defesa — você poderá revisar o resultado em instantes.",
      errorTooShort: "Cole pelo menos 20 caracteres da mensagem do titular do cartão.",
      errorConfirmationRequired: "Confirme que a mensagem é do titular do cartão antes de salvar.",
      errorWindowClosed: "O Shopify já encaminhou esta disputa ao banco, então novos reconhecimentos não podem mais ser adicionados.",
      errorGeneric: "Não foi possível salvar o reconhecimento ({code}). Tente novamente.",
      charCount: "{count}/{max}",
    },
    inclusion: {
      title: "Revisão de inclusão",
      subtitle: "Verifique o que chega ao banco antes de salvar. O pacote de defesa é o único canal voltado ao banco — o DisputeDesk não envia campos de provas estruturados ao Shopify.",
      groups: {
        usedAsBankArgument: "Usado como argumento positivo ao banco",
        contextOnly: "Apenas contexto",
        keptInternal: "Mantido interno",
        notIncluded: "Não incluído",
        excludedByMerchant: "Excluído por você",
      },
      groupHelpers: {
        usedAsBankArgument: "Provas que a narrativa de defesa cita como prova decisiva. Somente leitura — adicionar ou remover provas decisivas exige alterar o conteúdo subjacente.",
        contextOnly: "Contexto de fundo no pacote. Somente leitura — o sistema decide se cada item se eleva a prova decisiva.",
        keptInternal: "Sinais que poderiam enfraquecer o caso se apresentados ao banco. Promovê-los exige um fluxo de confirmação não disponível na Fase 1.",
        notIncluded: "Itens no arquivo, mas não no pacote. Linhas seguras podem ser incluídas manualmente como contexto de apoio (nunca como prova decisiva).",
        excludedByMerchant: "Itens que você excluiu explicitamente. Remova a substituição para restaurar o estado natural.",
      },
      toggle: {
        include: "Incluir no pacote",
        restore: "Restaurar padrão",
        disabledInternalOnly: "Promover um sinal apenas interno para o banco exige um fluxo de confirmação ainda não disponível.",
        disabledNoPayload: "Nada para incluir — os dados desta linha vêm de uma fonte fora do controle do DisputeDesk (o gateway de pagamento, a transportadora ou o motor de risco do Shopify).",
      },
      emptyGroup: "—",
      emptyAll: "Nenhuma linha de prova está disponível ainda para esta disputa. Gere ou reconstrua o pacote de defesa para preencher esta seção.",
      errorOverride: "Não foi possível atualizar a inclusão ({code}). Tente novamente.",
      errorOverrideNeedsConfirmation: "Este sinal exige um fluxo de confirmação ainda não disponível. A Fase 2 adicionará o aviso e o registro de auditoria da substituição.",
    },
    packageStatus: {
      included: "Incluído no pacote de defesa",
      internal_only: "Apenas interno",
      not_included: "Não incluído",
      not_supported: "Não suportado",
      excluded: "Excluído",
      failed_upload: "Falha no upload",
      waived: "Marcado como não aplicável",
    },
    bankArgumentStatus: {
      used: "Usado como argumento ao banco",
      context_only: "Apenas contexto",
      not_used: "Não usado no argumento ao banco",
    },
  },

  sv: {
    overview: {
      monitoring: {
        title: "DisputeDesk övervakar denna order",
        bodyWithDeadline: "Om leveransspårning, leveransbekräftelse, betalningsverifiering eller andra systemhärledda bevis blir tillgängliga före din deadline ({deadline}) uppdaterar DisputeDesk försvarspaketet automatiskt. Ingen åtgärd krävs från dig.",
        bodyNoDeadline: "Om leveransspårning, leveransbekräftelse, betalningsverifiering eller andra systemhärledda bevis blir tillgängliga före din deadline uppdaterar DisputeDesk försvarspaketet automatiskt. Ingen åtgärd krävs från dig.",
      },
      rowSourceCaptionPendingSystem: "Väntar på orderaktivitet — fylls i automatiskt när Shopify rapporterar det",
      timeline: {
        defencePackagePrepared: {
          titleDone: "Försvarspaket förberett",
          titleActive: "Förbereder försvarspaket",
          titlePending: "Förbered försvarspaket",
          helperDone: "DisputeDesk samlade in tillgängliga bevis för detta ärende.",
          helperActive: "Paketet förbereds.",
          helperPending: "Generera bevispaketet för att börja.",
        },
        reviewAndSubmit: {
          title: "Granska och skicka",
          helperWithDeadline: "Inlämningsdeadline: {deadline}",
          helperNoDeadline: "Granska paketet och skicka till Shopify före deadline.",
        },
        evidenceSavedToShopify: {
          title: "Bevis sparade i Shopify",
          helperWithDate: "Sparat den {savedDate}",
          helperNoDate: "Sparat i Shopify",
        },
        awaitingShopifyForwarding: {
          title: "Väntar på att Shopify vidarebefordrar till kortnätverket",
          helperWithDeadline: "Shopify vidarebefordrar bevisen till ditt kortnätverk senast deadline ({deadline}) eller tidigare om du klickar på Skicka i Shopify Admin. DisputeDesk kan inte oberoende verifiera när vidarebefordran sker.",
          helperNoDeadline: "Shopify vidarebefordrar bevisen till ditt kortnätverk senast deadline eller tidigare om du klickar på Skicka i Shopify Admin. DisputeDesk kan inte oberoende verifiera när vidarebefordran sker.",
        },
        submittedToCardNetwork: {
          title: "Skickat till kortnätverket",
          helper: "Shopify har vidarebefordrat bevisen — kortnätverket granskar nu.",
        },
        cardNetworkReview: {
          title: "Granskning av kortnätverket",
          helperActive: "Förväntad varaktighet: 30–75 dagar.",
          helperPending: "Börjar när Shopify vidarebefordrar bevisen till ditt kortnätverk.",
        },
        outcomePosted: {
          title: "Utfall publicerat i Shopify",
          helperWithOutcome: "Utfall: {outcome}",
          helperPending: "Du får ett e-postmeddelande när ett beslut fattas.",
        },
      },
      submissionSummary: {
        titlePreSave: "Vad som kommer sparas i Shopify",
        titlePostSave: "Vad som sparades i Shopify",
        subtitlePreSave: "Dessa objekt når Shopify när DisputeDesk sparar försvarspaketet.",
        subtitlePostSave: "Shopify mottog objekten nedan. PDF:en innehåller argumentet riktat till banken; strukturerade fält innehåller endast kundens identitet.",
        shopifyFieldsLabel: "Sparat som strukturerade Shopify-fält",
        shopifyFieldsHelper: "Kundnamn och e-post — de enda strukturerade fält DisputeDesk skickar. Bevis färdas inuti PDF:en.",
        shopifyFieldsCustomerFirstName: "Kundens förnamn",
        shopifyFieldsCustomerLastName: "Kundens efternamn",
        shopifyFieldsCustomerEmail: "Kundens e-post",
        shopifyFieldsNoneOnFile: "—",
        includedInPackageLabel: "Inkluderat i försvarspaketet",
        includedInPackageHelper: "Bevisfakta som visas i den PDF banken får.",
        includedInPackageEmpty: "Inga bevisfakta är inkluderade i paketet.",
        includedInPackagePdfLine: "PDF: {pdfFileName}",
        bankArgumentLabel: "Använt som positivt bankargument",
        bankArgumentHelper: "Bevis som försvarsnarrativet citerar som avgörande bevis.",
        bankArgumentEmpty: "Inga avgörande bankriktade bevis finns tillgängliga för denna tvist.",
        contextOnlyLabel: "Endast kontext",
        contextOnlyHelper: "Inkluderade i paketet som bakgrund; inte använda som avgörande bevis.",
        keptInternalLabel: "Hålls internt",
        keptInternalHelper: "Signaler som visas för att hjälpa dig förstå ärendet, men som inte ingår i argumentet till banken eftersom de kan försvaga svaret.",
        keptInternalSeeEvidenceTab: "Se fliken Bevis → Endast interna signaler för detaljer.",
        notIncludedLabel: "Ej inkluderat",
        notIncludedHelper: "Uteslutna, ej stödda eller misslyckade uppladdningar. Inget av detta når Shopify.",
        notIncludedFailedUpload: "Uppladdning misslyckades för {count, plural, =1 {1 objekt} other {# objekt}}.",
        notIncludedExcluded: "{count, plural, =1 {1 objekt} other {# objekt}} uteslutna av dig.",
        notIncludedWaived: "{count, plural, =1 {1 objekt} other {# objekt}} markerade som ej tillämpliga.",
        notIncludedNotSupported: "{count, plural, =1 {1 objekt} other {# objekt}} utan bankriktad plats.",
      },
      coverage: {
        title: "Bevistäckning",
        sectionsFound: "{count, plural, =0 {Inga bevisavsnitt hittades} =1 {1 bevisavsnitt hittades} other {# bevisavsnitt hittades}}",
        includedInPackage: "{count, plural, =0 {Inget inkluderat i försvarspaketet} =1 {1 objekt inkluderat i försvarspaketet} other {# objekt inkluderade i försvarspaketet}}",
        usedAsPositiveBankArgument: "{count, plural, =0 {0 använda som positivt bankargument} =1 {1 använt som positivt bankargument} other {# använda som positivt bankargument}}",
        keptInternal: "{count, plural, =0 {0 hålls internt} =1 {1 hålls internt} other {# hålls internt}}",
        tileSectionsFound: "Bevisavsnitt hittade",
        tileIncludedInPackage: "Inkluderat i försvarspaket",
        tileUsedAsBankArgument: "Använt som positivt bankargument",
        tileKeptInternal: "Hålls internt",
        missingDecisiveLabel: "Saknar avgörande bevis",
        missingDecisiveNone: "Alla avgörande bevis finns.",
        missingDecisiveFraud: "betalningsverifiering, bekräftad leverans, kundens köpbekräftelse",
        summarySentence: "Vi hittade {found, plural, =1 {1 bevisavsnitt} other {# bevisavsnitt}}{savedClause, select, none {} other {{savedClause}}}.{weakClause, select, none {} other { {weakClause}}}",
        savedClauseSaved: " och sparade försvarspaketet i Shopify",
        savedClauseDraft: "",
        weakClauseHardToWin: "Ärendet förblir svagt eftersom tillgängliga bevis mestadels är stödjande kontext, medan avgörande bevis för {family} saknas.",
        weakClauseNotHardToWin: "",
      },
      hero: {
        title: {
          preSubmit: {
            likely_to_win: "Starkt ärende att bestrida",
            could_win: "Granska före bestridande",
            needs_strengthening: "Granska före bestridande",
            hard_to_win: "Fullständig dokumentation, svagt försvar",
            covered: "Täcks av Shopify Protect",
          },
          saved: {
            likely_to_win: "Starkt försvar sparat i Shopify",
            could_win: "Måttligt försvar sparat i Shopify",
            needs_strengthening: "Måttligt försvar sparat i Shopify",
            hard_to_win: "Svagt försvar sparat i Shopify",
            covered: "Täcks av Shopify Protect",
          },
          awaiting: {
            likely_to_win: "Starkt försvar vidarebefordrat till Shopify",
            could_win: "Måttligt försvar vidarebefordrat till Shopify",
            needs_strengthening: "Måttligt försvar vidarebefordrat till Shopify",
            hard_to_win: "Svagt försvar vidarebefordrat till Shopify",
            covered: "Täcks av Shopify Protect",
          },
          submitted_to_network: {
            likely_to_win: "Starkt försvar skickat till kortnätverket",
            could_win: "Måttligt försvar skickat till kortnätverket",
            needs_strengthening: "Måttligt försvar skickat till kortnätverket",
            hard_to_win: "Svagt försvar skickat till kortnätverket",
            covered: "Täcks av Shopify Protect",
          },
          closed: {
            won: "Tvist vunnen",
            lost: "Tvist förlorad",
            unknown: "Tvist avslutad",
          },
        },
        subtitle: {
          draftWithReason: "{strengthReason}",
          savedWithReason: "{strengthReason} Sparat i Shopify den {savedDate}.",
          savedWithReasonAndDeadline: "{strengthReason} Sparat i Shopify den {savedDate}. Shopify vidarebefordrar bevisen till ditt kortnätverk senast deadline ({deadline}). Du kan fortsätta lägga till bevis fram till dess.",
          savedNoDate: "{strengthReason} Sparat i Shopify — väntar på att Shopify ska vidarebefordra till ditt kortnätverk.",
          awaitingForward: "{strengthReason} Shopify har paketet och vidarebefordrar det till ditt kortnätverk. DisputeDesk kan bekräfta att bevisen sparades i Shopify, men kan inte oberoende verifiera när vidarebefordran sker.",
          submittedToNetwork: "{strengthReason} Kortnätverket granskar detta försvar. Utfallet publiceras vanligen om 30–75 dagar.",
          submittedToNetworkWithDate: "Skickat till ditt kortnätverk den {submittedDate}. Utfallet publiceras vanligen om 30–75 dagar.",
          closedWon: "Utfall: vunnen{submittedDate, select, none {} other { (beslutat den {submittedDate})}}.",
          closedLost: "Utfall: förlorad{submittedDate, select, none {} other { (beslutat den {submittedDate})}}.",
          closedUnknown: "Utfall rapporterat av Shopify: {outcome}.",
        },
      },
    },
    cardholderAck: {
      title: "Lägg till bekräftelse från kortinnehavaren",
      subtitle: "Om du har ett e-postmeddelande, en chatt eller annat meddelande där kortinnehavaren bekräftar att de lade och mottog denna order, klistra in det här. Bekräftelse från kortinnehavaren är avgörande bevis i bedrägeritvister — den lyfter kundkommunikation från stödjande kontext till ett positivt bankargument.",
      textareaLabel: "Meddelande från kortinnehavaren",
      textareaPlaceholder: "Klistra in e-postmeddelandet, chatten eller meddelandet från kortinnehavaren. Inkludera datum och annan kontext som kopplar det till denna order.",
      textareaHint: "Minst 20 tecken. Texten inkluderas ordagrant i försvarspaketets PDF.",
      checkboxLabel: "Jag bekräftar att detta meddelande är från kortinnehavaren och visar att de la och/eller mottog ordern i denna tvist.",
      checkboxHelper: "Genom att kryssa i denna ruta intygar du att kortinnehavaren skrev detta meddelande. DisputeDesk registrerar bekräftelsen i tvistens granskningslogg.",
      submit: "Spara bekräftelse",
      submitting: "Sparar…",
      successTitle: "Kortinnehavarens bekräftelse sparad",
      successBody: "Kundkommunikation är nu markerad som avgörande bevis. DisputeDesk regenererar försvarspaketet — du kan granska resultatet om en stund.",
      errorTooShort: "Klistra in minst 20 tecken av kortinnehavarens meddelande.",
      errorConfirmationRequired: "Bekräfta att meddelandet är från kortinnehavaren innan du sparar.",
      errorWindowClosed: "Shopify har redan vidarebefordrat denna tvist till banken, så nya bekräftelser kan inte längre läggas till.",
      errorGeneric: "Det gick inte att spara bekräftelsen ({code}). Försök igen.",
      charCount: "{count}/{max}",
    },
    inclusion: {
      title: "Inklusionsgranskning",
      subtitle: "Verifiera vad som når banken före sparande. Försvarspaketet är den enda bankriktade kanalen — DisputeDesk skickar inte strukturerade bevisfält till Shopify.",
      groups: {
        usedAsBankArgument: "Använt som positivt bankargument",
        contextOnly: "Endast kontext",
        keptInternal: "Hålls internt",
        notIncluded: "Ej inkluderat",
        excludedByMerchant: "Uteslutet av dig",
      },
      groupHelpers: {
        usedAsBankArgument: "Bevis som försvarsnarrativet citerar som avgörande bevis. Skrivskyddat — att lägga till eller ta bort avgörande bevis kräver att den underliggande datan ändras.",
        contextOnly: "Bakgrundskontext i paketet. Skrivskyddat — systemet avgör om varje objekt höjs till avgörande bevis.",
        keptInternal: "Signaler som kan försvaga ärendet om de presenteras för banken. Att lyfta dem kräver ett bekräftelseflöde som inte är tillgängligt i fas 1.",
        notIncluded: "Objekt i akten men inte i paketet. Säkra rader kan tvångsinkluderas som stödjande kontext (aldrig som avgörande bevis).",
        excludedByMerchant: "Objekt som du uttryckligen har uteslutit. Ta bort åsidosättningen för att återställa det naturliga tillståndet.",
      },
      toggle: {
        include: "Inkludera i paket",
        restore: "Återställ standard",
        disabledInternalOnly: "Att lyfta en enbart intern signal till banken kräver ett bekräftelseflöde som inte är tillgängligt ännu.",
        disabledNoPayload: "Inget att inkludera — datan bakom denna rad kommer från en källa utanför DisputeDesks kontroll (betalningsgatewayen, transportören eller Shopifys riskmotor).",
      },
      emptyGroup: "—",
      emptyAll: "Inga bevisrader är tillgängliga ännu för denna tvist. Generera eller bygg om försvarspaketet för att fylla detta avsnitt.",
      errorOverride: "Det gick inte att uppdatera inklusion ({code}). Försök igen.",
      errorOverrideNeedsConfirmation: "Denna signal kräver ett bekräftelseflöde som inte är tillgängligt ännu. Fas 2 lägger till varningen och granskningsspåret för åsidosättningen.",
    },
    packageStatus: {
      included: "Inkluderat i försvarspaket",
      internal_only: "Endast internt",
      not_included: "Ej inkluderat",
      not_supported: "Stöds ej",
      excluded: "Uteslutet",
      failed_upload: "Uppladdning misslyckades",
      waived: "Markerat som ej tillämpligt",
    },
    bankArgumentStatus: {
      used: "Använt som bankargument",
      context_only: "Endast kontext",
      not_used: "Ej använt i bankargument",
    },
  },
};

/** Locale-family mapping. Regional variants reuse the base translation. */
const LOCALE_FAMILY = {
  "es.json": "es",
  "es-ES.json": "es",
  "fr.json": "fr",
  "fr-FR.json": "fr",
  "pt.json": "pt",
  "pt-BR.json": "pt",
  "sv.json": "sv",
  "sv-SE.json": "sv",
};

/** Deep-merge `src` into `dst` without overwriting existing keys. */
function mergePreserve(dst, src) {
  for (const k of Object.keys(src)) {
    const sv = src[k];
    if (
      sv !== null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      dst[k] !== null &&
      typeof dst[k] === "object" &&
      !Array.isArray(dst[k])
    ) {
      mergePreserve(dst[k], sv);
    } else if (!(k in dst)) {
      dst[k] = sv;
    }
  }
}

/** Strip keys that were added by an earlier run but don't exist in en.json. */
function dropOrphans(obj, allowedKeys) {
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) delete obj[k];
  }
}

function main() {
  for (const [filename, family] of Object.entries(LOCALE_FAMILY)) {
    const path = resolve(LOCALES_DIR, filename);
    const json = JSON.parse(readFileSync(path, "utf8"));
    const t = TRANSLATIONS[family];

    json.disputes = json.disputes ?? {};

    // disputes.overview
    json.disputes.overview = json.disputes.overview ?? {};
    mergePreserve(json.disputes.overview, t.overview);

    // disputes.evidenceTab.cardholderAck
    json.disputes.evidenceTab = json.disputes.evidenceTab ?? {};
    json.disputes.evidenceTab.cardholderAck =
      json.disputes.evidenceTab.cardholderAck ?? {};
    mergePreserve(json.disputes.evidenceTab.cardholderAck, t.cardholderAck);

    // disputes.evidenceTab.row.packageStatus + bankArgumentStatus
    json.disputes.evidenceTab.row = json.disputes.evidenceTab.row ?? {};
    json.disputes.evidenceTab.row.packageStatus =
      json.disputes.evidenceTab.row.packageStatus ?? {};
    mergePreserve(json.disputes.evidenceTab.row.packageStatus, t.packageStatus);
    json.disputes.evidenceTab.row.bankArgumentStatus =
      json.disputes.evidenceTab.row.bankArgumentStatus ?? {};
    mergePreserve(
      json.disputes.evidenceTab.row.bankArgumentStatus,
      t.bankArgumentStatus,
    );

    // disputes.reviewTab.inclusion — drop the orphaned `tooltip` and
    // `empty` keys from the first script run (they don't exist in en).
    json.disputes.reviewTab = json.disputes.reviewTab ?? {};
    json.disputes.reviewTab.inclusion = json.disputes.reviewTab.inclusion ?? {};
    delete json.disputes.reviewTab.inclusion.tooltip;
    delete json.disputes.reviewTab.inclusion.empty;
    mergePreserve(json.disputes.reviewTab.inclusion, t.inclusion);

    writeFileSync(path, JSON.stringify(json, null, 2) + "\n", "utf8");
    console.log(`  filled ${filename}`);
  }
}

main();
