/**
 * Send "outcome posted" email to the merchant.
 *
 * Triggered by `dispatchDisputeEffects` when an `OUTCOME_DETECTED` event
 * fires — i.e. Shopify's `finalized_on` (per the dispute webhook /
 * GraphQL) flipped from null to a timestamp and the local dispute row
 * gained a `final_outcome`.
 *
 * Three variants by outcome:
 *   - "won"      → "You won this chargeback."
 *   - "lost"     → "This chargeback was lost." (no shame copy; bank's
 *                  decision is informational, not a merchant fault)
 *   - "accepted" → "This chargeback has closed." (or any other terminal
 *                  that isn't won/lost — `outcomeVariantFor` collapses
 *                  refunded / accepted / any future value here)
 *
 * The accepted copy deliberately does NOT say "closed without a submitted
 * defence response". Because the variant is a catch-all, it also reaches
 * disputes DisputeDesk did submit — including ones the deadline cron
 * submitted — so that is not something this email can know. Stating the
 * closure and the money movement is the most it can honestly claim.
 *
 * Each variant additionally has an inquiry counterpart: when the case
 * resolved while still an inquiry (phase === "inquiry"), the copy says
 * "dispute" instead of "chargeback" and the body states explicitly that
 * the case was an inquiry — calling an inquiry a "chargeback" is
 * factually wrong (K-Collective, 2026-07-16). Unknown/null phase falls
 * back to the chargeback wording, matching phaseUtils' default.
 *
 * Effect-level idempotency is handled by the dispatcher
 * (`withEffectDedup` on the OUTCOME_DETECTED event key). This helper
 * does NOT add a per-dispute claim guard because the dispatcher
 * already guarantees single-fire.
 *
 * Fire-and-forget — never throws. Gated by the team `outcome`
 * notification preference (new key, defaults to true).
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { getServiceClient } from "@/lib/supabase/server";
import { canonicalReasonCode } from "@/lib/rules/disputeReasons";
import { getMessages } from "@/lib/i18n/getMessages";
import {
  outcomeExplanationToken,
  resolveOutcomeExplanation,
} from "@/lib/disputes/outcomeExplanation";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export type OutcomeVariant = "won" | "lost" | "accepted";

export interface OutcomePostedAlertContext {
  shopId: string;
  disputeId: string;
  /** Mapped from the raw Shopify outcome. The caller is responsible for
   *  normalising; this helper trusts the input. */
  outcome: OutcomeVariant;
  reason: string | null;
  amount: number | null;
  currencyCode: string | null;
  orderName: string | null;
  /** Dispute phase at resolution. "inquiry" selects the inquiry-worded
   *  copy; null/undefined falls back to chargeback wording. */
  phase?: "inquiry" | "chargeback" | null;
  /**
   * The submitted defence package, when DisputeDesk built one. Drives the
   * "what we filed, and the likely deciding factor" paragraph — the SAME
   * sentence the dispute Overview header renders, from the same
   * derivation, so a merchant who reads the email and then opens the app
   * cannot be shown two different explanations of one decision.
   *
   * Its PRESENCE is what says we defended the case. `submission_state`
   * cannot be used for that: it is also true on ~390 historical imports
   * back-filled at install, which closed before the app existed.
   *
   * Omit (or pass null) and the email keeps its existing wording exactly.
   */
  defencePackage?: { submittedAt: string | null; facts: unknown } | null;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface VariantStrings {
  subject: (p: { shortId: string; orderName: string | null }) => string;
  heading: string;
  /** Body paragraphs, joined into `<p>` blocks in render. Splitting at the
   *  data layer keeps the prose readable in source and lets each variant
   *  control its own paragraphing without HTML escaping tricks. */
  body: string[];
  /** Label of the amount row — context-specific so a "won" email surfaces
   *  "Amount protected" vs. a "lost" email's "Amount lost." Aligns with
   *  the variant's emotional register. */
  amountLabel: string;
  cta: string;
  /** One-line summary rendered as a small caption inside the card,
   *  below the CTA — gives the merchant a scannable "what just
   *  happened" line they can take in at a glance. Optional. */
  resultLine?: string;
}

interface LocaleStrings {
  won: VariantStrings;
  lost: VariantStrings;
  accepted: VariantStrings;
  /** Copy used when the case resolved while still an inquiry — says
   *  "dispute", never "chargeback", and names the inquiry explicitly. */
  inquiry: {
    won: VariantStrings;
    lost: VariantStrings;
    accepted: VariantStrings;
  };
  shared: {
    reason: string;
    order: string;
    footer: string;
  };
}

