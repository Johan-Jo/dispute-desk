/**
 * Send "new dispute detected" email to the merchant.
 *
 * Triggered in syncDisputes when a dispute is upserted for the first time,
 * or from evaluateAndMaybeAutoSave when a review-mode build finishes
 * (see claimAndSendDeferredNewDisputeReviewAlert). Checks the `newDispute`
 * notification preference before sending.
 *
 * The email body is selected by `variant`:
 *   - "auto"   → "we handled it automatically" confirmation (submission already happened)
 *   - "review" → "your response is ready, please review and submit" call-to-action.
 *     REVIEW MODE ONLY: nothing is ever sent without the merchant.
 *   - "held"   → auto-pilot held this case back. It is NOT waiting for a
 *     decision the way a review-mode dispute is: the deadline cron saves it to
 *     Shopify on the due date regardless. Added 2026-07-29, because the park
 *     and block branches of the pipeline were sending the "review" body — so
 *     an auto-pilot merchant was told "this dispute still requires your
 *     decision" about a dispute that would submit itself.
 *
 * The `held` body was rewritten 2026-08-02. It still said "review and submit"
 * and offered "concede it if it isn't worth defending" — two instructions an
 * Auto-pilot merchant cannot act on: the dispute page renders the
 * approve/hold/concede block only for a review-mode approval gate, and
 * conceding withholds our package without stopping Shopify from filing its own
 * scraped order data. It now describes the hold (we keep collecting; we save on
 * the due date; nothing is required) and names the ONE contribution that can
 * change the outcome — a cardholder acknowledgement — but only when
 * `lib/disputes/heldState` says the acknowledgement card would really render
 * for this dispute.
 *
 * Callers must pass the variant their automation pipeline actually resolved to
 * (after normalizeMode). Legacy modes should never reach this function.
 *
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { getServiceClient } from "@/lib/supabase/server";
import { fetchShopDetails } from "@/lib/shopify/shopDetails";
import type { AutomationMode } from "@/lib/rules/normalizeMode";
import {
  merchantSuppliedAcknowledgementFromItems,
  resolveHeldState,
  type HeldState,
} from "@/lib/disputes/heldState";

// Env vars are read lazily so tests can stub `process.env.RESEND_API_KEY`
// in beforeEach() and have the new value picked up — the previous module-
// level `const` captured the value at import time, which made test stubs
// silently no-op against the real env.
const getResendApiKey = (): string | undefined => process.env.RESEND_API_KEY;
const getFromEmail = (): string =>
  process.env.EMAIL_FROM ??
  "DisputeDesk <notifications@mail.disputedesk.app>";
const getReplyTo = (): string =>
  process.env.EMAIL_REPLY_TO ??
  "DisputeDesk <notifications@mail.disputedesk.app>";

export interface NewDisputeAlertContext {
  shopId: string;
  disputeId: string;
  reason: string | null;
  phase: string | null;
  amount: number | null;
  currencyCode: string | null;
  dueAt: string | null;
  orderName: string | null;
  /**
   * Resolved automation mode for this dispute. Determines which email
   * variant is sent. Must already be normalized to "auto" | "review".
   */
  resolvedMode: NewDisputeAlertVariant;
  /**
   * Shopify DisputeEvidence GID (e.g. `gid://shopify/DisputeEvidence/10484056121`).
   * Used to build the "Submit in Shopify Admin" secondary CTA shown in the
   * AUTO variant. When absent (or when the shop domain isn't available) the
   * email gracefully falls back to a single primary CTA.
   */
  shopifyDisputeEvidenceGid?: string | null;
  /**
   * Auto-pilot hold facts (lib/disputes/heldState) — the same derivation the
   * dispute page renders from. Drives the conditional "one thing you can add"
   * block in the HELD variant. Absent/held:false → no ask is printed.
   */
  held?: HeldState | null;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface SharedStrings {
  reason: string;
  amount: string;
  order: string;
  due: string;
  phaseHintInquiry: string;
  phaseHintChargeback: string;
  /**
   * HELD variant only. The standard hints are instructions to the merchant
   * ("respond quickly", "evidence must be submitted before the deadline") —
   * on a held Auto-pilot dispute the responding is ours to do, and printing
   * an instruction under a body that just said "nothing is required from you"
   * contradicts it. These say the same facts as statements.
   */
  phaseHintInquiryHeld: string;
  phaseHintChargebackHeld: string;
  footer: string;
}

interface ModeStrings {
  /** Subject line. Receives the dispute short id and the order name (if any). */
  subject: (p: { shortId: string; orderName: string | null }) => string;
  heading: string;
  /** First paragraph of body copy. Receives the order name (already HTML-safe). */
  bodyP1: (p: { orderName: string }) => string;
  /** Label above the "what happened / what to do next" list. */
  listLabel: string;
  /** List rows. For `auto` these are past-tense steps; for `review` these are next-action steps. */
  listItems: string[];
  /**
   * Optional callout shown below the list. `body` may be a plain string or a
   * function receiving the formatted due date — the AUTO variant uses the
   * function form to embed the Shopify forwarding date in the copy, while
   * every other locale/variant still uses a plain string.
   */
  callout?: {
    label: string;
    body: string | ((p: { dueDate: string }) => string);
  };
  cta: string;
  /**
   * Optional secondary CTA label. When present AND the caller supplied a
   * valid Shopify admin URL, the email renders a second (outlined) button
   * linking directly to the dispute in Shopify Admin. Currently only the
   * English AUTO variant opts in.
   */
  ctaSecondary?: string;
  /**
   * HELD variant only — the single contribution a held case can take.
   * Printed ONLY when `heldState.offer` is set, i.e. when the dispute page
   * would really show the acknowledgement card.
   *
   *   flips — the case is Moderate, so a cardholder confirmation makes it
   *           Strong and it saves immediately. We may promise that.
   *   plain — the case is Weak; the acknowledgement still helps but does not
   *           on its own reach the auto-save bar. No promise.
   */
  ask?: { flips: string; plain: string; cta: string };
}

/**
 * Which body to send. Not the same axis as `AutomationMode`: "held" is auto
 * mode, holding a case that the deadline will submit anyway.
 */
export type NewDisputeAlertVariant = AutomationMode | "held";

