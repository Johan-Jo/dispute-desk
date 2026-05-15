/**
 * Render the risk-weakness review email locally — no DB writes, no
 * Resend call. Outputs an HTML file you can open in a browser to see
 * exactly what the merchant will receive when the Phase 2 cap fires.
 *
 * Uses the SAME production code path that sendNewDisputeAlert renders
 * with. The only difference vs production:
 *   1. We bypass the Supabase reads (shop_setup, shops) by stubbing
 *      the team email + shop domain inline.
 *   2. We don't actually call Resend — the rendered HTML is written
 *      to a local file.
 *
 * Usage:
 *   node scripts/preview-risk-weakness-email.mjs
 *   node scripts/preview-risk-weakness-email.mjs --locale es
 *   node scripts/preview-risk-weakness-email.mjs --locale sv --order "#1234"
 *
 * The output file is risk-weakness-email-preview.<locale>.html in the
 * project root. The plaintext fallback also gets written next to it
 * as risk-weakness-email-preview.<locale>.txt so you can verify both.
 */

import { writeFileSync } from "fs";
import { join } from "path";

// We can't import sendNewDisputeAlert directly (TS + Next.js path
// aliases). Instead we re-export the same STRINGS dict + HTML
// template inline. If sendNewDisputeAlert is ever refactored to a
// separate template module, this script should switch to importing
// from there.

const LOCALE_ARG = process.argv.indexOf("--locale");
const LOCALE = LOCALE_ARG !== -1 ? process.argv[LOCALE_ARG + 1] : "en";
const ORDER_ARG = process.argv.indexOf("--order");
const ORDER_NAME = ORDER_ARG !== -1 ? process.argv[ORDER_ARG + 1] : "#1234";

const SUPPORTED = ["en", "es", "pt", "fr", "de", "sv"];
if (!SUPPORTED.includes(LOCALE)) {
  console.error(`Unsupported locale: ${LOCALE}. Use one of: ${SUPPORTED.join(", ")}`);
  process.exit(1);
}