// English is the primary; other locales fall back here per the same
// rule the new-dispute alert uses. Translations can land in a follow-up
// (the message bundle is structurally identical to the new-dispute
// alert, so a future copy run can pick them up together).
const STRINGS: Record<Locale, LocaleStrings> = {
  en: {
    shared: {
      reason: "Reason",
      order: "Order",
      footer:
        "You're receiving this because outcome notifications are enabled for your DisputeDesk team. Manage your preferences in the embedded app under Team settings.",
    },
    // Three emotional registers, deliberately distinct:
    //   - won: celebratory + confident
    //   - lost: calm + factual, no blame language
    //   - accepted: operational + neutral; no jargon
    won: {
      subject: ({ shortId, orderName }) =>
        `You won the chargeback on ${orderName ?? `dispute ${shortId}`}`,
      heading: "You won this chargeback",
      body: [
        "Good news — the card network accepted your defence package and ruled this dispute in your favour.",
        "The disputed amount remains with you, and any temporary debit should be reversed by your processor according to their normal payout timing.",
        "Your case record stays in DisputeDesk, including the evidence submitted, timeline, and outcome, so your team can review what worked and reuse the pattern for future disputes.",
      ],
      amountLabel: "Amount protected",
      cta: "View winning case",
      resultLine: "Result: Defence accepted · Funds retained",
    },
    lost: {
      subject: ({ shortId, orderName }) =>
        `This chargeback was lost — ${orderName ?? `dispute ${shortId}`}`,
      heading: "This chargeback was not won",
      body: [
        "The card network sided with the cardholder, and the disputed amount has been deducted from your payout.",
        "This decision is final for this dispute, so there is no further action to take. The case will remain in DisputeDesk with the submitted evidence, timeline, and outcome so your team can review what happened and identify ways to strengthen future defences.",
      ],
      amountLabel: "Amount lost",
      cta: "Review the case",
      resultLine: "Result: Cardholder won · Funds deducted",
    },
    accepted: {
      subject: ({ shortId, orderName }) =>
        `Chargeback closed on ${orderName ?? `dispute ${shortId}`}`,
      heading: "This chargeback has closed",
      body: [
        "This dispute has now closed. The disputed amount has settled with the cardholder.",
        "There is nothing further to do on this case, but DisputeDesk will keep the record available so your team can review the timeline, see what evidence was available, and improve future dispute handling.",
      ],
      amountLabel: "Amount settled with cardholder",
      cta: "View case record",
      resultLine: "Result: Closed",
    },
    inquiry: {
      won: {
        subject: ({ shortId, orderName }) =>
          `You won the dispute on ${orderName ?? `dispute ${shortId}`}`,
        heading: "You won this dispute",
        body: [
          "Good news — this case was an inquiry, not a chargeback: the payment provider asked for more information before deciding whether to raise a formal chargeback. Your response satisfied them, and the case has been resolved in your favour.",
          "The disputed amount remains with you, and the case closed without escalating to a chargeback.",
          "Your case record stays in DisputeDesk, including the evidence submitted, timeline, and outcome, so your team can review what worked and reuse the pattern for future disputes.",
        ],
        amountLabel: "Amount protected",
        cta: "View winning case",
        resultLine: "Result: Inquiry resolved in your favour · Funds retained",
      },
      lost: {
        subject: ({ shortId, orderName }) =>
          `This dispute was lost — ${orderName ?? `dispute ${shortId}`}`,
        heading: "This dispute was not won",
        body: [
          "This case was an inquiry, not a chargeback: the payment provider asked for more information before making a decision. The case has been resolved against you, and the disputed amount has been deducted from your payout.",
          "This decision is final for this case, so there is no further action to take. The case will remain in DisputeDesk with the submitted evidence, timeline, and outcome so your team can review what happened and identify ways to strengthen future responses.",
        ],
        amountLabel: "Amount lost",
        cta: "Review the case",
        resultLine: "Result: Resolved against you · Funds deducted",
      },
      accepted: {
        subject: ({ shortId, orderName }) =>
          `Dispute closed on ${orderName ?? `dispute ${shortId}`}`,
        heading: "This dispute has closed",
        body: [
          "This case was an inquiry, not a chargeback: the payment provider asked for more information before deciding whether to escalate. The case has now closed, and the disputed amount has settled with the customer.",
          "There is nothing further to do on this case, but DisputeDesk will keep the record available so your team can review the timeline, see what evidence was available, and improve future dispute handling.",
        ],
        amountLabel: "Amount settled with customer",
        cta: "View case record",
        resultLine: "Result: Closed · No response submitted",
      },
    },
  },
  de: {
    shared: {
      reason: "Grund",
      order: "Bestellung",
      footer:
        "Sie erhalten diese Nachricht, weil Ausgangs­benachrichtigungen für Ihr DisputeDesk-Team aktiviert sind. Verwalten Sie Ihre Präferenzen in der eingebetteten App unter den Team-Einstellungen.",
    },
    won: {
      subject: ({ shortId, orderName }) =>
        `Sie haben den Rückbuchungs­fall zu ${orderName ?? `Streitfall ${shortId}`} gewonnen`,
      heading: "Sie haben diesen Rückbuchungs­fall gewonnen",
      body: [
        "Gute Nachrichten — das Kartennetzwerk hat Ihr Verteidigungspaket akzeptiert und in diesem Streitfall zu Ihren Gunsten entschieden.",
        "Der strittige Betrag bleibt bei Ihnen, und etwaige vorläufige Belastungen sollten von Ihrem Zahlungs­abwickler gemäß dessen üblichem Auszahlungs­takt zurück­gebucht werden.",
        "Der Fall bleibt in DisputeDesk gespeichert — einschließlich der eingereichten Beweise, der Zeitlinie und des Ergebnisses —, damit Ihr Team analysieren kann, was funktioniert hat, und das Muster für künftige Streitfälle wiederverwenden kann.",
      ],
      amountLabel: "Geschützter Betrag",
      cta: "Gewonnenen Fall ansehen",
      resultLine: "Ergebnis: Verteidigung akzeptiert · Mittel behalten",
    },
    lost: {
      subject: ({ shortId, orderName }) =>
        `Rückbuchungs­fall verloren — ${orderName ?? `Streitfall ${shortId}`}`,
      heading: "Dieser Rückbuchungs­fall wurde nicht gewonnen",
      body: [
        "Das Kartennetzwerk hat sich auf die Seite des Karten­inhabers gestellt, und der strittige Betrag wurde von Ihrer Auszahlung abgezogen.",
        "Diese Entscheidung ist für diesen Streitfall endgültig, es ist keine weitere Maßnahme erforderlich. Der Fall bleibt in DisputeDesk mit den eingereichten Beweisen, der Zeitlinie und dem Ergebnis verfügbar, damit Ihr Team prüfen kann, was passiert ist, und künftige Verteidigungen stärken kann.",
      ],
      amountLabel: "Verlorener Betrag",
      cta: "Fall überprüfen",
      resultLine: "Ergebnis: Karten­inhaber gewonnen · Mittel abgezogen",
    },
    accepted: {
      subject: ({ shortId, orderName }) =>
        `Rückbuchungs­fall geschlossen — ${orderName ?? `Streitfall ${shortId}`}`,
      heading: "Dieser Rückbuchungs­fall wurde geschlossen",
      body: [
        "Dieser Streitfall wurde geschlossen. Der strittige Betrag wurde an den Karten­inhaber abgeführt.",
        "Für diesen Fall ist keine weitere Maßnahme erforderlich. DisputeDesk bewahrt den Datensatz auf, damit Ihr Team die Zeitlinie einsehen, verfügbare Beweise prüfen und die Bearbeitung künftiger Streitfälle verbessern kann.",
      ],
      amountLabel: "An Karten­inhaber abgeführter Betrag",
      cta: "Akteneintrag ansehen",
      resultLine: "Ergebnis: Geschlossen",
    },
    inquiry: {
      won: {
        subject: ({ shortId, orderName }) =>
          `Sie haben den Streitfall zu ${orderName ?? `Streitfall ${shortId}`} gewonnen`,
        heading: "Sie haben diesen Streitfall gewonnen",
        body: [
          "Gute Nachrichten — dieser Fall war eine Anfrage, keine Rückbuchung: Der Zahlungsanbieter hat zusätzliche Informationen angefordert, bevor über eine formelle Rückbuchung entschieden wird. Ihre Antwort war überzeugend, und der Fall wurde zu Ihren Gunsten entschieden.",
          "Der strittige Betrag bleibt bei Ihnen, und der Fall wurde geschlossen, ohne zu einer Rückbuchung zu eskalieren.",
          "Der Fall bleibt in DisputeDesk gespeichert — einschließlich der eingereichten Beweise, der Zeitlinie und des Ergebnisses —, damit Ihr Team analysieren kann, was funktioniert hat, und das Muster für künftige Streitfälle wiederverwenden kann.",
        ],
        amountLabel: "Geschützter Betrag",
        cta: "Gewonnenen Fall ansehen",
        resultLine: "Ergebnis: Anfrage zu Ihren Gunsten entschieden · Mittel behalten",
      },
      lost: {
        subject: ({ shortId, orderName }) =>
          `Streitfall verloren — ${orderName ?? `Streitfall ${shortId}`}`,
        heading: "Dieser Streitfall wurde nicht gewonnen",
        body: [
          "Dieser Fall war eine Anfrage, keine Rückbuchung: Der Zahlungsanbieter hat zusätzliche Informationen angefordert, bevor eine Entscheidung getroffen wird. Der Fall wurde zu Ihren Ungunsten entschieden, und der strittige Betrag wurde von Ihrer Auszahlung abgezogen.",
          "Diese Entscheidung ist für diesen Fall endgültig, es ist keine weitere Maßnahme erforderlich. Der Fall bleibt in DisputeDesk mit den eingereichten Beweisen, der Zeitlinie und dem Ergebnis verfügbar, damit Ihr Team prüfen kann, was passiert ist, und künftige Antworten stärken kann.",
        ],
        amountLabel: "Verlorener Betrag",
        cta: "Fall überprüfen",
        resultLine: "Ergebnis: Zu Ihren Ungunsten entschieden · Mittel abgezogen",
      },
      accepted: {
        subject: ({ shortId, orderName }) =>
          `Streitfall geschlossen — ${orderName ?? `Streitfall ${shortId}`}`,
        heading: "Dieser Streitfall wurde geschlossen",
        body: [
          "Dieser Fall war eine Anfrage, keine Rückbuchung: Der Zahlungsanbieter hat zusätzliche Informationen angefordert, bevor über eine Eskalation entschieden wird. Der Fall wurde geschlossen, und der strittige Betrag wurde mit dem Kunden abgerechnet.",
          "Für diesen Fall ist keine weitere Maßnahme erforderlich. DisputeDesk bewahrt den Datensatz auf, damit Ihr Team die Zeitlinie einsehen, verfügbare Beweise prüfen und die Bearbeitung künftiger Streitfälle verbessern kann.",
        ],
        amountLabel: "Mit dem Kunden abgerechneter Betrag",
        cta: "Akteneintrag ansehen",
        resultLine: "Ergebnis: Geschlossen · Keine Antwort eingereicht",
      },
    },
  },
  es: {
    shared: {
      reason: "Motivo",
      order: "Pedido",
      footer:
        "Recibe este correo porque las notificaciones de resultado están activadas para su equipo de DisputeDesk. Gestione sus preferencias en la app integrada en Configuración del equipo.",
    },
    won: {
      subject: ({ shortId, orderName }) =>
        `Ha ganado la contracargo de ${orderName ?? `la disputa ${shortId}`}`,
      heading: "Ha ganado este contracargo",
      body: [
        "Buenas noticias: la red de tarjetas aceptó su paquete de defensa y resolvió esta disputa a su favor.",
        "El importe disputado permanece con usted, y cualquier cargo provisional debería ser revertido por su procesador según sus tiempos habituales de liquidación.",
        "El registro del caso permanece en DisputeDesk, incluidas las pruebas presentadas, la cronología y el resultado, para que su equipo pueda revisar qué funcionó y reutilizar el patrón en futuras disputas.",
      ],
      amountLabel: "Importe protegido",
      cta: "Ver caso ganador",
      resultLine: "Resultado: Defensa aceptada · Fondos retenidos",
    },
    lost: {
      subject: ({ shortId, orderName }) =>
        `Este contracargo se perdió — ${orderName ?? `disputa ${shortId}`}`,
      heading: "Este contracargo no se ganó",
      body: [
        "La red de tarjetas se puso del lado del titular de la tarjeta, y el importe disputado se ha deducido de su pago.",
        "Esta decisión es definitiva para esta disputa, por lo que no hay más acciones a realizar. El caso permanecerá en DisputeDesk con las pruebas presentadas, la cronología y el resultado para que su equipo pueda revisar qué ocurrió e identificar formas de fortalecer futuras defensas.",
      ],
      amountLabel: "Importe perdido",
      cta: "Revisar el caso",
      resultLine: "Resultado: Titular de la tarjeta ganó · Fondos deducidos",
    },
    accepted: {
      subject: ({ shortId, orderName }) =>
        `Contracargo cerrado en ${orderName ?? `disputa ${shortId}`}`,
      heading: "Este contracargo se ha cerrado",
      body: [
        "Esta disputa se ha cerrado. El importe disputado se ha liquidado con el titular de la tarjeta.",
        "No hay nada más que hacer en este caso, pero DisputeDesk mantendrá el registro disponible para que su equipo pueda revisar la cronología, ver qué pruebas estaban disponibles y mejorar la gestión de futuras disputas.",
      ],
      amountLabel: "Importe liquidado con el titular de la tarjeta",
      cta: "Ver registro del caso",
      resultLine: "Resultado: Cerrado",
    },
    inquiry: {
      won: {
        subject: ({ shortId, orderName }) =>
          `Ha ganado la disputa de ${orderName ?? shortId}`,
        heading: "Ha ganado esta disputa",
        body: [
          "Buenas noticias: este caso era una consulta, no un contracargo. El proveedor de pagos solicitó más información antes de decidir si abrir un contracargo formal. Su respuesta fue satisfactoria y el caso se ha resuelto a su favor.",
          "El importe disputado permanece con usted, y el caso se cerró sin escalar a un contracargo.",
          "El registro del caso permanece en DisputeDesk, incluidas las pruebas presentadas, la cronología y el resultado, para que su equipo pueda revisar qué funcionó y reutilizar el patrón en futuras disputas.",
        ],
        amountLabel: "Importe protegido",
        cta: "Ver caso ganador",
        resultLine: "Resultado: Consulta resuelta a su favor · Fondos retenidos",
      },
      lost: {
        subject: ({ shortId, orderName }) =>
          `Esta disputa se perdió — ${orderName ?? `disputa ${shortId}`}`,
        heading: "Esta disputa no se ganó",
        body: [
          "Este caso era una consulta, no un contracargo. El proveedor de pagos solicitó más información antes de tomar una decisión. El caso se ha resuelto en su contra y el importe disputado se ha deducido de su pago.",
          "Esta decisión es definitiva para este caso, por lo que no hay más acciones a realizar. El caso permanecerá en DisputeDesk con las pruebas presentadas, la cronología y el resultado para que su equipo pueda revisar qué ocurrió e identificar formas de fortalecer futuras respuestas.",
        ],
        amountLabel: "Importe perdido",
        cta: "Revisar el caso",
        resultLine: "Resultado: Resuelto en su contra · Fondos deducidos",
      },
      accepted: {
        subject: ({ shortId, orderName }) =>
          `Disputa cerrada en ${orderName ?? `disputa ${shortId}`}`,
        heading: "Esta disputa se ha cerrado",
        body: [
          "Este caso era una consulta, no un contracargo. El proveedor de pagos solicitó más información antes de decidir si escalar. El caso se ha cerrado y el importe disputado se ha liquidado con el cliente.",
          "No hay nada más que hacer en este caso, pero DisputeDesk mantendrá el registro disponible para que su equipo pueda revisar la cronología, ver qué pruebas estaban disponibles y mejorar la gestión de futuras disputas.",
        ],
        amountLabel: "Importe liquidado con el cliente",
        cta: "Ver registro del caso",
        resultLine: "Resultado: Cerrado · Sin respuesta presentada",
      },
    },
  },
  pt: {
    shared: {
      reason: "Motivo",
      order: "Pedido",
      footer:
        "Você recebe este e-mail porque as notificações de resultado estão ativadas para sua equipe DisputeDesk. Gerencie suas preferências no app incorporado em Configurações da equipe.",
    },
    won: {
      subject: ({ shortId, orderName }) =>
        `Você venceu o chargeback de ${orderName ?? `disputa ${shortId}`}`,
      heading: "Você venceu este chargeback",
      body: [
        "Boas notícias — a rede de cartões aceitou seu pacote de defesa e decidiu esta disputa a seu favor.",
        "O valor disputado permanece com você, e qualquer débito provisório deve ser revertido pelo seu processador de acordo com o ciclo normal de pagamento.",
        "O registro do caso permanece no DisputeDesk, incluindo as provas enviadas, a linha do tempo e o resultado, para que sua equipe possa revisar o que funcionou e reutilizar o padrão em disputas futuras.",
      ],
      amountLabel: "Valor protegido",
      cta: "Ver caso vencedor",
      resultLine: "Resultado: Defesa aceita · Fundos retidos",
    },
    lost: {
      subject: ({ shortId, orderName }) =>
        `Este chargeback foi perdido — ${orderName ?? `disputa ${shortId}`}`,
      heading: "Este chargeback não foi vencido",
      body: [
        "A rede de cartões ficou do lado do titular do cartão, e o valor disputado foi deduzido do seu pagamento.",
        "Esta decisão é final para esta disputa, portanto não há mais ações a tomar. O caso permanecerá no DisputeDesk com as provas enviadas, a linha do tempo e o resultado, para que sua equipe possa revisar o que aconteceu e identificar maneiras de fortalecer defesas futuras.",
      ],
      amountLabel: "Valor perdido",
      cta: "Revisar o caso",
      resultLine: "Resultado: Titular do cartão venceu · Fundos deduzidos",
    },
    accepted: {
      subject: ({ shortId, orderName }) =>
        `Chargeback encerrado em ${orderName ?? `disputa ${shortId}`}`,
      heading: "Este chargeback foi encerrado",
      body: [
        "Esta disputa foi encerrada. O valor disputado foi liquidado com o titular do cartão.",
        "Não há mais nada a fazer neste caso, mas o DisputeDesk manterá o registro disponível para que sua equipe possa revisar a linha do tempo, ver quais provas estavam disponíveis e melhorar o tratamento de futuras disputas.",
      ],
      amountLabel: "Valor liquidado com o titular do cartão",
      cta: "Ver registro do caso",
      resultLine: "Resultado: Encerrado",
    },
    inquiry: {
      won: {
        subject: ({ shortId, orderName }) =>
          `Você venceu a disputa de ${orderName ?? `disputa ${shortId}`}`,
        heading: "Você venceu esta disputa",
        body: [
          "Boas notícias — este caso era uma consulta, não um chargeback: o provedor de pagamento solicitou mais informações antes de decidir se abriria um chargeback formal. Sua resposta foi satisfatória e o caso foi resolvido a seu favor.",
          "O valor disputado permanece com você, e o caso foi encerrado sem escalar para um chargeback.",
          "O registro do caso permanece no DisputeDesk, incluindo as provas enviadas, a linha do tempo e o resultado, para que sua equipe possa revisar o que funcionou e reutilizar o padrão em disputas futuras.",
        ],
        amountLabel: "Valor protegido",
        cta: "Ver caso vencedor",
        resultLine: "Resultado: Consulta resolvida a seu favor · Fundos retidos",
      },
      lost: {
        subject: ({ shortId, orderName }) =>
          `Esta disputa foi perdida — ${orderName ?? `disputa ${shortId}`}`,
        heading: "Esta disputa não foi vencida",
        body: [
          "Este caso era uma consulta, não um chargeback: o provedor de pagamento solicitou mais informações antes de tomar uma decisão. O caso foi resolvido contra você, e o valor disputado foi deduzido do seu pagamento.",
          "Esta decisão é final para este caso, portanto não há mais ações a tomar. O caso permanecerá no DisputeDesk com as provas enviadas, a linha do tempo e o resultado, para que sua equipe possa revisar o que aconteceu e identificar maneiras de fortalecer respostas futuras.",
        ],
        amountLabel: "Valor perdido",
        cta: "Revisar o caso",
        resultLine: "Resultado: Resolvido contra você · Fundos deduzidos",
      },
      accepted: {
        subject: ({ shortId, orderName }) =>
          `Disputa encerrada em ${orderName ?? `disputa ${shortId}`}`,
        heading: "Esta disputa foi encerrada",
        body: [
          "Este caso era uma consulta, não um chargeback: o provedor de pagamento solicitou mais informações antes de decidir se escalaria. O caso foi encerrado, e o valor disputado foi liquidado com o cliente.",
          "Não há mais nada a fazer neste caso, mas o DisputeDesk manterá o registro disponível para que sua equipe possa revisar a linha do tempo, ver quais provas estavam disponíveis e melhorar o tratamento de futuras disputas.",
        ],
        amountLabel: "Valor liquidado com o cliente",
        cta: "Ver registro do caso",
        resultLine: "Resultado: Encerrado · Sem resposta enviada",
      },
    },
  },
  fr: {
    shared: {
      reason: "Motif",
      order: "Commande",
      footer:
        "Vous recevez ce courriel parce que les notifications de résultat sont activées pour votre équipe DisputeDesk. Gérez vos préférences dans l'app intégrée sous Paramètres de l'équipe.",
    },
    won: {
      subject: ({ shortId, orderName }) =>
        `Vous avez gagné le litige sur ${orderName ?? `le différend ${shortId}`}`,
      heading: "Vous avez gagné ce litige",
      body: [
        "Bonne nouvelle — le réseau de cartes a accepté votre dossier de défense et tranché ce différend en votre faveur.",
        "Le montant contesté reste à vous, et tout débit provisoire devrait être annulé par votre processeur selon son calendrier de versement habituel.",
        "Le dossier reste dans DisputeDesk, y compris les preuves soumises, la chronologie et le résultat, pour que votre équipe puisse examiner ce qui a fonctionné et réutiliser le schéma pour les futurs différends.",
      ],
      amountLabel: "Montant protégé",
      cta: "Voir l'affaire gagnée",
      resultLine: "Résultat : Défense acceptée · Fonds conservés",
    },
    lost: {
      subject: ({ shortId, orderName }) =>
        `Ce litige a été perdu — ${orderName ?? `différend ${shortId}`}`,
      heading: "Ce litige n'a pas été gagné",
      body: [
        "Le réseau de cartes s'est rangé du côté du titulaire de la carte, et le montant contesté a été déduit de votre versement.",
        "Cette décision est finale pour ce différend, il n'y a donc aucune action supplémentaire à entreprendre. L'affaire restera dans DisputeDesk avec les preuves soumises, la chronologie et le résultat, pour que votre équipe puisse examiner ce qui s'est passé et identifier des moyens de renforcer les défenses futures.",
      ],
      amountLabel: "Montant perdu",
      cta: "Examiner l'affaire",
      resultLine: "Résultat : Titulaire de la carte gagné · Fonds déduits",
    },
    accepted: {
      subject: ({ shortId, orderName }) =>
        `Litige clôturé sur ${orderName ?? `différend ${shortId}`}`,
      heading: "Ce litige a été clôturé",
      body: [
        "Ce différend a été clôturé. Le montant contesté a été réglé avec le titulaire de la carte.",
        "Il n'y a rien de plus à faire sur cette affaire, mais DisputeDesk conservera l'enregistrement disponible pour que votre équipe puisse examiner la chronologie, voir quelles preuves étaient disponibles et améliorer le traitement des futurs différends.",
      ],
      amountLabel: "Montant réglé avec le titulaire de la carte",
      cta: "Voir le dossier",
      resultLine: "Résultat : Clôturé",
    },
    inquiry: {
      won: {
        subject: ({ shortId, orderName }) =>
          `Vous avez gagné le différend sur ${orderName ?? `le différend ${shortId}`}`,
        heading: "Vous avez gagné ce différend",
        body: [
          "Bonne nouvelle — ce dossier était une demande de renseignements, pas une rétrofacturation : le prestataire de paiement a demandé des informations supplémentaires avant de décider d'ouvrir une rétrofacturation formelle. Votre réponse a été jugée satisfaisante et le dossier a été tranché en votre faveur.",
          "Le montant contesté reste à vous, et le dossier a été clôturé sans donner lieu à une rétrofacturation.",
          "Le dossier reste dans DisputeDesk, y compris les preuves soumises, la chronologie et le résultat, pour que votre équipe puisse examiner ce qui a fonctionné et réutiliser le schéma pour les futurs différends.",
        ],
        amountLabel: "Montant protégé",
        cta: "Voir l'affaire gagnée",
        resultLine: "Résultat : Demande résolue en votre faveur · Fonds conservés",
      },
      lost: {
        subject: ({ shortId, orderName }) =>
          `Ce différend a été perdu — ${orderName ?? `différend ${shortId}`}`,
        heading: "Ce différend n'a pas été gagné",
        body: [
          "Ce dossier était une demande de renseignements, pas une rétrofacturation : le prestataire de paiement a demandé des informations supplémentaires avant de prendre une décision. Le dossier a été tranché en votre défaveur, et le montant contesté a été déduit de votre versement.",
          "Cette décision est finale pour ce dossier, il n'y a donc aucune action supplémentaire à entreprendre. L'affaire restera dans DisputeDesk avec les preuves soumises, la chronologie et le résultat, pour que votre équipe puisse examiner ce qui s'est passé et identifier des moyens de renforcer les réponses futures.",
        ],
        amountLabel: "Montant perdu",
        cta: "Examiner l'affaire",
        resultLine: "Résultat : Tranché en votre défaveur · Fonds déduits",
      },
      accepted: {
        subject: ({ shortId, orderName }) =>
          `Différend clôturé sur ${orderName ?? `différend ${shortId}`}`,
        heading: "Ce différend a été clôturé",
        body: [
          "Ce dossier était une demande de renseignements, pas une rétrofacturation : le prestataire de paiement a demandé des informations supplémentaires avant de décider d'une éventuelle escalade. Le dossier a été clôturé, et le montant contesté a été réglé avec le client.",
          "Il n'y a rien de plus à faire sur cette affaire, mais DisputeDesk conservera l'enregistrement disponible pour que votre équipe puisse examiner la chronologie, voir quelles preuves étaient disponibles et améliorer le traitement des futurs différends.",
        ],
        amountLabel: "Montant réglé avec le client",
        cta: "Voir le dossier",
        resultLine: "Résultat : Clôturé · Aucune réponse soumise",
      },
    },
  },
  sv: {
    shared: {
      reason: "Orsak",
      order: "Order",
      footer:
        "Du får detta e-postmeddelande eftersom resultat­meddelanden är aktiverade för ditt DisputeDesk-team. Hantera dina inställningar i den inbäddade appen under Team-inställningar.",
    },
    won: {
      subject: ({ shortId, orderName }) =>
        `Du vann återkravet på ${orderName ?? `tvist ${shortId}`}`,
      heading: "Du vann detta återkrav",
      body: [
        "Goda nyheter — kortnätverket accepterade ditt försvarspaket och avgjorde denna tvist till din fördel.",
        "Det tvistade beloppet stannar hos dig, och eventuella tillfälliga debiteringar bör återföras av din betalnings­leverantör enligt deras normala utbetalnings­schema.",
        "Ärendet stannar i DisputeDesk — inklusive de inskickade bevisen, tidslinjen och utfallet — så att ditt team kan granska vad som fungerade och återanvända mönstret för framtida tvister.",
      ],
      amountLabel: "Skyddat belopp",
      cta: "Visa vunnet ärende",
      resultLine: "Resultat: Försvar accepterat · Medel behållna",
    },
    lost: {
      subject: ({ shortId, orderName }) =>
        `Detta återkrav förlorades — ${orderName ?? `tvist ${shortId}`}`,
      heading: "Detta återkrav vanns inte",
      body: [
        "Kortnätverket ställde sig på korthållarens sida, och det tvistade beloppet har dragits från din utbetalning.",
        "Detta beslut är slutgiltigt för denna tvist, så det finns inga ytterligare åtgärder att vidta. Ärendet kommer att finnas kvar i DisputeDesk med de inskickade bevisen, tidslinjen och utfallet så att ditt team kan granska vad som hände och identifiera sätt att stärka framtida försvar.",
      ],
      amountLabel: "Förlorat belopp",
      cta: "Granska ärendet",
      resultLine: "Resultat: Korthållare vann · Medel dragna",
    },
    accepted: {
      subject: ({ shortId, orderName }) =>
        `Återkrav avslutat på ${orderName ?? `tvist ${shortId}`}`,
      heading: "Detta återkrav har avslutats",
      body: [
        "Denna tvist har nu avslutats. Det tvistade beloppet har reglerats med korthållaren.",
        "Det finns inget mer att göra i detta ärende, men DisputeDesk bevarar ärendet så att ditt team kan granska tidslinjen, se vilka bevis som var tillgängliga och förbättra hanteringen av framtida tvister.",
      ],
      amountLabel: "Belopp reglerat med korthållare",
      cta: "Visa ärende­post",
      resultLine: "Resultat: Avslutat",
    },
    inquiry: {
      won: {
        subject: ({ shortId, orderName }) =>
          `Du vann tvisten på ${orderName ?? `tvist ${shortId}`}`,
        heading: "Du vann denna tvist",
        body: [
          "Goda nyheter — detta ärende var en förfrågan, inte ett återkrav: betalningsleverantören begärde mer information innan beslut om ett formellt återkrav. Ditt svar var övertygande och ärendet har avgjorts till din fördel.",
          "Det tvistade beloppet stannar hos dig, och ärendet avslutades utan att eskalera till ett återkrav.",
          "Ärendet stannar i DisputeDesk — inklusive de inskickade bevisen, tidslinjen och utfallet — så att ditt team kan granska vad som fungerade och återanvända mönstret för framtida tvister.",
        ],
        amountLabel: "Skyddat belopp",
        cta: "Visa vunnet ärende",
        resultLine: "Resultat: Förfrågan avgjord till din fördel · Medel behållna",
      },
      lost: {
        subject: ({ shortId, orderName }) =>
          `Denna tvist förlorades — ${orderName ?? `tvist ${shortId}`}`,
        heading: "Denna tvist vanns inte",
        body: [
          "Detta ärende var en förfrågan, inte ett återkrav: betalningsleverantören begärde mer information innan beslut fattades. Ärendet har avgjorts till din nackdel, och det tvistade beloppet har dragits från din utbetalning.",
          "Detta beslut är slutgiltigt för detta ärende, så det finns inga ytterligare åtgärder att vidta. Ärendet kommer att finnas kvar i DisputeDesk med de inskickade bevisen, tidslinjen och utfallet så att ditt team kan granska vad som hände och identifiera sätt att stärka framtida svar.",
        ],
        amountLabel: "Förlorat belopp",
        cta: "Granska ärendet",
        resultLine: "Resultat: Avgjord till din nackdel · Medel dragna",
      },
      accepted: {
        subject: ({ shortId, orderName }) =>
          `Tvist avslutad på ${orderName ?? `tvist ${shortId}`}`,
        heading: "Denna tvist har avslutats",
        body: [
          "Detta ärende var en förfrågan, inte ett återkrav: betalningsleverantören begärde mer information innan beslut om eventuell eskalering. Ärendet har nu avslutats, och det tvistade beloppet har reglerats med kunden.",
          "Det finns inget mer att göra i detta ärende, men DisputeDesk bevarar ärendet så att ditt team kan granska tidslinjen, se vilka bevis som var tillgängliga och förbättra hanteringen av framtida tvister.",
        ],
        amountLabel: "Belopp reglerat med kund",
        cta: "Visa ärende­post",
        resultLine: "Resultat: Avslutat · Inget svar inlämnat",
      },
    },
  },
};