interface EmailStrings {
  shared: SharedStrings;
  auto: ModeStrings;
  review: ModeStrings;
  held: ModeStrings;
}

const STRINGS: Record<Locale, EmailStrings> = {
  en: {
    shared: {
      reason: "Reason",
      amount: "Amount",
      order: "Order",
      due: "Response due",
      phaseHintInquiry:
        "This is a soft inquiry — respond quickly to prevent escalation to a chargeback.",
      phaseHintChargeback: "Evidence must be submitted before the deadline.",
      phaseHintInquiryHeld:
        "This is a soft inquiry. Saving your response before the deadline is what stops it escalating to a chargeback — we handle that.",
      phaseHintChargebackHeld:
        "Chargeback deadlines are set by the card network. We save your response to Shopify before yours passes.",
      footer:
        "You received this because new-dispute alerts are enabled in DisputeDesk settings.",
    },
    auto: {
      subject: ({ shortId }) => `Dispute #${shortId} was handled automatically`,
      heading: "We detected a dispute and handled it automatically",
      bodyP1: ({ orderName }) =>
        `A new dispute was detected for order ${orderName}. Based on your automation settings, DisputeDesk prepared and submitted the response automatically.`,
      listLabel: "What happened",
      listItems: [
        "We collected the available evidence",
        "We prepared the response",
        "We submitted it to Shopify on your behalf",
      ],
      callout: {
        label: "What happens next",
        body: ({ dueDate }) =>
          // NOT "you can submit directly in Shopify Admin to resolve it
          // sooner". `composeShopifyMutationPayload` sends
          // `submitEvidence: true`, so the response is already filed — there
          // is no pending submit button, and pointing a merchant at one sends
          // them looking for something that isn't there. The five other
          // locales already said this correctly.
          `Shopify has your response and will pass it to the card network by <b>${dueDate}</b>. No action is required — you can open the dispute in DisputeDesk to see exactly what was sent.`,
      },
      cta: "Open in DisputeDesk →",
      ctaSecondary: "View in Shopify Admin ↗",
    },
    review: {
      subject: ({ shortId }) => `Dispute #${shortId} is ready for your review`,
      heading: "Your response is ready — review and submit",
      bodyP1: ({ orderName }) =>
        `A new dispute was detected for order ${orderName}. DisputeDesk has prepared your response, but it has not been submitted yet.`,
      listLabel: "What to do next",
      listItems: [
        "Open the dispute and review the prepared evidence",
        "Schedule it to submit automatically on the deadline",
        "Or hold it while you look into it — we'll remind you",
        "Or concede it if it isn't worth defending",
      ],
      callout: {
        label: "Important",
        body: "Nothing has been submitted yet. If you take no action, we never send your prepared response — Shopify files only the basic order details it holds when the deadline passes.",
      },
      cta: "Review dispute →",
    },
    held: {
      subject: ({ shortId }) => `Dispute #${shortId} — response prepared and held`,
      heading: "Your response is ready — held while we look for stronger evidence",
      bodyP1: ({ orderName }) =>
        `A new dispute was detected for order ${orderName}. DisputeDesk prepared your response. The evidence we have supports it but isn't decisive yet, so we're holding it and watching your connected sources for anything stronger.`,
      listLabel: "What happens next",
      listItems: [
        "We keep collecting from Shopify, your carrier and your payment data, and rebuild the response automatically if something stronger arrives",
        "If nothing changes, we save this response to Shopify on the due date",
        "Nothing is required from you",
      ],
      callout: {
        label: "No action needed",
        body: ({ dueDate }) =>
          `Nothing has been saved yet. If you do nothing, we save this response to Shopify on <b>${dueDate}</b>.`,
      },
      ask: {
        flips:
          "One thing can still change this: if you have an email or chat in which the cardholder confirms they placed and received this order, paste it in. A confirmation from the cardholder is decisive — with it, this case is strong enough for us to save it to Shopify straight away.",
        plain:
          "One thing can still change this: if you have an email or chat in which the cardholder confirms they placed and received this order, paste it in. A confirmation from the cardholder is the strongest single piece of evidence you can add to this case.",
        cta: "Add cardholder acknowledgement →",
      },
      cta: "View dispute →",
    },
  },
  es: {
    shared: {
      reason: "Razón",
      amount: "Monto",
      order: "Pedido",
      due: "Fecha límite",
      phaseHintInquiry:
        "Esta es una consulta suave — responde rápido para evitar que escale a un chargeback.",
      phaseHintChargeback: "La evidencia debe enviarse antes de la fecha límite.",
      phaseHintInquiryHeld:
        "Esta es una consulta suave. Guardar tu respuesta antes de la fecha límite es lo que evita que escale a un chargeback: nosotros nos encargamos.",
      phaseHintChargebackHeld:
        "Las fechas límite de los chargebacks las fija la red de tarjetas. Guardamos tu respuesta en Shopify antes de que venza la tuya.",
      footer:
        "Recibiste esto porque las alertas de nuevas disputas están activadas en la configuración de DisputeDesk.",
    },
    auto: {
      subject: ({ shortId }) => `Disputa #${shortId} gestionada automáticamente`,
      heading: "Detectamos una disputa y la gestionamos automáticamente",
      bodyP1: ({ orderName }) =>
        `Se detectó una nueva disputa para el pedido ${orderName}. Según tu configuración de automatización, DisputeDesk preparó y envió la respuesta automáticamente.`,
      listLabel: "Qué hicimos",
      listItems: [
        "Recopilamos la evidencia disponible",
        "Preparamos la respuesta",
        "La enviamos en tu nombre",
      ],
      callout: {
        label: "Qué hacer ahora",
        body: "No se requiere acción. Puedes abrir la disputa en DisputeDesk para ver lo que se envió.",
      },
      cta: "Abrir disputa →",
    },
    review: {
      subject: ({ shortId }) => `Disputa #${shortId} lista para tu revisión`,
      heading: "Tu respuesta está lista — revisa y envía",
      bodyP1: ({ orderName }) =>
        `Se detectó una nueva disputa para el pedido ${orderName}. DisputeDesk preparó tu respuesta, pero aún no se ha enviado.`,
      listLabel: "Qué hacer ahora",
      listItems: [
        "Abre la disputa y revisa la evidencia preparada",
        "Prográmala para enviarse automáticamente en la fecha límite",
        "O mantenla en revisión mientras la analizas: te lo recordaremos",
        "O concédela si no vale la pena defenderla",
      ],
      callout: {
        label: "Importante",
        body: "Todavía no se ha enviado nada. Si no haces nada, nunca enviaremos tu respuesta preparada: Shopify solo transmite los datos básicos del pedido cuando vence el plazo.",
      },
      cta: "Revisar disputa →",
    },
    held: {
      subject: ({ shortId }) => `Disputa #${shortId} — respuesta preparada y retenida`,
      heading: "Tu respuesta está lista — retenida mientras buscamos pruebas más sólidas",
      bodyP1: ({ orderName }) =>
        `Se detectó una nueva disputa para el pedido ${orderName}. DisputeDesk preparó tu respuesta. Las pruebas que tenemos la respaldan, pero aún no son decisivas, así que la retenemos y seguimos vigilando tus fuentes conectadas por si aparece algo más sólido.`,
      listLabel: "Qué pasa después",
      listItems: [
        "Seguimos recopilando datos de Shopify, tu transportista y tus pagos, y reconstruimos la respuesta automáticamente si llega algo más sólido",
        "Si nada cambia, guardaremos esta respuesta en Shopify en la fecha límite",
        "No necesitas hacer nada",
      ],
      callout: {
        label: "No se requiere ninguna acción",
        body: ({ dueDate }) =>
          `Todavía no se ha guardado nada. Si no haces nada, guardaremos esta respuesta en Shopify el <b>${dueDate}</b>.`,
      },
      ask: {
        flips:
          "Aún hay algo que puede cambiar esto: si tienes un correo o chat en el que el titular de la tarjeta confirma que hizo y recibió este pedido, pégalo aquí. La confirmación del titular es decisiva: con ella, este caso es lo bastante sólido como para que lo guardemos en Shopify de inmediato.",
        plain:
          "Aún hay algo que puede cambiar esto: si tienes un correo o chat en el que el titular de la tarjeta confirma que hizo y recibió este pedido, pégalo aquí. La confirmación del titular es la prueba más fuerte que puedes añadir a este caso.",
        cta: "Añadir confirmación del titular →",
      },
      cta: "Ver disputa →",
    },
  },
  pt: {
    shared: {
      reason: "Razão",
      amount: "Valor",
      order: "Pedido",
      due: "Prazo de resposta",
      phaseHintInquiry:
        "Esta é uma consulta leve — responda rapidamente para evitar que escale para um chargeback.",
      phaseHintChargeback: "A evidência deve ser enviada antes do prazo.",
      phaseHintInquiryHeld:
        "Esta é uma consulta leve. Guardar a sua resposta antes do prazo é o que evita a escalada para um chargeback — tratamos disso.",
      phaseHintChargebackHeld:
        "Os prazos de chargeback são definidos pela rede de cartões. Guardamos a sua resposta no Shopify antes de o seu terminar.",
      footer:
        "Você recebeu isto porque os alertas de novas disputas estão ativados nas configurações do DisputeDesk.",
    },
    auto: {
      subject: ({ shortId }) => `Disputa #${shortId} tratada automaticamente`,
      heading: "Detectamos uma disputa e tratamos automaticamente",
      bodyP1: ({ orderName }) =>
        `Uma nova disputa foi detectada para o pedido ${orderName}. Com base nas suas configurações de automação, o DisputeDesk preparou e enviou a resposta automaticamente.`,
      listLabel: "O que fizemos",
      listItems: [
        "Coletamos as evidências disponíveis",
        "Preparamos a resposta",
        "Enviamos em seu nome",
      ],
      callout: {
        label: "O que fazer agora",
        body: "Nenhuma ação é necessária. Você pode abrir a disputa no DisputeDesk para revisar o que foi enviado.",
      },
      cta: "Abrir disputa →",
    },
    review: {
      subject: ({ shortId }) => `Disputa #${shortId} pronta para sua revisão`,
      heading: "Sua resposta está pronta — revise e envie",
      bodyP1: ({ orderName }) =>
        `Uma nova disputa foi detectada para o pedido ${orderName}. O DisputeDesk preparou sua resposta, mas ela ainda não foi enviada.`,
      listLabel: "O que fazer agora",
      listItems: [
        "Abra a disputa e revise as evidências preparadas",
        "Agende o envio automático no prazo",
        "Ou mantenha em análise enquanto investiga — nós lembramos você",
        "Ou desista dela se não valer a pena defender",
      ],
      callout: {
        label: "Importante",
        body: "Nada foi enviado ainda. Se não fizer nada, nunca enviaremos a sua resposta preparada — o Shopify apenas transmite os dados básicos da encomenda quando o prazo terminar.",
      },
      cta: "Revisar disputa →",
    },
    held: {
      subject: ({ shortId }) => `Disputa #${shortId} — resposta preparada e retida`,
      heading: "A sua resposta está pronta — retida enquanto procuramos provas mais fortes",
      bodyP1: ({ orderName }) =>
        `Foi detetada uma nova disputa para a encomenda ${orderName}. O DisputeDesk preparou a sua resposta. As provas que temos sustentam-na, mas ainda não são decisivas, por isso mantemo-la retida e continuamos a vigiar as suas fontes ligadas à procura de algo mais forte.`,
      listLabel: "O que acontece a seguir",
      listItems: [
        "Continuamos a recolher dados do Shopify, da transportadora e dos pagamentos, e reconstruímos a resposta automaticamente se surgir algo mais forte",
        "Se nada mudar, guardamos esta resposta no Shopify no prazo",
        "Não é necessária qualquer ação da sua parte",
      ],
      callout: {
        label: "Não é necessária qualquer ação",
        body: ({ dueDate }) =>
          `Ainda não foi guardado nada. Se não fizer nada, guardamos esta resposta no Shopify a <b>${dueDate}</b>.`,
      },
      ask: {
        flips:
          "Ainda há algo que pode mudar isto: se tiver um e-mail ou chat em que o titular do cartão confirma que fez e recebeu esta encomenda, cole-o aqui. A confirmação do titular é decisiva — com ela, este caso fica forte o suficiente para o guardarmos no Shopify de imediato.",
        plain:
          "Ainda há algo que pode mudar isto: se tiver um e-mail ou chat em que o titular do cartão confirma que fez e recebeu esta encomenda, cole-o aqui. A confirmação do titular é a prova isolada mais forte que pode acrescentar a este caso.",
        cta: "Adicionar confirmação do titular →",
      },
      cta: "Ver disputa →",
    },
  },
  fr: {
    shared: {
      reason: "Raison",
      amount: "Montant",
      order: "Commande",
      due: "Date limite",
      phaseHintInquiry:
        "Il s'agit d'une consultation — répondez rapidement pour éviter une escalade en chargeback.",
      phaseHintChargeback: "Les preuves doivent être soumises avant la date limite.",
      phaseHintInquiryHeld:
        "Il s'agit d'une consultation. Enregistrer votre réponse avant la date limite est ce qui évite l'escalade en chargeback — nous nous en chargeons.",
      phaseHintChargebackHeld:
        "Les délais de chargeback sont fixés par le réseau de cartes. Nous enregistrons votre réponse dans Shopify avant l'échéance.",
      footer:
        "Vous recevez ceci car les alertes de nouveaux litiges sont activées dans les paramètres DisputeDesk.",
    },
    auto: {
      subject: ({ shortId }) => `Litige #${shortId} traité automatiquement`,
      heading: "Nous avons détecté un litige et l'avons traité automatiquement",
      bodyP1: ({ orderName }) =>
        `Un nouveau litige a été détecté pour la commande ${orderName}. Selon vos paramètres d'automatisation, DisputeDesk a préparé et envoyé la réponse automatiquement.`,
      listLabel: "Ce que nous avons fait",
      listItems: [
        "Nous avons collecté les preuves disponibles",
        "Nous avons préparé la réponse",
        "Nous l'avons soumise en votre nom",
      ],
      callout: {
        label: "Ce que vous devez faire",
        body: "Aucune action n'est requise. Vous pouvez ouvrir le litige dans DisputeDesk pour consulter ce qui a été envoyé.",
      },
      cta: "Ouvrir le litige →",
    },
    review: {
      subject: ({ shortId }) => `Litige #${shortId} prêt à être examiné`,
      heading: "Votre réponse est prête — examinez et soumettez",
      bodyP1: ({ orderName }) =>
        `Un nouveau litige a été détecté pour la commande ${orderName}. DisputeDesk a préparé votre réponse, mais elle n'a pas encore été soumise.`,
      listLabel: "Ce que vous devez faire",
      listItems: [
        "Ouvrez le litige et examinez les preuves préparées",
        "Programmez l'envoi automatique à la date limite",
        "Ou mettez-le en attente le temps de l'examiner — nous vous le rappellerons",
        "Ou renoncez à le défendre si cela n'en vaut pas la peine",
      ],
      callout: {
        label: "Important",
        body: "Rien n'a encore été soumis. Si vous ne faites rien, nous n'enverrons jamais votre réponse préparée — Shopify ne transmettra que les informations de commande de base à l'échéance.",
      },
      cta: "Examiner le litige →",
    },
    held: {
      subject: ({ shortId }) => `Litige #${shortId} — réponse préparée et mise en attente`,
      heading: "Votre réponse est prête — mise en attente le temps de trouver des preuves plus solides",
      bodyP1: ({ orderName }) =>
        `Un nouveau litige a été détecté pour la commande ${orderName}. DisputeDesk a préparé votre réponse. Les preuves dont nous disposons la soutiennent mais ne sont pas encore décisives : nous la gardons donc en attente et surveillons vos sources connectées au cas où quelque chose de plus solide arriverait.`,
      listLabel: "Ce qui se passe ensuite",
      listItems: [
        "Nous continuons à collecter les données Shopify, transporteur et paiement, et reconstruisons la réponse automatiquement si un élément plus solide arrive",
        "Si rien ne change, nous enregistrons cette réponse dans Shopify à la date limite",
        "Aucune action n'est requise de votre part",
      ],
      callout: {
        label: "Aucune action requise",
        body: ({ dueDate }) =>
          `Rien n'a encore été enregistré. Si vous n'intervenez pas, nous enregistrerons cette réponse dans Shopify le <b>${dueDate}</b>.`,
      },
      ask: {
        flips:
          "Une chose peut encore changer la donne : si vous disposez d'un e-mail ou d'un chat dans lequel le titulaire de la carte confirme avoir passé et reçu cette commande, collez-le ici. La confirmation du titulaire est décisive — avec elle, ce dossier est assez solide pour que nous l'enregistrions immédiatement dans Shopify.",
        plain:
          "Une chose peut encore changer la donne : si vous disposez d'un e-mail ou d'un chat dans lequel le titulaire de la carte confirme avoir passé et reçu cette commande, collez-le ici. La confirmation du titulaire est la preuve la plus forte que vous puissiez ajouter à ce dossier.",
        cta: "Ajouter la confirmation du titulaire →",
      },
      cta: "Voir le litige →",
    },
  },
  de: {
    shared: {
      reason: "Grund",
      amount: "Betrag",
      order: "Bestellung",
      due: "Frist",
      phaseHintInquiry:
        "Dies ist eine Anfrage — antworten Sie schnell, um eine Eskalation zum Chargeback zu vermeiden.",
      phaseHintChargeback: "Beweise müssen vor Ablauf der Frist eingereicht werden.",
      phaseHintInquiryHeld:
        "Dies ist eine Anfrage. Dass Ihre Antwort vor Fristablauf gespeichert wird, verhindert die Eskalation zum Chargeback — das übernehmen wir.",
      phaseHintChargebackHeld:
        "Chargeback-Fristen werden vom Kartennetzwerk gesetzt. Wir speichern Ihre Antwort in Shopify, bevor Ihre Frist abläuft.",
      footer:
        "Sie erhalten diese E-Mail, weil Benachrichtigungen für neue Reklamationen in den DisputeDesk-Einstellungen aktiviert sind.",
    },
    auto: {
      subject: ({ shortId }) => `Reklamation #${shortId} automatisch bearbeitet`,
      heading: "Wir haben eine Reklamation erkannt und automatisch bearbeitet",
      bodyP1: ({ orderName }) =>
        `Eine neue Reklamation wurde für die Bestellung ${orderName} erkannt. Gemäß Ihren Automatisierungseinstellungen hat DisputeDesk die Antwort automatisch vorbereitet und eingereicht.`,
      listLabel: "Was wir getan haben",
      listItems: [
        "Wir haben die verfügbaren Beweise gesammelt",
        "Wir haben die Antwort vorbereitet",
        "Wir haben sie in Ihrem Namen eingereicht",
      ],
      callout: {
        label: "Was Sie tun sollten",
        body: "Es ist keine Aktion erforderlich. Sie können die Reklamation in DisputeDesk öffnen, um die eingereichte Antwort zu überprüfen.",
      },
      cta: "Reklamation öffnen →",
    },
    review: {
      subject: ({ shortId }) => `Reklamation #${shortId} bereit zur Prüfung`,
      heading: "Ihre Antwort ist bereit — prüfen und einreichen",
      bodyP1: ({ orderName }) =>
        `Eine neue Reklamation wurde für die Bestellung ${orderName} erkannt. DisputeDesk hat Ihre Antwort vorbereitet, sie wurde jedoch noch nicht eingereicht.`,
      listLabel: "Was Sie tun sollten",
      listItems: [
        "Öffnen Sie die Reklamation und prüfen Sie die vorbereiteten Beweise",
        "Planen Sie die automatische Einreichung zum Fristtermin",
        "Oder halten Sie sie zur Prüfung zurück — wir erinnern Sie",
        "Oder geben Sie sie auf, wenn sie die Verteidigung nicht wert ist",
      ],
      callout: {
        label: "Wichtig",
        body: "Es wurde noch nichts eingereicht. Wenn Sie nichts tun, senden wir Ihre vorbereitete Antwort nie — Shopify übermittelt zur Frist nur die grundlegenden Bestelldaten.",
      },
      cta: "Reklamation prüfen →",
    },
    held: {
      subject: ({ shortId }) => `Reklamation #${shortId} — Antwort vorbereitet und zurückgehalten`,
      heading: "Ihre Antwort ist fertig — zurückgehalten, während wir nach stärkeren Beweisen suchen",
      bodyP1: ({ orderName }) =>
        `Für Bestellung ${orderName} wurde eine neue Reklamation erkannt. DisputeDesk hat Ihre Antwort vorbereitet. Die vorhandenen Beweise stützen sie, sind aber noch nicht entscheidend — deshalb halten wir sie zurück und beobachten Ihre verbundenen Quellen weiter auf stärkere Belege.`,
      listLabel: "Was als Nächstes passiert",
      listItems: [
        "Wir sammeln weiter Daten aus Shopify, von Ihrem Versanddienstleister und aus Ihren Zahlungen und bauen die Antwort automatisch neu auf, sobald etwas Stärkeres eintrifft",
        "Ändert sich nichts, speichern wir diese Antwort zur Frist in Shopify",
        "Von Ihnen ist nichts erforderlich",
      ],
      callout: {
        label: "Keine Aktion erforderlich",
        body: ({ dueDate }) =>
          `Es wurde noch nichts gespeichert. Wenn Sie nichts unternehmen, speichern wir diese Antwort am <b>${dueDate}</b> in Shopify.`,
      },
      ask: {
        flips:
          "Eines kann das noch ändern: Wenn Sie eine E-Mail oder einen Chat haben, in dem der Karteninhaber bestätigt, diese Bestellung aufgegeben und erhalten zu haben, fügen Sie sie hier ein. Eine Bestätigung des Karteninhabers ist entscheidend — damit ist dieser Fall stark genug, dass wir ihn sofort in Shopify speichern.",
        plain:
          "Eines kann das noch ändern: Wenn Sie eine E-Mail oder einen Chat haben, in dem der Karteninhaber bestätigt, diese Bestellung aufgegeben und erhalten zu haben, fügen Sie sie hier ein. Eine Bestätigung des Karteninhabers ist der stärkste einzelne Beleg, den Sie diesem Fall hinzufügen können.",
        cta: "Bestätigung des Karteninhabers hinzufügen →",
      },
      cta: "Reklamation ansehen →",
    },
  },
  sv: {
    shared: {
      reason: "Orsak",
      amount: "Belopp",
      order: "Order",
      due: "Svarsfrist",
      phaseHintInquiry:
        "Detta är en mjuk förfrågan — svara snabbt för att undvika eskalering till en tvist.",
      phaseHintChargeback: "Bevis måste skickas in före tidsfristen.",
      phaseHintInquiryHeld:
        "Det här är en mjuk förfrågan. Att svaret sparas före tidsfristen är det som hindrar att den eskalerar till en tvist — det sköter vi.",
      phaseHintChargebackHeld:
        "Tidsfrister för tvister sätts av kortnätverket. Vi sparar ditt svar till Shopify innan din frist löper ut.",
      footer:
        "Du fick detta eftersom aviseringar för nya tvister är aktiverade i DisputeDesk-inställningarna.",
    },
    auto: {
      subject: ({ shortId }) => `Tvist #${shortId} hanterad automatiskt`,
      heading: "Vi upptäckte en tvist och hanterade den automatiskt",
      bodyP1: ({ orderName }) =>
        `En ny tvist upptäcktes för order ${orderName}. Baserat på dina automationsinställningar förberedde och skickade DisputeDesk svaret automatiskt.`,
      listLabel: "Vad vi gjorde",
      listItems: [
        "Vi samlade in tillgänglig bevisning",
        "Vi förberedde svaret",
        "Vi skickade in det å dina vägnar",
      ],
      callout: {
        label: "Vad du ska göra",
        body: "Ingen åtgärd krävs. Du kan öppna tvisten i DisputeDesk för att granska vad som skickades.",
      },
      cta: "Öppna tvist →",
    },
    review: {
      subject: ({ shortId }) => `Tvist #${shortId} redo för din granskning`,
      heading: "Ditt svar är redo — granska och skicka in",
      bodyP1: ({ orderName }) =>
        `En ny tvist upptäcktes för order ${orderName}. DisputeDesk har förberett ditt svar, men det har inte skickats in ännu.`,
      listLabel: "Vad du ska göra",
      listItems: [
        "Öppna tvisten och granska den förberedda bevisningen",
        "Schemalägg den för att skickas in automatiskt vid tidsfristen",
        "Eller pausa den för granskning medan du tittar närmare — vi påminner dig",
        "Eller avstå från att försvara den om den inte är värd besväret",
      ],
      callout: {
        label: "Viktigt",
        body: "Inget har skickats in ännu. Om du inte gör något skickar vi aldrig ditt förberedda svar — Shopify vidarebefordrar bara de grundläggande orderuppgifterna när fristen löper ut.",
      },
      cta: "Granska tvist →",
    },
    held: {
      subject: ({ shortId }) => `Tvist #${shortId} — svar förberett och pausat`,
      heading: "Ditt svar är klart — pausat medan vi letar efter starkare bevis",
      bodyP1: ({ orderName }) =>
        `En ny tvist upptäcktes för order ${orderName}. DisputeDesk har förberett ditt svar. Bevisen vi har stöder det, men de är ännu inte avgörande, så vi håller kvar svaret och bevakar dina anslutna källor efter något starkare.`,
      listLabel: "Vad händer nu",
      listItems: [
        "Vi fortsätter samla in data från Shopify, ditt fraktbolag och dina betalningar och bygger om svaret automatiskt om något starkare dyker upp",
        "Om inget ändras sparar vi det här svaret till Shopify på förfallodagen",
        "Inget krävs av dig",
      ],
      callout: {
        label: "Ingen åtgärd krävs",
        body: ({ dueDate }) =>
          `Ingenting har sparats än. Om du inte gör något sparar vi det här svaret till Shopify den <b>${dueDate}</b>.`,
      },
      ask: {
        flips:
          "En sak kan fortfarande ändra det här: om du har ett mejl eller en chatt där kortinnehavaren bekräftar att hen lade och tog emot den här ordern, klistra in den. En bekräftelse från kortinnehavaren är avgörande — med den är ärendet starkt nog för att vi ska spara det till Shopify direkt.",
        plain:
          "En sak kan fortfarande ändra det här: om du har ett mejl eller en chatt där kortinnehavaren bekräftar att hen lade och tog emot den här ordern, klistra in den. En bekräftelse från kortinnehavaren är det enskilt starkaste bevis du kan lägga till i ärendet.",
        cta: "Lägg till kortinnehavarens bekräftelse →",
      },
      cta: "Visa tvist →",
    },
  },
};