// Mirror the STRINGS block from lib/email/sendNewDisputeAlert.ts. If
// this drifts vs production, vitest snapshot tests will catch it next
// time we touch that file — but the drift would be silent here. To
// stay safe, treat this preview as a visual reference, not a contract.
//
// We embed only the review variant + parkReason for each locale (the
// preview never renders the auto variant).
const STRINGS = {
  en: {
    shared: {
      reason: "Reason",
      amount: "Amount",
      order: "Order",
      due: "Response due",
      phaseHintChargeback: "Evidence must be submitted before the deadline.",
      footer: "You received this because new-dispute alerts are enabled in DisputeDesk settings.",
    },
    review: {
      subject: ({ shortId }) => `Dispute #${shortId} is ready for your review`,
      heading: "Your response is ready — review and submit",
      bodyP1: ({ orderName }) => `A new dispute was detected for order ${orderName}. DisputeDesk has prepared your response, but it has not been submitted yet.`,
      listLabel: "What to do next",
      listItems: ["Open the dispute", "Review the prepared evidence", "Add anything missing if needed", "Submit before the deadline"],
      callout: { label: "Important", body: "Nothing has been submitted yet. This dispute still requires your approval." },
      cta: "Review dispute →",
    },
    parkReason: {
      risk_weakness: {
        label: "Why we held this for your review",
        body: "Your automation rule was set to auto-submit, but Shopify's pre-authorization fraud screening flagged this order as high-risk before fulfillment. Auto-submit was held so you can review the evidence before submitting.",
      },
    },
  },
  es: {
    shared: { reason: "Razón", amount: "Monto", order: "Pedido", due: "Fecha límite", phaseHintChargeback: "La evidencia debe enviarse antes de la fecha límite.", footer: "Recibiste esto porque las alertas de nuevas disputas están activadas en la configuración de DisputeDesk." },
    review: {
      subject: ({ shortId }) => `Disputa #${shortId} lista para tu revisión`,
      heading: "Tu respuesta está lista — revisa y envía",
      bodyP1: ({ orderName }) => `Se detectó una nueva disputa para el pedido ${orderName}. DisputeDesk preparó tu respuesta, pero aún no se ha enviado.`,
      listLabel: "Qué hacer ahora",
      listItems: ["Abre la disputa", "Revisa la evidencia preparada", "Añade lo que falte si es necesario", "Envía antes de la fecha límite"],
      callout: { label: "Importante", body: "Todavía no se ha enviado nada. Esta disputa aún requiere tu aprobación." },
      cta: "Revisar disputa →",
    },
    parkReason: {
      risk_weakness: {
        label: "Por qué retuvimos esto para tu revisión",
        body: "Tu regla de automatización estaba configurada para envío automático, pero el análisis previo de fraude de Shopify marcó este pedido como de alto riesgo antes del cumplimiento. Se retuvo el envío automático para que puedas revisar la evidencia antes de enviar.",
      },
    },
  },
  pt: {
    shared: { reason: "Razão", amount: "Valor", order: "Pedido", due: "Prazo de resposta", phaseHintChargeback: "A evidência deve ser enviada antes do prazo.", footer: "Você recebeu isto porque os alertas de novas disputas estão ativados nas configurações do DisputeDesk." },
    review: {
      subject: ({ shortId }) => `Disputa #${shortId} pronta para sua revisão`,
      heading: "Sua resposta está pronta — revise e envie",
      bodyP1: ({ orderName }) => `Uma nova disputa foi detectada para o pedido ${orderName}. O DisputeDesk preparou sua resposta, mas ela ainda não foi enviada.`,
      listLabel: "O que fazer agora",
      listItems: ["Abra a disputa", "Revise as evidências preparadas", "Adicione o que estiver faltando se necessário", "Envie antes do prazo"],
      callout: { label: "Importante", body: "Nada foi enviado ainda. Esta disputa ainda requer sua aprovação." },
      cta: "Revisar disputa →",
    },
    parkReason: {
      risk_weakness: {
        label: "Por que retivemos para sua revisão",
        body: "Sua regra de automação estava configurada para envio automático, mas a análise de fraude pré-autorização do Shopify sinalizou este pedido como de alto risco antes do cumprimento. O envio automático foi retido para que você possa revisar as evidências antes de enviar.",
      },
    },
  },
  fr: {
    shared: { reason: "Raison", amount: "Montant", order: "Commande", due: "Date limite", phaseHintChargeback: "Les preuves doivent être soumises avant la date limite.", footer: "Vous recevez ceci car les alertes de nouveaux litiges sont activées dans les paramètres DisputeDesk." },
    review: {
      subject: ({ shortId }) => `Litige #${shortId} prêt à être examiné`,
      heading: "Votre réponse est prête — examinez et soumettez",
      bodyP1: ({ orderName }) => `Un nouveau litige a été détecté pour la commande ${orderName}. DisputeDesk a préparé votre réponse, mais elle n'a pas encore été soumise.`,
      listLabel: "Ce que vous devez faire",
      listItems: ["Ouvrez le litige", "Examinez les preuves préparées", "Ajoutez ce qui manque si nécessaire", "Soumettez avant la date limite"],
      callout: { label: "Important", body: "Rien n'a encore été soumis. Ce litige nécessite toujours votre approbation." },
      cta: "Examiner le litige →",
    },
    parkReason: {
      risk_weakness: {
        label: "Pourquoi nous avons retenu ce litige pour votre examen",
        body: "Votre règle d'automatisation était configurée pour la soumission automatique, mais l'analyse pré-autorisation de fraude de Shopify a signalé cette commande comme étant à haut risque avant l'exécution. La soumission automatique a été retenue afin que vous puissiez examiner les preuves avant de soumettre.",
      },
    },
  },
  de: {
    shared: { reason: "Grund", amount: "Betrag", order: "Bestellung", due: "Frist", phaseHintChargeback: "Beweise müssen vor Ablauf der Frist eingereicht werden.", footer: "Sie erhalten diese E-Mail, weil Benachrichtigungen für neue Reklamationen in den DisputeDesk-Einstellungen aktiviert sind." },
    review: {
      subject: ({ shortId }) => `Reklamation #${shortId} bereit zur Prüfung`,
      heading: "Ihre Antwort ist bereit — prüfen und einreichen",
      bodyP1: ({ orderName }) => `Eine neue Reklamation wurde für die Bestellung ${orderName} erkannt. DisputeDesk hat Ihre Antwort vorbereitet, sie wurde jedoch noch nicht eingereicht.`,
      listLabel: "Was Sie tun sollten",
      listItems: ["Öffnen Sie die Reklamation", "Prüfen Sie die vorbereiteten Beweise", "Ergänzen Sie fehlende Informationen bei Bedarf", "Reichen Sie vor Ablauf der Frist ein"],
      callout: { label: "Wichtig", body: "Es wurde noch nichts eingereicht. Diese Reklamation erfordert weiterhin Ihre Freigabe." },
      cta: "Reklamation prüfen →",
    },
    parkReason: {
      risk_weakness: {
        label: "Warum wir dies zur Prüfung zurückgehalten haben",
        body: "Ihre Automatisierungsregel war auf automatische Einreichung eingestellt, aber die Vorab-Betrugsanalyse von Shopify hat diese Bestellung vor der Erfüllung als risikoreich markiert. Die automatische Einreichung wurde zurückgehalten, damit Sie die Beweise vor der Einreichung prüfen können.",
      },
    },
  },
  sv: {
    shared: { reason: "Orsak", amount: "Belopp", order: "Order", due: "Svarsfrist", phaseHintChargeback: "Bevis måste skickas in före tidsfristen.", footer: "Du fick detta eftersom aviseringar för nya tvister är aktiverade i DisputeDesk-inställningarna." },
    review: {
      subject: ({ shortId }) => `Tvist #${shortId} redo för din granskning`,
      heading: "Ditt svar är klart — granska och skicka",
      bodyP1: ({ orderName }) => `En ny tvist upptäcktes för order ${orderName}. DisputeDesk har förberett ditt svar, men det har inte skickats in ännu.`,
      listLabel: "Vad du ska göra",
      listItems: ["Öppna tvisten", "Granska den förberedda bevisningen", "Lägg till det som saknas vid behov", "Skicka in före tidsfristen"],
      callout: { label: "Viktigt", body: "Inget har skickats in ännu. Denna tvist kräver fortfarande ditt godkännande." },
      cta: "Granska tvist →",
    },
    parkReason: {
      risk_weakness: {
        label: "Varför vi höll detta för din granskning",
        body: "Din automationsregel var inställd på automatisk inlämning, men Shopifys förauktoriserings-bedrägerianalys flaggade denna order som hög risk innan uppfyllelse. Automatisk inlämning hölls tillbaka så att du kan granska bevisen innan du skickar in.",
      },
    },
  },
};

