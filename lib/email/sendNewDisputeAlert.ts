/**
 * Send "new dispute detected" email to the merchant.
 *
 * Triggered in syncDisputes when a dispute is upserted for the first time.
 * Checks the `newDispute` notification preference before sending.
 *
 * The email body is selected by `resolvedMode`:
 *   - "auto"   → "we handled it automatically" confirmation (submission already happened)
 *   - "review" → "your response is ready, please review and submit" call-to-action
 *
 * Callers must pass the mode their automation pipeline actually resolved to
 * (after normalizeMode). Legacy modes should never reach this function.
 *
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { getServiceClient } from "@/lib/supabase/server";
import type { AutomationMode } from "@/lib/rules/normalizeMode";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

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
  resolvedMode: AutomationMode;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface SharedStrings {
  reason: string;
  amount: string;
  order: string;
  due: string;
  phaseHintInquiry: string;
  phaseHintChargeback: string;
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
}

interface EmailStrings {
  shared: SharedStrings;
  auto: ModeStrings;
  review: ModeStrings;
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
          `Shopify will forward your response to the card network on <b>${dueDate}</b>. No action is required from your side. ` +
          `Want a faster resolution? Open the dispute in your Shopify Admin and submit it from there — Shopify will forward it to the bank immediately.`,
      },
      cta: "Open dispute →",
    },
    review: {
      subject: ({ shortId }) => `Dispute #${shortId} is ready for your review`,
      heading: "Your response is ready — review and submit",
      bodyP1: ({ orderName }) =>
        `A new dispute was detected for order ${orderName}. DisputeDesk has prepared your response, but it has not been submitted yet.`,
      listLabel: "What to do next",
      listItems: [
        "Open the dispute",
        "Review the prepared evidence",
        "Add anything missing if needed",
        "Submit before the deadline",
      ],
      callout: {
        label: "Important",
        body: "Nothing has been submitted yet. This dispute still requires your approval.",
      },
      cta: "Review dispute →",
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
        "Abre la disputa",
        "Revisa la evidencia preparada",
        "Añade lo que falte si es necesario",
        "Envía antes de la fecha límite",
      ],
      callout: {
        label: "Importante",
        body: "Todavía no se ha enviado nada. Esta disputa aún requiere tu aprobación.",
      },
      cta: "Revisar disputa →",
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
        "Abra a disputa",
        "Revise as evidências preparadas",
        "Adicione o que estiver faltando se necessário",
        "Envie antes do prazo",
      ],
      callout: {
        label: "Importante",
        body: "Nada foi enviado ainda. Esta disputa ainda requer sua aprovação.",
      },
      cta: "Revisar disputa →",
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
        "Ouvrez le litige",
        "Examinez les preuves préparées",
        "Ajoutez ce qui manque si nécessaire",
        "Soumettez avant la date limite",
      ],
      callout: {
        label: "Important",
        body: "Rien n'a encore été soumis. Ce litige nécessite toujours votre approbation.",
      },
      cta: "Examiner le litige →",
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
        "Öffnen Sie die Reklamation",
        "Prüfen Sie die vorbereiteten Beweise",
        "Ergänzen Sie fehlende Informationen bei Bedarf",
        "Reichen Sie vor Ablauf der Frist ein",
      ],
      callout: {
        label: "Wichtig",
        body: "Es wurde noch nichts eingereicht. Diese Reklamation erfordert weiterhin Ihre Freigabe.",
      },
      cta: "Reklamation prüfen →",
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
        "Öppna tvisten",
        "Granska den förberedda bevisningen",
        "Lägg till det som saknas vid behov",
        "Skicka in före tidsfristen",
      ],
      callout: {
        label: "Viktigt",
        body: "Inget har skickats in ännu. Denna tvist kräver fortfarande ditt godkännande.",
      },
      cta: "Granska tvist →",
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

export async function sendNewDisputeAlert(
  ctx: NewDisputeAlertContext,
): Promise<void> {
  if (!RESEND_API_KEY) return;

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

    const teamEmail = teamPayload?.teamEmail as string | undefined;
    if (!teamEmail) return;

    const storeLocale = (
      steps?.store_profile?.payload?.storeLocale as string | undefined
    ) ?? null;
    const locale = resolveLocale(storeLocale);
    const s = STRINGS[locale];
    const shared = s.shared;
    const variant = ctx.resolvedMode === "auto" ? s.auto : s.review;

    const { data: shop } = await sb
      .from("shops")
      .select("shop_domain")
      .eq("id", ctx.shopId)
      .single();

    const disputeUrl = getEmbeddedAppUrl(
      shop?.shop_domain ?? null,
      `disputes/${ctx.disputeId}`,
    );
    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);
    const reason = reasonLabel(ctx.reason);
    const phaseHint =
      ctx.phase === "inquiry"
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

    const calloutHtml =
      variant.callout && calloutBody !== null
        ? `
      <div style="background:${ctx.resolvedMode === "review" ? "#FEF3C7;border:1px solid #FCD34D" : "#EFF6FF;border:1px solid #BFDBFE"};border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:13px;font-weight:600;color:${ctx.resolvedMode === "review" ? "#92400E" : "#1E40AF"};margin:0 0 4px">
          ${variant.callout.label}
        </p>
        <p style="font-size:13px;color:${ctx.resolvedMode === "review" ? "#92400E" : "#1E40AF"};margin:0;line-height:1.5">
          ${calloutBody}
        </p>
      </div>`
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

      <div style="background:${ctx.phase === "inquiry" ? "#EFF6FF;border:1px solid #BFDBFE" : "#F6F6F7;border:1px solid #E1E3E5"};border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:12px;color:${ctx.phase === "inquiry" ? "#1E40AF" : "#6D7175"};margin:0;line-height:1.5">
          ${phaseHint}
        </p>
      </div>

      <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        ${variant.cta}
      </a>
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
${variant.callout && calloutBody !== null ? `\n${variant.callout.label}: ${calloutBody.replace(/<\/?b>/g, "")}\n` : ""}
${phaseHint}

${variant.cta.replace(" →", "")}: ${disputeUrl}

---
${shared.footer}`;

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: teamEmail.includes(",")
        ? teamEmail.split(",").map((e) => e.trim())
        : teamEmail,
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