function resolveLocale(raw: string | null | undefined): Locale {
  if (!raw) return "en";
  const base = raw.split("-")[0].toLowerCase();
  if (base in STRINGS) return base as Locale;
  return "en";
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code ?? "USD",
    }).format(amount);
  } catch {
    return `${code ?? "$"}${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function reasonLabel(reason: string | null): string {
  if (!reason) return "dispute";
  return reason.replace(/_/g, " ").toLowerCase();
}

/**
 * Shortens a dispute UUID to the first 8 characters for user-facing display.
 * Full UUIDs are noisy in subject lines; the prefix is still unique enough
 * for a merchant to correlate the email with the dispute in the app.
 */
function shortDisputeId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * Build the Shopify Admin URL where a merchant can submit the dispute
 * response directly. Expected format:
 *   https://admin.shopify.com/store/{handle}/payments/dispute_evidences/{numericId}
 *
 * Returns null if either the shop domain or evidence GID is missing or
 * malformed — the email then gracefully degrades to a single primary CTA.
 */
function getShopifyAdminUrl(
  shopDomain: string | null | undefined,
  evidenceGid: string | null | undefined,
): string | null {
  if (!shopDomain || !evidenceGid) return null;
  const handle = shopDomain.replace(/\.myshopify\.com$/i, "").trim();
  if (!handle) return null;
  const match = /\/(\d+)(?:\?.*)?$/.exec(evidenceGid);
  const numericId = match?.[1];
  if (!numericId) return null;
  return `https://admin.shopify.com/store/${handle}/payments/dispute_evidences/${numericId}`;
}

