/**
 * Send "48h before due date" reminder email to the merchant.
 *
 * Called by the dispute-reminders cron. Checks the `beforeDue`
 * notification preference before sending.
 * Fire-and-forget — never throws.
 *
 * The email says what will happen at the deadline for THIS dispute. We know
 * the shop's setting, so we never ask the merchant to go and check it
 * (2026-10-02). `filingMode` is resolved by the cron through the same gate the
 * deadline cron files through (lib/automation/merchantApprovalGate.ts):
 *  - "auto": nothing to do, DisputeDesk files by the deadline; opening the
 *    dispute is optional.
 *  - "approved": the merchant approved it; it is filed on the deadline.
 *  - "awaiting_approval": nothing is filed until the merchant approves.
 * Every reminder also tells the merchant where to turn these reminders off.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";
import { escapeHtml } from "@/lib/email/escapeHtml";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = DEFAULT_FROM_EMAIL;
const REPLY_TO = DEFAULT_REPLY_TO;

export type DueReminderFilingMode = "auto" | "approved" | "awaiting_approval";

export interface DueReminderContext {
  to: string;
  locale: string;
  shopName: string;
  shopDomain?: string | null;
  disputeId: string;
  reason: string | null;
  phase: string | null;
  amount: number | null;
  currencyCode: string | null;
  dueAt: string;
  orderName: string | null;
  packStatus: string | null;
  filingMode: DueReminderFilingMode;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface S {
  subject: (p: { reason: string; hours: number }) => string;
  heading: (p: { hours: number }) => string;
  intro: (p: { shop: string; reason: string; amount: string }) => string;
  autoNoAction: string;
  approvedNoAction: string;
  awaitingApproval: string;
  packNotStarted: string;
  packSaved: string;
  due: string;
  order: string;
  cta: string;
  ctaOptional: string;
  /** Sentence before the settings link; the setting's name is wrapped in <em>. */
  turnOff: (p: { setting: string }) => string;
  turnOffLink: string;
}

