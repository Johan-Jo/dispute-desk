/**
 * Send "48h before due date" reminder email to the merchant.
 *
 * Called by the dispute-reminders cron. Checks the `beforeDue`
 * notification preference before sending.
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export interface DueReminderContext {
  to: string;
  locale: string;
  shopName: string;
  disputeId: string;
  reason: string | null;
  phase: string | null;
  amount: number | null;
  currencyCode: string | null;
  dueAt: string;
  orderName: string | null;
  packStatus: string | null;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface S {
  subject: (p: { reason: string; hours: number }) => string;
  heading: (p: { hours: number }) => string;
  intro: (p: { shop: string; reason: string; amount: string }) => string;
  packReady: string;
  packNotStarted: string;
  packBuilding: string;
  packSaved: string;
  due: string;
  order: string;
  cta: string;
  footer: string;
}

const STRINGS: Record<Locale, S> = {
  en: {
    subject: ({ reason, hours }) => `Reminder: ${reason} dispute due in ${hours}h`,
    heading: ({ hours }) => `Response due in ${hours} hours`,
    intro: ({ shop, reason, amount }) => `The <strong>${reason}</strong> dispute (${amount}) for ${shop} is approaching its deadline.`,
    packReady: "Your evidence pack is ready to review and save to Shopify.",
    packNotStarted: "No evidence pack has been started yet. Open the dispute to build one.",
    packBuilding: "An evidence pack is being built automatically.",
    packSaved: "Evidence has already been saved to Shopify. Open Shopify Admin to submit.",
    due: "Due",
    order: "Order",
    cta: "Open dispute →",
    footer: "You received this because due-date reminders are enabled in DisputeDesk settings.",
  },
  es: {
    subject: ({ reason, hours }) => `Recordatorio: disputa ${reason} vence en ${hours}h`,
    heading: ({ hours }) => `Respuesta vence en ${hours} horas`,
    intro: ({ shop, reason, amount }) => `La disputa <strong>${reason}</strong> (${amount}) para ${shop} se acerca a su fecha límite.`,
    packReady: "Tu paquete de evidencia está listo para revisar y guardar en Shopify.",
    packNotStarted: "Aún no se ha iniciado ningún paquete de evidencia. Abre la disputa para crear uno.",
    packBuilding: "Se está generando un paquete de evidencia automáticamente.",
    packSaved: "La evidencia ya fue guardada en Shopify. Abre Shopify Admin para enviarla.",
    due: "Vence",
    order: "Pedido",
    cta: "Abrir disputa →",
    footer: "Recibiste esto porque los recordatorios de fecha límite están activados en DisputeDesk.",
  },
  pt: {
    subject: ({ reason, hours }) => `Lembrete: disputa ${reason} vence em ${hours}h`,
    heading: ({ hours }) => `Resposta devida em ${hours} horas`,
    intro: ({ shop, reason, amount }) => `A disputa <strong>${reason}</strong> (${amount}) para ${shop} está se aproximando do prazo.`,
    packReady: "Seu pacote de evidência está pronto para revisar e salvar no Shopify.",
    packNotStarted: "Nenhum pacote de evidência foi iniciado ainda. Abra a disputa para criar um.",
    packBuilding: "Um pacote de evidência está sendo gerado automaticamente.",
    packSaved: "A evidência já foi salva no Shopify. Abra o Shopify Admin para enviar.",
    due: "Prazo",
    order: "Pedido",
    cta: "Abrir disputa →",
    footer: "Você recebeu isto porque os lembretes de prazo estão ativados nas configurações do DisputeDesk.",
  },
  fr: {
    subject: ({ reason, hours }) => `Rappel : litige ${reason} dû dans ${hours}h`,
    heading: ({ hours }) => `Réponse due dans ${hours} heures`,
    intro: ({ shop, reason, amount }) => `Le litige <strong>${reason}</strong> (${amount}) pour ${shop} approche de sa date limite.`,
    packReady: "Votre dossier de preuves est prêt à vérifier et enregistrer sur Shopify.",
    packNotStarted: "Aucun dossier de preuves n'a été commencé. Ouvrez le litige pour en créer un.",
    packBuilding: "Un dossier de preuves est en cours de génération.",
    packSaved: "Les preuves ont déjà été enregistrées sur Shopify. Ouvrez Shopify Admin pour les soumettre.",
    due: "Échéance",
    order: "Commande",
    cta: "Ouvrir le litige →",
    footer: "Vous recevez ceci car les rappels de date limite sont activés dans les paramètres DisputeDesk.",
  },
  de: {
    subject: ({ reason, hours }) => `Erinnerung: Reklamation ${reason} fällig in ${hours}h`,
    heading: ({ hours }) => `Antwort fällig in ${hours} Stunden`,
    intro: ({ shop, reason, amount }) => `Die <strong>${reason}</strong>-Reklamation (${amount}) für ${shop} nähert sich der Frist.`,
    packReady: "Ihr Beweispaket ist bereit zur Überprüfung und Speicherung in Shopify.",
    packNotStarted: "Es wurde noch kein Beweispaket erstellt. Öffnen Sie die Reklamation, um eines zu erstellen.",
    packBuilding: "Ein Beweispaket wird automatisch erstellt.",
    packSaved: "Beweise wurden bereits in Shopify gespeichert. Öffnen Sie Shopify Admin zum Einreichen.",
    due: "Fällig",
    order: "Bestellung",
    cta: "Reklamation öffnen →",
    footer: "Sie erhalten dies, weil Fristerinnerungen in den DisputeDesk-Einstellungen aktiviert sind.",
  },
  sv: {
    subject: ({ reason, hours }) => `Påminnelse: tvist ${reason} förfaller om ${hours}h`,
    heading: ({ hours }) => `Svar förfaller om ${hours} timmar`,
    intro: ({ shop, reason, amount }) => `Tvisten <strong>${reason}</strong> (${amount}) för ${shop} närmar sig sin tidsfrist.`,
    packReady: "Ditt bevispaket är redo att granska och spara till Shopify.",
    packNotStarted: "Inget bevispaket har skapats ännu. Öppna tvisten för att skapa ett.",
    packBuilding: "Ett bevispaket skapas automatiskt.",
    packSaved: "Bevis har redan sparats i Shopify. Öppna Shopify Admin för att skicka in.",
    due: "Förfaller",
    order: "Order",
    cta: "Öppna tvist →",
    footer: "Du fick detta eftersom påminnelser om tidsfrister är aktiverade i DisputeDesk-inställningarna.",
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
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code ?? "USD" }).format(amount);
  } catch {
    return `${code ?? "$"}${amount.toFixed(2)}`;
  }
}

function reasonLabel(reason: string | null): string {
  if (!reason) return "dispute";
  return reason.replace(/_/g, " ").toLowerCase();
}

function packStatusHint(s: S, status: string | null): string {
  if (!status) return s.packNotStarted;
  if (status === "ready") return s.packReady;
  if (status === "saved_to_shopify") return s.packSaved;
  if (status === "queued" || status === "building") return s.packBuilding;
  return s.packNotStarted;
}

export async function sendDueReminder(ctx: DueReminderContext): Promise<boolean> {
  if (!RESEND_API_KEY) return false;

  try {
    const locale = resolveLocale(ctx.locale);
    const s = STRINGS[locale];
    const baseUrl = getPublicSiteBaseUrl();
    const disputeUrl = `${baseUrl}/app/disputes/${ctx.disputeId}`;
    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);
    const reason = reasonLabel(ctx.reason);
    const hoursLeft = Math.max(0, Math.round((new Date(ctx.dueAt).getTime() - Date.now()) / (1000 * 60 * 60)));
    const dueDate = new Date(ctx.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const hint = packStatusHint(s, ctx.packStatus);

    const subject = `[DisputeDesk] ${s.subject({ reason, hours: hoursLeft })}`;

    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F6F6F7">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;border:1px solid #E1E3E5;padding:32px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
        <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);display:flex;align-items:center;justify-content:center">
          <span style="color:#fff;font-size:16px;font-weight:700">D</span>
        </div>
        <span style="font-size:15px;font-weight:600;color:#202223">DisputeDesk</span>
      </div>

      <h1 style="font-size:20px;font-weight:600;color:#202223;margin:0 0 8px">
        ${s.heading({ hours: hoursLeft })}
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        ${s.intro({ shop: ctx.shopName, reason, amount: amountStr })}
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        ${ctx.orderName ? `<tr><td style="padding:6px 0;font-size:13px;color:#6D7175;width:100px">${s.order}</td><td style="padding:6px 0;font-size:14px;color:#202223">${ctx.orderName}</td></tr>` : ""}
        <tr><td style="padding:6px 0;font-size:13px;color:#6D7175">${s.due}</td><td style="padding:6px 0;font-size:14px;color:#202223;font-weight:600">${dueDate} (${hoursLeft}h)</td></tr>
      </table>

      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:13px;color:#92400E;margin:0;line-height:1.5">${hint}</p>
      </div>

      <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        ${s.cta}
      </a>
    </div>
    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">${s.footer}</p>
  </div>
</body>
</html>`;

    const text = `${s.heading({ hours: hoursLeft })}

${reason} — ${amountStr}
${ctx.orderName ? `${s.order}: ${ctx.orderName}` : ""}
${s.due}: ${dueDate} (${hoursLeft}h)

${hint}

${s.cta.replace(" →", "")}: ${disputeUrl}

---
${s.footer}`;

    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: ctx.to,
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