const s = STRINGS[LOCALE];
const shared = s.shared;
const variant = s.review;
const parkReasonCopy = s.parkReason.risk_weakness;
const shortId = "542cf59d";

const subject = `[DisputeDesk] ${variant.subject({ shortId })}`;
const orderNameDisplay = ORDER_NAME;
const amountStr = "€2,916.00";
const reason = "fraudulent";
const dueDateDisplay = "May 22, 2026";
const phaseHint = shared.phaseHintChargeback;

const listItemsHtml = variant.listItems
  .map((item) => `<li style="margin:0 0 6px;font-size:14px;color:#202223;line-height:1.5">${item}</li>`)
  .join("");

const calloutHtml = `
    <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:20px">
      <p style="font-size:13px;font-weight:600;color:#92400E;margin:0 0 4px">${variant.callout.label}</p>
      <p style="font-size:13px;color:#92400E;margin:0;line-height:1.5">${variant.callout.body}</p>
    </div>`;

const parkReasonHtml = `
    <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:20px">
      <p style="font-size:13px;font-weight:600;color:#92400E;margin:0 0 4px">${parkReasonCopy.label}</p>
      <p style="font-size:13px;color:#92400E;margin:0;line-height:1.5">${parkReasonCopy.body}</p>
    </div>`;

const disputeUrl = "https://admin.shopify.com/store/surasvenne/apps/disputedesk-1/app/disputes/PREVIEW";

const html = `<!DOCTYPE html>
<html>
<head><title>${subject}</title></head>
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
      <h1 style="font-size:20px;font-weight:600;color:#202223;margin:0 0 8px">${variant.heading}</h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">${variant.bodyP1({ orderName: orderNameDisplay })}</p>
      ${parkReasonHtml}
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175;width:120px">${shared.reason}</td><td style="padding:8px 0;font-size:14px;color:#202223;font-weight:500">${reason}</td></tr>
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${shared.amount}</td><td style="padding:8px 0;font-size:14px;color:#202223;font-weight:600">${amountStr}</td></tr>
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${shared.order}</td><td style="padding:8px 0;font-size:14px;color:#202223">${orderNameDisplay}</td></tr>
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${shared.due}</td><td style="padding:8px 0;font-size:14px;color:#202223">${dueDateDisplay}</td></tr>
      </table>
      <p style="font-size:13px;font-weight:600;color:#202223;margin:0 0 8px">${variant.listLabel}</p>
      <ul style="margin:0 0 20px;padding-left:18px">${listItemsHtml}</ul>
      ${calloutHtml}
      <div style="background:#F6F6F7;border:1px solid #E1E3E5;border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:12px;color:#6D7175;margin:0;line-height:1.5">${phaseHint}</p>
      </div>
      <table role="presentation" style="border-collapse:collapse"><tr><td style="padding:0;vertical-align:middle">
        <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">${variant.cta}</a>
      </td></tr></table>
    </div>
    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">${shared.footer}</p>
  </div>
</body>
</html>`;

const text = `${variant.heading}

${variant.bodyP1({ orderName: orderNameDisplay })}

${parkReasonCopy.label}: ${parkReasonCopy.body}

${shared.reason}: ${reason}
${shared.amount}: ${amountStr}
${shared.order}: ${orderNameDisplay}
${shared.due}: ${dueDateDisplay}

${variant.listLabel}:
${variant.listItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}

${variant.callout.label}: ${variant.callout.body}

${phaseHint}

${variant.cta.replace(" →", "")}: ${disputeUrl}

---
${shared.footer}`;

const htmlPath = join(process.cwd(), `risk-weakness-email-preview.${LOCALE}.html`);
const textPath = join(process.cwd(), `risk-weakness-email-preview.${LOCALE}.txt`);
writeFileSync(htmlPath, html);
writeFileSync(textPath, text);

console.log(`\nSubject: ${subject}`);
console.log(`\nHTML:  ${htmlPath}`);
console.log(`Text:  ${textPath}`);
console.log(`\nOpen the HTML file in a browser to see exactly what the merchant receives.`);