const STRINGS: Record<Locale, S> = {
  en: {
    subject: ({ reason, hours }) => `Reminder: ${reason} dispute due in ${hours}h`,
    heading: ({ hours }) => `Response due in ${hours} hours`,
    intro: ({ shop, reason, amount }) => `The <strong>${reason}</strong> dispute (${amount}) for ${shop} is approaching its deadline.`,
    autoNoAction: "Your store is set to full automation, so you don't need to do anything. DisputeDesk will file this response with Shopify by the deadline. If you'd like to look it over first, you can open the dispute.",
    approvedNoAction: "You've approved this response, so you don't need to do anything. DisputeDesk will file it with Shopify on the deadline.",
    awaitingApproval: "Your store is set to require your approval, so nothing is filed until you approve it. Open the dispute to review and approve the response before the deadline — otherwise no response will be filed.",
    packNotStarted: "No evidence pack has been started yet. Open the dispute to build one.",
    packSaved: "Your response has already been submitted to Shopify for this dispute.",
    due: "Due",
    order: "Order",
    cta: "Open dispute →",
    ctaOptional: "Review dispute (optional) →",
    turnOff: ({ setting }) => `Don't need these reminders? Turn off ${setting} under Notifications in`,
    turnOffLink: "DisputeDesk settings",
  },
  es: {
    subject: ({ reason, hours }) => `Recordatorio: disputa ${reason} vence en ${hours}h`,
    heading: ({ hours }) => `Respuesta vence en ${hours} horas`,
    intro: ({ shop, reason, amount }) => `La disputa <strong>${reason}</strong> (${amount}) para ${shop} se acerca a su fecha límite.`,
    autoNoAction: "Tu tienda está configurada con automatización completa, así que no necesitas hacer nada. DisputeDesk enviará esta respuesta a Shopify antes de la fecha límite. Si quieres revisarla antes, puedes abrir la disputa.",
    approvedNoAction: "Ya aprobaste esta respuesta, así que no necesitas hacer nada. DisputeDesk la enviará a Shopify en la fecha límite.",
    awaitingApproval: "Tu tienda está configurada para requerir tu aprobación, así que no se envía nada hasta que la apruebes. Abre la disputa para revisar y aprobar la respuesta antes de la fecha límite; de lo contrario, no se enviará ninguna respuesta.",
    packNotStarted: "Aún no se ha iniciado ningún paquete de evidencia. Abre la disputa para crear uno.",
    packSaved: "Tu respuesta ya se ha enviado a Shopify para esta disputa.",
    due: "Vence",
    order: "Pedido",
    cta: "Abrir disputa →",
    ctaOptional: "Revisar disputa (opcional) →",
    turnOff: ({ setting }) => `¿No necesitas estos recordatorios? Desactiva ${setting} en Notificaciones, en la`,
    turnOffLink: "configuración de DisputeDesk",
  },
  pt: {
    subject: ({ reason, hours }) => `Lembrete: disputa ${reason} vence em ${hours}h`,
    heading: ({ hours }) => `Resposta devida em ${hours} horas`,
    intro: ({ shop, reason, amount }) => `A disputa <strong>${reason}</strong> (${amount}) para ${shop} está se aproximando do prazo.`,
    autoNoAction: "A sua loja está configurada com automação total, então você não precisa fazer nada. O DisputeDesk enviará esta resposta ao Shopify até o prazo. Se quiser revisá-la antes, pode abrir a disputa.",
    approvedNoAction: "Você já aprovou esta resposta, então não precisa fazer nada. O DisputeDesk a enviará ao Shopify no prazo.",
    awaitingApproval: "A sua loja está configurada para exigir a sua aprovação, então nada é enviado até você aprovar. Abra a disputa para revisar e aprovar a resposta antes do prazo — caso contrário, nenhuma resposta será enviada.",
    packNotStarted: "Nenhum pacote de evidência foi iniciado ainda. Abra a disputa para criar um.",
    packSaved: "A sua resposta já foi enviada ao Shopify para esta disputa.",
    due: "Prazo",
    order: "Pedido",
    cta: "Abrir disputa →",
    ctaOptional: "Revisar disputa (opcional) →",
    turnOff: ({ setting }) => `Não precisa destes lembretes? Desative ${setting} em Notificações, nas`,
    turnOffLink: "configurações do DisputeDesk",
  },
  fr: {
    subject: ({ reason, hours }) => `Rappel : litige ${reason} dû dans ${hours}h`,
    heading: ({ hours }) => `Réponse due dans ${hours} heures`,
    intro: ({ shop, reason, amount }) => `Le litige <strong>${reason}</strong> (${amount}) pour ${shop} approche de sa date limite.`,
    autoNoAction: "Votre boutique est en automatisation complète : vous n'avez rien à faire. DisputeDesk enverra cette réponse à Shopify avant la date limite. Si vous souhaitez la consulter avant, vous pouvez ouvrir le litige.",
    approvedNoAction: "Vous avez approuvé cette réponse : vous n'avez rien à faire. DisputeDesk l'enverra à Shopify à la date limite.",
    awaitingApproval: "Votre boutique exige votre approbation : rien n'est envoyé tant que vous n'avez pas approuvé. Ouvrez le litige pour vérifier et approuver la réponse avant la date limite — sinon, aucune réponse ne sera envoyée.",
    packNotStarted: "Aucun dossier de preuves n'a été commencé. Ouvrez le litige pour en créer un.",
    packSaved: "Votre réponse a déjà été envoyée à Shopify pour ce litige.",
    due: "Échéance",
    order: "Commande",
    cta: "Ouvrir le litige →",
    ctaOptional: "Consulter le litige (facultatif) →",
    turnOff: ({ setting }) => `Vous n'avez pas besoin de ces rappels ? Désactivez ${setting} dans Notifications, dans les`,
    turnOffLink: "paramètres DisputeDesk",
  },
  de: {
    subject: ({ reason, hours }) => `Erinnerung: Reklamation ${reason} fällig in ${hours}h`,
    heading: ({ hours }) => `Antwort fällig in ${hours} Stunden`,
    intro: ({ shop, reason, amount }) => `Die <strong>${reason}</strong>-Reklamation (${amount}) für ${shop} nähert sich der Frist.`,
    autoNoAction: "Ihr Shop ist auf vollständige Automatisierung eingestellt – Sie müssen nichts tun. DisputeDesk reicht diese Antwort fristgerecht bei Shopify ein. Wenn Sie sie vorher ansehen möchten, können Sie die Reklamation öffnen.",
    approvedNoAction: "Sie haben diese Antwort freigegeben – Sie müssen nichts tun. DisputeDesk reicht sie zur Frist bei Shopify ein.",
    awaitingApproval: "Ihr Shop verlangt Ihre Freigabe – ohne Freigabe wird nichts eingereicht. Öffnen Sie die Reklamation, um die Antwort vor der Frist zu prüfen und freizugeben. Andernfalls wird keine Antwort eingereicht.",
    packNotStarted: "Es wurde noch kein Beweispaket erstellt. Öffnen Sie die Reklamation, um eines zu erstellen.",
    packSaved: "Ihre Antwort wurde für diese Reklamation bereits an Shopify übermittelt.",
    due: "Fällig",
    order: "Bestellung",
    cta: "Reklamation öffnen →",
    ctaOptional: "Reklamation ansehen (optional) →",
    turnOff: ({ setting }) => `Sie brauchen diese Erinnerungen nicht? Deaktivieren Sie ${setting} unter Benachrichtigungen in den`,
    turnOffLink: "DisputeDesk-Einstellungen",
  },
  sv: {
    subject: ({ reason, hours }) => `Påminnelse: tvist ${reason} förfaller om ${hours}h`,
    heading: ({ hours }) => `Svar förfaller om ${hours} timmar`,
    intro: ({ shop, reason, amount }) => `Tvisten <strong>${reason}</strong> (${amount}) för ${shop} närmar sig sin tidsfrist.`,
    autoNoAction: "Din butik har full automatisering, så du behöver inte göra något. DisputeDesk skickar in svaret till Shopify före deadline. Vill du titta på det först kan du öppna tvisten.",
    approvedNoAction: "Du har godkänt svaret, så du behöver inte göra något. DisputeDesk skickar in det till Shopify på deadline.",
    awaitingApproval: "Din butik kräver ditt godkännande, så inget skickas in förrän du godkänner. Öppna tvisten och granska och godkänn svaret före deadline – annars skickas inget svar in.",
    packNotStarted: "Inget bevispaket har skapats ännu. Öppna tvisten för att skapa ett.",
    packSaved: "Ditt svar har redan skickats till Shopify för den här tvisten.",
    due: "Förfaller",
    order: "Order",
    cta: "Öppna tvist →",
    ctaOptional: "Granska tvisten (valfritt) →",
    turnOff: ({ setting }) => `Behöver du inte de här påminnelserna? Stäng av ${setting} under Aviseringar i`,
    turnOffLink: "DisputeDesk-inställningarna",
  },
};