function resolveLocale(storeLocale: string | null): Locale {
  if (!storeLocale) return "en";
  const lower = storeLocale.toLowerCase();
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("pt")) return "pt";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("sv")) return "sv";
  return "en";
}

/** Walk a dotted key path into a loaded message bundle. */
function lookupMessage(
  messages: Record<string, unknown>,
  key: string,
): string | null {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

/**
 * Build the explanation paragraph, resolved against the merchant's locale
 * bundle.
 *
 * Reads the SAME `disputes.outcomeExplanation.*` messages the Overview
 * header uses, through the same `resolveOutcomeExplanation` /
 * `outcomeExplanationToken` pair — so the email and the app cannot drift
 * into describing one decision two ways.
 *
 * ICU is not needed here: these messages use simple `{date}` / `{clause}`
 * placeholders with no plural or select arms, so a literal substitution is
 * exact. A message that ever needs real ICU must move to a translator
 * rather than gain a hand-rolled parser here.
 *
 * Returns null when there is nothing to add, and never throws — a missing
 * key degrades to the email's existing wording rather than failing the
 * send.
 */
async function outcomeExplanationSentence(input: {
  locale: Locale;
  outcome: "won" | "lost";
  reason: string | null;
  pack: { submittedAt: string | null; facts: unknown } | null;
}): Promise<string | null> {
  try {
    const explanation = resolveOutcomeExplanation({
      outcome: input.outcome,
      reason: input.reason,
      pack: input.pack,
    });
    const filedAt =
      explanation.kind === "not_defended_by_us" ? null : explanation.filedAt;
    // A historical import gets no paragraph at all. The Overview header
    // states it plainly because the merchant is looking at that case; an
    // unprompted email volunteering "we did nothing here" is noise.
    if (explanation.kind === "not_defended_by_us") return null;

    const formattedDate = filedAt
      ? new Date(filedAt).toLocaleDateString(input.locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;
    const token = outcomeExplanationToken(explanation, input.outcome, formattedDate);
    if (!token) return null;

    const messages = await getMessages(input.locale);
    const template = lookupMessage(messages, token.key);
    if (!template) return null;

    let out = template;
    for (const [name, value] of Object.entries(token.params ?? {})) {
      const resolved =
        typeof value === "object" && value !== null && "key" in value
          ? lookupMessage(messages, (value as { key: string }).key)
          : String(value);
      if (resolved === null) return null;
      out = out.split(`{${name}}`).join(resolved);
    }
    return out;
  } catch {
    return null;
  }
}

function formatCurrency(
  amount: number | null,
  currencyCode: string | null,
): string {
  if (amount === null) return "—";
  const code = currencyCode ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function shortDisputeId(disputeId: string): string {
  return disputeId.slice(0, 8).toUpperCase();
}

function reasonLabel(reason: string | null): string {
  if (!reason) return "—";
  // Map a few common Shopify reason codes to friendlier labels. Falls
  // back to a Title-Case rendering for everything else.
  const known: Record<string, string> = {
    FRAUDULENT: "Unauthorized transaction",
    UNRECOGNIZED: "Unrecognized charge",
    PRODUCT_NOT_RECEIVED: "Product not received",
    DUPLICATE: "Duplicate charge",
    CREDIT_NOT_PROCESSED: "Refund not processed",
    SUBSCRIPTION_CANCELLED: "Subscription cancelled",
  };
  const canonical = canonicalReasonCode(reason) ?? reason;
  if (known[canonical]) return known[canonical];
  return reason
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function sendOutcomePostedAlert(
  ctx: OutcomePostedAlertContext,
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn(
      "[outcomePosted] RESEND_API_KEY not set — skipping outcome email",
    );
    return;
  }

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
    // New notification preference key. Default-on so existing shops
    // start receiving outcome emails without opt-in friction. Merchants
    // can turn it off in Team settings (see Phase 5 follow-up — the
    // setting UI may not exist yet, but the data path is ready).
    const notifications = teamPayload?.notifications as {
      newDispute?: boolean;
      outcome?: boolean;
    } | null;
    if (notifications?.outcome === false) return;

    const teamEmail = teamPayload?.teamEmail as string | undefined;
    if (!teamEmail) return;

    const storeLocale =
      (steps?.store_profile?.payload?.storeLocale as string | undefined) ?? null;
    const locale = resolveLocale(storeLocale);
    const s = STRINGS[locale];
    // Inquiry-resolved cases must never be called a "chargeback" — pick
    // the inquiry-worded variant set; unknown/null phase keeps the
    // chargeback wording (same default as phaseUtils).
    const variant =
      ctx.phase === "inquiry" ? s.inquiry[ctx.outcome] : s[ctx.outcome];

    /* The explanation paragraph — won/lost only.
     *
     * `accepted` is deliberately excluded. Its own doc comment above says
     * it is a catch-all that also reaches disputes DisputeDesk submitted,
     * so it cannot know what was filed; adding this sentence there would
     * be exactly the unfounded claim the derivation exists to avoid. */
    const bodyParagraphs = [...variant.body];
    if (ctx.outcome === "won" || ctx.outcome === "lost") {
      const sentence = await outcomeExplanationSentence({
        locale,
        outcome: ctx.outcome,
        reason: ctx.reason,
        pack: ctx.defencePackage ?? null,
      });
      // Slot in after the result statement and before the "no further
      // action / review what happened" paragraph, which then reads as the
      // natural follow-on rather than an interruption.
      if (sentence) bodyParagraphs.splice(1, 0, sentence);
    }

    const { data: shop } = await sb
      .from("shops")
      .select("shop_domain")
      .eq("id", ctx.shopId)
      .single();

    const disputeUrl = getEmbeddedAppUrl(
      shop?.shop_domain ?? null,
      `disputes/${ctx.disputeId}`,
    );

    const shortId = shortDisputeId(ctx.disputeId);
    const subject = `[DisputeDesk] ${variant.subject({
      shortId,
      orderName: ctx.orderName,
    })}`;

    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);
    const reason = reasonLabel(ctx.reason);
    const orderNameDisplay = ctx.orderName ?? "—";

    // Outcome-tinted accent. Won = green; lost = muted red; accepted =
    // neutral grey. Subtle — the email is informational, not
    // celebratory or scolding.
    const accent =
      ctx.outcome === "won"
        ? "#0C5132"
        : ctx.outcome === "lost"
          ? "#8B1F19"
          : "#4A4A4A";

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

      <h1 style="font-size:20px;font-weight:600;color:${accent};margin:0 0 12px">
        ${variant.heading}
      </h1>
      ${bodyParagraphs
        .map(
          (p) =>
            `<p style="font-size:14px;color:#202223;margin:0 0 12px;line-height:1.55">${p}</p>`,
        )
        .join("")}

      <table style="width:100%;border-collapse:collapse;margin:18px 0 20px;font-size:13px" role="presentation">
        <tr><td style="padding:6px 0;color:#5C5F62;width:38%">${s.shared.order}</td><td style="padding:6px 0;color:#202223">${orderNameDisplay}</td></tr>
        <tr><td style="padding:6px 0;color:#5C5F62">${s.shared.reason}</td><td style="padding:6px 0;color:#202223">${reason}</td></tr>
        <tr><td style="padding:6px 0;color:#5C5F62">${variant.amountLabel}</td><td style="padding:6px 0;color:#202223;font-weight:600">${amountStr}</td></tr>
      </table>

      <a href="${disputeUrl}" style="display:inline-block;background:#1D4ED8;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500">
        ${variant.cta}
      </a>

      ${
        variant.resultLine
          ? `<p style="font-size:12px;color:${accent};margin:16px 0 0;line-height:1.5;font-weight:500;letter-spacing:0.01em">${variant.resultLine}</p>`
          : ""
      }
    </div>
    <p style="font-size:11px;color:#8A8A8A;text-align:center;margin:8px 0 0;line-height:1.5">
      ${s.shared.footer}
    </p>
  </div>
</body>
</html>`;

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: teamEmail.includes(",")
        ? teamEmail.split(",").map((s) => s.trim()).filter(Boolean)
        : teamEmail,
      subject,
      html,
    });
  } catch (err) {
    console.warn(
      `[outcomePosted] failed to send: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
