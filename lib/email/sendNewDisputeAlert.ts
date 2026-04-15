/**
 * Send "new dispute detected" email to the merchant.
 *
 * Triggered in syncDisputes when a dispute is upserted for the first time.
 * Checks the `newDispute` notification preference before sending.
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { getServiceClient } from "@/lib/supabase/server";

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
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface EmailStrings {
  subject: (p: { reason: string; amount: string }) => string;
  heading: string;
  intro: (p: { phase: string; shop: string }) => string;
  reason: string;
  amount: string;
  order: string;
  due: string;
  phaseHintInquiry: string;
  phaseHintChargeback: string;
  cta: string;
  footer: string;
}

const STRINGS: Record<Locale, EmailStrings> = {
  en: {
    subject: ({ reason, amount }) => `New ${reason} dispute — ${amount}`,
    heading: "New dispute detected",
    intro: ({ phase, shop }) => `A new <strong>${phase}</strong> dispute just arrived for ${shop}.`,
    reason: "Reason",
    amount: "Amount",
    order: "Order",
    due: "Response due",
    phaseHintInquiry: "This is a soft inquiry — respond quickly to prevent escalation to a chargeback.",
    phaseHintChargeback: "Evidence must be submitted before the deadline.",
    cta: "View dispute →",
    footer: "You received this because new-dispute alerts are enabled in DisputeDesk settings.",
  },
  es: {
    subject: ({ reason, amount }) => `Nueva disputa ${reason} — ${amount}`,
    heading: "Nueva disputa detectada",
    intro: ({ phase, shop }) => `Una nueva disputa de tipo <strong>${phase}</strong> acaba de llegar para ${shop}.`,
    reason: "Razón",
    amount: "Monto",
    order: "Pedido",
    due: "Fecha límite",
    phaseHintInquiry: "Esta es una consulta suave — responde rápido para evitar que escale a un chargeback.",
    phaseHintChargeback: "La evidencia debe enviarse antes de la fecha límite.",
    cta: "Ver disputa →",
    footer: "Recibiste esto porque las alertas de nuevas disputas están activadas en la configuración de DisputeDesk.",
  },
  pt: {
    subject: ({ reason, amount }) => `Nova disputa ${reason} — ${amount}`,
    heading: "Nova disputa detectada",
    intro: ({ phase, shop }) => `Uma nova disputa do tipo <strong>${phase}</strong> chegou para ${shop}.`,
    reason: "Razão",
    amount: "Valor",
    order: "Pedido",
    due: "Prazo de resposta",
    phaseHintInquiry: "Esta é uma consulta leve — responda rapidamente para evitar que escale para um chargeback.",
    phaseHintChargeback: "A evidência deve ser enviada antes do prazo.",
    cta: "Ver disputa →",
    footer: "Você recebeu isto porque os alertas de novas disputas estão ativados nas configurações do DisputeDesk.",
  },
  fr: {
    subject: ({ reason, amount }) => `Nouveau litige ${reason} — ${amount}`,
    heading: "Nouveau litige détecté",
    intro: ({ phase, shop }) => `Un nouveau litige de type <strong>${phase}</strong> vient d'arriver pour ${shop}.`,
    reason: "Raison",
    amount: "Montant",
    order: "Commande",
    due: "Date limite",
    phaseHintInquiry: "Il s'agit d'une consultation — répondez rapidement pour éviter une escalade en chargeback.",
    phaseHintChargeback: "Les preuves doivent être soumises avant la date limite.",
    cta: "Voir le litige →",
    footer: "Vous recevez ceci car les alertes de nouveaux litiges sont activées dans les paramètres DisputeDesk.",
  },
  de: {
    subject: ({ reason, amount }) => `Neue Reklamation ${reason} — ${amount}`,
    heading: "Neue Reklamation erkannt",
    intro: ({ phase, shop }) => `Eine neue <strong>${phase}</strong>-Reklamation ist für ${shop} eingegangen.`,
    reason: "Grund",
    amount: "Betrag",
    order: "Bestellung",
    due: "Frist",
    phaseHintInquiry: "Dies ist eine Anfrage — antworten Sie schnell, um eine Eskalation zum Chargeback zu vermeiden.",
    phaseHintChargeback: "Beweise müssen vor Ablauf der Frist eingereicht werden.",
    cta: "Reklamation ansehen →",
    footer: "Sie erhalten diese E-Mail, weil Benachrichtigungen für neue Reklamationen in den DisputeDesk-Einstellungen aktiviert sind.",
  },
  sv: {
    subject: ({ reason, amount }) => `Ny tvist ${reason} — ${amount}`,
    heading: "Ny tvist upptäckt",
    intro: ({ phase, shop }) => `En ny <strong>${phase}</strong>-tvist har kommit in för ${shop}.`,
    reason: "Orsak",
    amount: "Belopp",
    order: "Order",
    due: "Svarsfrist",
    phaseHintInquiry: "Detta är en mjuk förfrågan — svara snabbt för att undvika eskalering till en tvist.",
    phaseHintChargeback: "Bevis måste skickas in före tidsfristen.",
    cta: "Visa tvist →",
    footer: "Du fick detta eftersom aviseringar för nya tvister är aktiverade i DisputeDesk-inställningarna.",
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

function phaseLabel(phase: string | null): string {
  if (phase === "inquiry") return "inquiry";
  return "chargeback";
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

    const { data: shop } = await sb
      .from("shops")
      .select("shop_domain")
      .eq("id", ctx.shopId)
      .single();
    const shopName = shop?.shop_domain ?? "your store";

    const disputeUrl = getEmbeddedAppUrl(shop?.shop_domain ?? null, `disputes/${ctx.disputeId}`);
    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);
    const reason = reasonLabel(ctx.reason);
    const phase = phaseLabel(ctx.phase);
    const phaseHint =
      ctx.phase === "inquiry" ? s.phaseHintInquiry : s.phaseHintChargeback;

    const subject = `[DisputeDesk] ${s.subject({ reason, amount: amountStr })}`;

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
        ${s.heading}
      </h1>
      <p style="font-size:14px;color:#6D7175;margin:0 0 20px;line-height:1.5">
        ${s.intro({ phase, shop: shopName })}
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175;width:120px">${s.reason}</td><td style="padding:8px 0;font-size:14px;color:#202223;font-weight:500">${reason}</td></tr>
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${s.amount}</td><td style="padding:8px 0;font-size:14px;color:#202223;font-weight:600">${amountStr}</td></tr>
        ${ctx.orderName ? `<tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${s.order}</td><td style="padding:8px 0;font-size:14px;color:#202223">${ctx.orderName}</td></tr>` : ""}
        <tr><td style="padding:8px 0;font-size:13px;color:#6D7175">${s.due}</td><td style="padding:8px 0;font-size:14px;color:#202223">${formatDate(ctx.dueAt)}</td></tr>
      </table>

      <div style="background:${ctx.phase === "inquiry" ? "#EFF6FF;border:1px solid #BFDBFE" : "#FEF3C7;border:1px solid #FCD34D"};border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:13px;color:${ctx.phase === "inquiry" ? "#1E40AF" : "#92400E"};margin:0;line-height:1.5">
          ${phaseHint}
        </p>
      </div>

      <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">
        ${s.cta}
      </a>
    </div>

    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">
      ${s.footer}
    </p>
  </div>
</body>
</html>`;

    const text = `${s.heading}

${reason} — ${amountStr}
${ctx.orderName ? `${s.order}: ${ctx.orderName}` : ""}
${s.due}: ${formatDate(ctx.dueAt)}

${phaseHint}

${s.cta.replace(" →", "")}: ${disputeUrl}

---
${s.footer}`;

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,
      replyTo: REPLY_TO,
      to: teamEmail.includes(",") ? teamEmail.split(",").map((e) => e.trim()) : teamEmail,
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