/** The reminder toggle's label in Settings → Notifications (messages/{locale}.json settings.notifBeforeDue). */
const BEFORE_DUE_SETTING: Record<Locale, string> = {
  en: "Before due date",
  es: "Antes del vencimiento",
  pt: "Antes do prazo",
  fr: "Avant l'échéance",
  de: "Vor Fälligkeit",
  sv: "Innan förfallodatum",
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
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code ?? "USD" }).format(amount);
  } catch {
    return `${code ?? "$"}${amount.toFixed(2)}`;
  }
}

function reasonLabel(reason: string | null): string {
  if (!reason) return "dispute";
  return reason.replace(/_/g, " ").toLowerCase();
}

const SAVED_STATUSES = new Set([
  "saved_to_shopify",
  "saved_to_shopify_unverified",
  "saved_to_shopify_verified",
]);
const PACK_IN_HAND = new Set(["ready", "queued", "building"]);

/**
 * What the merchant needs to know for this dispute, and whether they need to
 * act. Exported for tests.
 */
export function dueReminderHint(
  s: S,
  status: string | null,
  mode: DueReminderFilingMode,
): { text: string; actionNeeded: boolean } {
  if (status && SAVED_STATUSES.has(status)) return { text: s.packSaved, actionNeeded: false };
  if (mode === "awaiting_approval") return { text: s.awaitingApproval, actionNeeded: true };
  if (!status || !PACK_IN_HAND.has(status)) return { text: s.packNotStarted, actionNeeded: true };
  if (mode === "approved") return { text: s.approvedNoAction, actionNeeded: false };
  return { text: s.autoNoAction, actionNeeded: false };
}