export async function sendNewDisputeAlert(
  ctx: NewDisputeAlertContext,
): Promise<void> {
  const resendApiKey = getResendApiKey();
  if (!resendApiKey) return;

  try {
    const sb = getServiceClient();

    const { data: setup } = await sb
      .from("shop_setup")
      .select("steps")
      .eq("shop_id", ctx.shopId)
      .single();

    const steps = setup?.steps as Record<
      string,
      { payload?: Record<string, unknown> }
    > | null;

    const teamPayload = steps?.team?.payload;
    const notifications = teamPayload?.notifications as {
      newDispute?: boolean;
    } | null;
    if (notifications?.newDispute === false) return;

    // Resolve the recipient. The merchant's configured team email wins; when
    // it's unset (Settings → Team not yet completed) we fall back to the
    // Shopify shop's contact/owner email via the Admin API. Without the
    // fallback the 2026-05-25 #5DF25744 incident reproduces — the alert is
    // silently skipped on shops that haven't completed onboarding yet.
    const configuredTeamEmail = teamPayload?.teamEmail as string | undefined;
    let recipient: string | null =
      configuredTeamEmail && configuredTeamEmail.trim().length > 0
        ? configuredTeamEmail
        : null;
    if (!recipient) {
      try {
        const shopDetails = await fetchShopDetails(ctx.shopId);
        const fallbackEmail = shopDetails?.email?.trim();
        if (fallbackEmail) {
          recipient = fallbackEmail;
        }
      } catch (err) {
        console.warn(
          "[email] New dispute alert: Shopify-owner fallback failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (!recipient) {
      // Silent drops are forbidden by contract — leave a breadcrumb so the
      // next incident isn't another "we thought it had sent" surprise.
      console.warn(
        "[email] New dispute alert skipped: no team email and no Shopify-owner fallback",
        { shopId: ctx.shopId, disputeId: ctx.disputeId },
      );
      return;
    }

    const storeLocale = (
      steps?.store_profile?.payload?.storeLocale as string | undefined
    ) ?? null;
    const locale = resolveLocale(storeLocale);
    const s = STRINGS[locale];
    const shared = s.shared;
    const variant = s[ctx.resolvedMode];

    const { data: shop } = await sb
      .from("shops")
      .select("shop_domain")
      .eq("id", ctx.shopId)
      .single();

    const disputeUrl = getEmbeddedAppUrl(
      shop?.shop_domain ?? null,
      `disputes/${ctx.disputeId}`,
    );
    const shopifyAdminUrl = getShopifyAdminUrl(
      shop?.shop_domain ?? null,
      ctx.shopifyDisputeEvidenceGid ?? null,
    );

    // The ask: printed ONLY when heldState says the acknowledgement card
    // would really render for this dispute. Silence is the correct output
    // otherwise — an email that invites an action the page then hides is
    // the failure this whole change is fixing.
    const askText =
      ctx.resolvedMode === "held" &&
      variant.ask &&
      ctx.held?.offer === "cardholder_acknowledgement"
        ? ctx.held.offerFlipsToStrong
          ? variant.ask.flips
          : variant.ask.plain
        : null;

    // Secondary CTA. The ask outranks the Shopify-Admin link: on a held
    // dispute there is nothing to do in Shopify Admin, and two secondary
    // buttons would split the one action we want.
    const secondaryCta: { label: string; url: string } | null =
      askText && variant.ask
        ? {
            label: variant.ask.cta,
            // Carried through `ddredirect` — app/(embedded)/app/page.tsx
            // preserves an embedded query string when it re-navigates, and
            // WorkspaceShell maps `section` to the Evidence tab while the
            // acknowledgement card expands + scrolls itself.
            url: getEmbeddedAppUrl(
              shop?.shop_domain ?? null,
              `disputes/${ctx.disputeId}?section=cardholder-ack`,
            ),
          }
        : variant.ctaSecondary && shopifyAdminUrl
          ? { label: variant.ctaSecondary, url: shopifyAdminUrl }
          : null;
    const showSecondaryCta = secondaryCta !== null;
    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);
    const reason = reasonLabel(ctx.reason);
    const phaseHint =
      ctx.resolvedMode === "held"
        ? ctx.phase === "inquiry"
          ? shared.phaseHintInquiryHeld
          : shared.phaseHintChargebackHeld
        : ctx.phase === "inquiry"
          ? shared.phaseHintInquiry
          : shared.phaseHintChargeback;
    const shortId = shortDisputeId(ctx.disputeId);
    const orderNameDisplay = ctx.orderName ?? "—";

    const subject = `[DisputeDesk] ${variant.subject({
      shortId,
      orderName: ctx.orderName,
    })}`;

    const listItemsHtml = variant.listItems
      .map(
        (item) =>
          `<li style="margin:0 0 6px;font-size:14px;color:#202223;line-height:1.5">${item}</li>`,
      )
      .join("");

    const dueDateDisplay = formatDate(ctx.dueAt);
    const calloutBody = variant.callout
      ? typeof variant.callout.body === "function"
        ? variant.callout.body({ dueDate: dueDateDisplay })
        : variant.callout.body
      : null;

    // Amber is for REVIEW only — that variant is the one where inaction has a
    // cost (nothing of ours is ever filed). A held case files itself on the
    // due date, so warning colours would contradict "no action needed".
    const warn = ctx.resolvedMode === "review";
    const calloutHtml =
      variant.callout && calloutBody !== null
        ? `
      <div style="background:${warn ? "#FEF3C7;border:1px solid #FCD34D" : "#EFF6FF;border:1px solid #BFDBFE"};border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:13px;font-weight:600;color:${warn ? "#92400E" : "#1E40AF"};margin:0 0 4px">
          ${variant.callout.label}
        </p>
        <p style="font-size:13px;color:${warn ? "#92400E" : "#1E40AF"};margin:0;line-height:1.5">
          ${calloutBody}
        </p>
      </div>`
        : "";

    // The one contribution — a plain paragraph, not a second callout box, so
    // it reads as an offer rather than another alert.
    const askHtml = askText
      ? `
      <p style="font-size:13px;color:#202223;margin:0 0 20px;line-height:1.55">
        ${askText}
      </p>`
      : "";

    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F6F6F7">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;border:1px solid #E1E3E5;padding:32px;margin-bottom:16px">
      <table style="border-collapse:collapse;margin-bottom:20px" role="presentation"><tr>
        <td style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);text-align:center;vertical-align:middle">
          <span style="color:#fff;font-size:16px;font-weight:700;line-height:32px">D</span>
        </td>
        <td style="padding-left:10px;vertical-align:middle">
          <span style="font-size:15px;font-weight:600;color:#202223">DisputeDesk</span>
        </td>
      </tr></table>

      <h1 style="font-size:20px;font-weight:600;color:#202223;margin:0 0 8px">
        ${variant.heading}
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        ${variant.bodyP1({ orderName: orderNameDisplay })}
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175;width:120px">${shared.reason}</td><td style="padding:8px 0;font-size:14px;color:#202223;font-weight:500">${reason}</td></tr>
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${shared.amount}</td><td style="padding:8px 0;font-size:14px;color:#202223;font-weight:600">${amountStr}</td></tr>
        ${ctx.orderName ? `<tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${shared.order}</td><td style="padding:8px 0;font-size:14px;color:#202223">${ctx.orderName}</td></tr>` : ""}
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${shared.due}</td><td style="padding:8px 0;font-size:14px;color:#202223">${formatDate(ctx.dueAt)}</td></tr>
      </table>

      <p style="font-size:13px;font-weight:600;color:#202223;margin:0 0 8px">
        ${variant.listLabel}
      </p>
      <ul style="margin:0 0 20px;padding-left:18px">
        ${listItemsHtml}
      </ul>

      ${calloutHtml}
      ${askHtml}

      <div style="background:${ctx.phase === "inquiry" ? "#EFF6FF;border:1px solid #BFDBFE" : "#F6F6F7;border:1px solid #E1E3E5"};border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:12px;color:${ctx.phase === "inquiry" ? "#1E40AF" : "#6D7175"};margin:0;line-height:1.5">
          ${phaseHint}
        </p>
      </div>

      ${
        showSecondaryCta
          ? `<table role="presentation" style="border-collapse:collapse;max-width:100%">
        <tr>
          <td style="padding:0 10px 0 0;vertical-align:middle;white-space:nowrap">
            <a href="${disputeUrl}" style="display:inline-block;padding:12px 20px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;white-space:nowrap">
            ${variant.cta}
            </a>
          </td>
          <td style="padding:0;vertical-align:middle;white-space:nowrap">
            <a href="${secondaryCta?.url ?? ""}" style="display:inline-block;padding:11px 19px;background:#fff;color:#1D4ED8;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;border:1px solid #1D4ED8;white-space:nowrap">
            ${secondaryCta?.label ?? ""}
            </a>
          </td>
        </tr>
      </table>`
          : `<table role="presentation" style="border-collapse:collapse">
        <tr>
          <td style="padding:0;vertical-align:middle">
            <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
            ${variant.cta}
            </a>
          </td>
        </tr>
      </table>`
      }
    </div>

    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">
      ${shared.footer}
    </p>
  </div>
</body>
</html>`;

    const text = `${variant.heading}

${variant.bodyP1({ orderName: orderNameDisplay })}

${shared.reason}: ${reason}
${shared.amount}: ${amountStr}
${ctx.orderName ? `${shared.order}: ${ctx.orderName}\n` : ""}${shared.due}: ${formatDate(ctx.dueAt)}

${variant.listLabel}:
${variant.listItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}
${variant.callout && calloutBody !== null ? `\n${variant.callout.label}: ${calloutBody.replace(/<\/?b>/g, "")}\n` : ""}${askText ? `\n${askText}\n` : ""}
${phaseHint}

${variant.cta.replace(" →", "")}: ${disputeUrl}${
      secondaryCta
        ? `\n${secondaryCta.label.replace(" ↗", "").replace(" →", "")}: ${secondaryCta.url}`
        : ""
    }

---
${shared.footer}`;

    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: getFromEmail(),
      replyTo: getReplyTo(),
      to: recipient.includes(",")
        ? recipient.split(",").map((e) => e.trim())
        : recipient,
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error(
      "[email] New dispute alert failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Claim `new_dispute_alert_sent_at` and send the new-dispute email after
 * the automated pack build has reached a terminal pipeline decision.
 *
 * `mode` controls which variant fires:
 *   - "auto"   → emitted from `evaluateAndMaybeAutoSave` ONLY when the
 *                pipeline decided to auto-save. The "we submitted it"
 *                copy is now truthful: by the time this claim resolves,
 *                the save_to_shopify job has been enqueued.
 *   - "review" → emitted when the pipeline parked the pack under a REVIEW-mode
 *                rule (and for the covered case, which reaches no other
 *                branch). "Your response is ready" is accurate.
 *   - "held"   → emitted from the auto-mode park/block branches. This function
 *                loads the pack the pipeline just evaluated and resolves
 *                `heldState` from it, so the email's ask matches what the
 *                dispute page will show.
 *
 * Why: the original sync-time send claimed "submitted automatically"
 * even when the auto-mode pipeline ended up parking or blocking the
 * pack — the merchant got a confirmation for a submission that never
 * happened. Both variants now fire ONLY after the pipeline reaches a
 * decision; the same `new_dispute_alert_sent_at` claim guarantees the
 * merchant gets exactly one new-dispute email per dispute regardless
 * of which decision branch ran.
 *
 * No-op if the alert was already sent or the claim fails.
 * Fire-and-forget friendly — use void + .catch in callers.
 */
export async function claimAndSendDeferredNewDisputeAlert(
  disputeId: string,
  mode: NewDisputeAlertVariant,
): Promise<void> {
  try {
    const sb = getServiceClient();
    const { data: row, error } = await sb
      .from("disputes")
      .update({ new_dispute_alert_sent_at: new Date().toISOString() })
      .eq("id", disputeId)
      .is("new_dispute_alert_sent_at", null)
      .select(
        "id, shop_id, reason, phase, amount, currency_code, due_at, order_name, dispute_evidence_gid, submission_state, final_outcome",
      )
      .maybeSingle();

    if (error || !row) return;

    // Held facts for the HELD variant's conditional ask. Read from the same
    // pack the pipeline just evaluated, so the email and the dispute page
    // resolve the identical state (lib/disputes/heldState). Best-effort: a
    // missing pack simply means no ask is printed.
    let held: HeldState | null = null;
    if (mode === "held") {
      const { data: packRow } = await sb
        .from("evidence_packs")
        .select("id, pack_json")
        .eq("dispute_id", disputeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Evidence items carry the acknowledgement marker; the checklist row
      // does not distinguish a merchant paste from an auto-collected note.
      const { data: itemRows } = packRow?.id
        ? await sb.from("evidence_items").select("payload").eq("pack_id", packRow.id)
        : { data: null };
      const packJson = (packRow?.pack_json ?? null) as {
        case_strength?: { overall?: string };
        coverage?: { state?: string };
        fatal_loss?: { triggered?: boolean };
        credit_already_issued?: { triggered?: boolean; coversDisputedAmount?: boolean };
      } | null;
      held = resolveHeldState({
        // The HELD variant is emitted only from auto-mode branches of the
        // pipeline, which is exactly the condition `resolveHeldState` needs.
        automationMode: "auto",
        caseStrength: packJson?.case_strength?.overall ?? null,
        coverageState: packJson?.coverage?.state ?? null,
        fatalLoss: packJson?.fatal_loss ?? null,
        creditAlreadyIssued: packJson?.credit_already_issued ?? null,
        acknowledgement: {
          merchantSuppliedAcknowledgement: merchantSuppliedAcknowledgementFromItems(
            (itemRows ?? []) as Array<{ payload?: Record<string, unknown> | null }>,
          ),
          submissionState: row.submission_state,
          finalOutcome: row.final_outcome,
        },
      });
    }

    await sendNewDisputeAlert({
      shopId: row.shop_id,
      disputeId: row.id,
      reason: row.reason,
      phase: row.phase,
      amount: row.amount,
      currencyCode: row.currency_code,
      dueAt: row.due_at,
      orderName: row.order_name,
      resolvedMode: mode,
      shopifyDisputeEvidenceGid: row.dispute_evidence_gid,
      held,
    });
  } catch (err) {
    console.error(
      `[email] Deferred new-dispute (${mode}) alert failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Backwards-compatible alias kept for any external/test callers that
 * already imported the old name. New code should call
 * `claimAndSendDeferredNewDisputeAlert(id, "review")` directly.
 */
export async function claimAndSendDeferredNewDisputeReviewAlert(
  disputeId: string,
): Promise<void> {
  return claimAndSendDeferredNewDisputeAlert(disputeId, "review");
}