export function dueReminderStrings(locale: string | null | undefined): S {
  return STRINGS[resolveLocale(locale)];
}

export async function sendDueReminder(ctx: DueReminderContext): Promise<boolean> {
  if (!RESEND_API_KEY) return false;

  try {
    const locale = resolveLocale(ctx.locale);
    const s = STRINGS[locale];
    const disputeUrl = getEmbeddedAppUrl(ctx.shopDomain ?? null, `disputes/${ctx.disputeId}`);
    const settingsUrl = getEmbeddedAppUrl(ctx.shopDomain ?? null, "settings");
    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);
    const reason = reasonLabel(ctx.reason);
    const hoursLeft = Math.max(0, Math.round((new Date(ctx.dueAt).getTime() - Date.now()) / (1000 * 60 * 60)));
    const dueDate = new Date(ctx.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const hint = dueReminderHint(s, ctx.packStatus, ctx.filingMode);
    const cta = hint.actionNeeded ? s.cta : s.ctaOptional;
    const box = hint.actionNeeded
      ? { bg: "#FEF3C7", border: "#FCD34D", fg: "#92400E" }
      : { bg: "#ECFDF5", border: "#A7F3D0", fg: "#065F46" };
    const setting = BEFORE_DUE_SETTING[locale];

    const subject = `[DisputeDesk] ${s.subject({ reason, hours: hoursLeft })}`;

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
        ${s.heading({ hours: hoursLeft })}
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        ${s.intro({ shop: escapeHtml(ctx.shopName), reason, amount: amountStr })}
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        ${ctx.orderName ? `<tr><td style="padding:6px 0;font-size:13px;color:#6D7175;width:100px">${s.order}</td><td style="padding:6px 0;font-size:14px;color:#202223">${ctx.orderName}</td></tr>` : ""}
        <tr><td style="padding:6px 0;font-size:13px;color:#6D7175">${s.due}</td><td style="padding:6px 0;font-size:14px;color:#202223;font-weight:600">${dueDate} (${hoursLeft}h)</td></tr>
      </table>

      <div style="background:${box.bg};border:1px solid ${box.border};border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:13px;color:${box.fg};margin:0;line-height:1.5">${hint.text}</p>
      </div>

      <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        ${cta}
      </a>
    </div>
    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0;line-height:1.5">${s.turnOff({ setting: `<em>${setting}</em>` })} <a href="${settingsUrl}" style="color:#8C9196;text-decoration:underline">${s.turnOffLink}</a>.</p>
  </div>
</body>
</html>`;

    const text = `${s.heading({ hours: hoursLeft })}

${reason} — ${amountStr}
${ctx.orderName ? `${s.order}: ${ctx.orderName}` : ""}
${s.due}: ${dueDate} (${hoursLeft}h)

${hint.text}

${cta.replace(" →", "")}: ${disputeUrl}

---
${s.turnOff({ setting: `"${setting}"` })} ${s.turnOffLink}: ${settingsUrl}`;

    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: ctx.to.includes(",") ? ctx.to.split(",").map((e) => e.trim()) : ctx.to,
      subject,
      html,
      text,
    });

    if (error) {
      console.error("[email] Due reminder send failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] Due reminder failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
