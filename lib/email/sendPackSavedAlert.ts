/**
 * Send "evidence saved to Shopify" confirmation email to the merchant.
 *
 * Triggered after saveToShopifyJob completes successfully. Checks the
 * evidenceReady notification preference (reused — merchants who want to
 * know when evidence is ready also want to know when it's saved).
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { getServiceClient } from "@/lib/supabase/server";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk <notifications@mail.disputedesk.app>";

export interface PackSavedAlertContext {
  shopId: string;
  disputeId: string;
  packId: string;
  reason: string | null;
  amount: number | null;
  currencyCode: string | null;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface S {
  subject: (p: { reason: string; amount: string }) => string;
  heading: string;
  intro: (p: { reason: string; amount: string; shop: string }) => string;
  nextStep: string;
  ctaShopify: string;
  ctaDispute: string;
  footer: string;
}

const STRINGS: Record<Locale, S> = {
  en: {
    subject: ({ reason, amount }) => `Evidence saved: ${reason} dispute (${amount})`,
    heading: "Evidence saved to Shopify",
    intro: ({ reason, amount, shop }) => `The evidence pack for the <strong>${reason}</strong> dispute (${amount}) on ${shop} has been saved to Shopify.`,
    nextStep: "Open Shopify Admin to review and submit your response to the card network.",
    ctaShopify: "Open in Shopify Admin →",
    ctaDispute: "View dispute in DisputeDesk →",
    footer: "You received this because evidence alerts are enabled in DisputeDesk settings.",
  },
  es: {
    subject: ({ reason, amount }) => `Evidencia guardada: disputa ${reason} (${amount})`,
    heading: "Evidencia guardada en Shopify",
    intro: ({ reason, amount, shop }) => `El paquete de evidencia para la disputa <strong>${reason}</strong> (${amount}) en ${shop} ha sido guardado en Shopify.`,
    nextStep: "Abre Shopify Admin para revisar y enviar tu respuesta a la red de tarjetas.",
    ctaShopify: "Abrir en Shopify Admin →",
    ctaDispute: "Ver disputa en DisputeDesk →",
    footer: "Recibiste esto porque las alertas de evidencia están activadas en DisputeDesk.",
  },
  pt: {
    subject: ({ reason, amount }) => `Evidência salva: disputa ${reason} (${amount})`,
    heading: "Evidência salva no Shopify",
    intro: ({ reason, amount, shop }) => `O pacote de evidência para a disputa <strong>${reason}</strong> (${amount}) em ${shop} foi salvo no Shopify.`,
    nextStep: "Abra o Shopify Admin para revisar e enviar sua resposta à bandeira do cartão.",
    ctaShopify: "Abrir no Shopify Admin →",
    ctaDispute: "Ver disputa no DisputeDesk →",
    footer: "Você recebeu isto porque os alertas de evidência estão ativados nas configurações do DisputeDesk.",
  },
  fr: {
    subject: ({ reason, amount }) => `Preuves enregistrées : litige ${reason} (${amount})`,
    heading: "Preuves enregistrées sur Shopify",
    intro: ({ reason, amount, shop }) => `Le dossier de preuves pour le litige <strong>${reason}</strong> (${amount}) sur ${shop} a été enregistré sur Shopify.`,
    nextStep: "Ouvrez Shopify Admin pour vérifier et soumettre votre réponse au réseau de cartes.",
    ctaShopify: "Ouvrir dans Shopify Admin →",
    ctaDispute: "Voir le litige dans DisputeDesk →",
    footer: "Vous recevez ceci car les alertes de preuves sont activées dans les paramètres DisputeDesk.",
  },
  de: {
    subject: ({ reason, amount }) => `Beweise gespeichert: Reklamation ${reason} (${amount})`,
    heading: "Beweise in Shopify gespeichert",
    intro: ({ reason, amount, shop }) => `Das Beweispaket für die <strong>${reason}</strong>-Reklamation (${amount}) bei ${shop} wurde in Shopify gespeichert.`,
    nextStep: "Öffnen Sie Shopify Admin, um Ihre Antwort an das Kartennetzwerk zu prüfen und einzureichen.",
    ctaShopify: "In Shopify Admin öffnen →",
    ctaDispute: "Reklamation in DisputeDesk ansehen →",
    footer: "Sie erhalten dies, weil Beweisbenachrichtigungen in den DisputeDesk-Einstellungen aktiviert sind.",
  },
  sv: {
    subject: ({ reason, amount }) => `Bevis sparade: tvist ${reason} (${amount})`,
    heading: "Bevis sparade i Shopify",
    intro: ({ reason, amount, shop }) => `Bevispaketet för <strong>${reason}</strong>-tvisten (${amount}) på ${shop} har sparats i Shopify.`,
    nextStep: "Öppna Shopify Admin för att granska och skicka in ditt svar till kortnätverket.",
    ctaShopify: "Öppna i Shopify Admin →",
    ctaDispute: "Visa tvist i DisputeDesk →",
    footer: "Du fick detta eftersom bevisaviseringar är aktiverade i DisputeDesk-inställningarna.",
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

export async function sendPackSavedAlert(
  ctx: PackSavedAlertContext,
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
      evidenceReady?: boolean;
    } | null;
    if (notifications?.evidenceReady === false) return;

    const teamEmail = teamPayload?.teamEmail as string | undefined;
    if (!teamEmail) return;

    const storeLocale =
      (steps?.store_profile?.payload?.storeLocale as string | undefined) ?? null;
    const locale = resolveLocale(storeLocale);
    const s = STRINGS[locale];

    const [{ data: shop }, { data: dispute }] = await Promise.all([
      sb.from("shops").select("shop_domain").eq("id", ctx.shopId).single(),
      sb
        .from("disputes")
        .select("dispute_gid")
        .eq("id", ctx.disputeId)
        .single(),
    ]);
    const shopDomain = shop?.shop_domain ?? "";
    const shopName = shopDomain || "your store";
    const reason = reasonLabel(ctx.reason);
    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);

    const disputeUrl = getEmbeddedAppUrl(shopDomain || null, `disputes/${ctx.disputeId}`);
    const shopifyUrl =
      shopDomain && dispute?.dispute_gid
        ? getShopifyDisputeUrl(shopDomain, dispute.dispute_gid)
        : null;

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

      <table style="border-collapse:collapse;margin-bottom:16px" role="presentation"><tr>
        <td style="width:28px;height:28px;border-radius:50%;background:#DCFCE7;text-align:center;vertical-align:middle">
          <span style="color:#16A34A;font-size:14px;font-weight:700;line-height:28px">✓</span>
        </td>
        <td style="padding-left:8px;vertical-align:middle">
        <h1 style="font-size:20px;font-weight:600;color:#202223;margin:0">
          ${s.heading}
        </h1>
        </td>
      </tr></table>

      <p style="font-size:14px;color:#6D7175;margin:0 0 16px;line-height:1.5">
        ${s.intro({ reason, amount: amountStr, shop: shopName })}
      </p>

      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:13px;color:#1E40AF;margin:0;line-height:1.5">
          ${s.nextStep}
        </p>
      </div>

      <div>
        ${shopifyUrl ? `<a href="${shopifyUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;margin-right:12px;margin-bottom:8px">${s.ctaShopify.replace(" →", " →")}</a>` : ""}
        <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#F3F4F6;color:#374151;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;margin-bottom:8px">${s.ctaDispute.replace(" →", " →")}</a>
      </div>
    </div>
    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">${s.footer}</p>
  </div>
</body>
</html>`;

    const text = `${s.heading}

${s.intro({ reason, amount: amountStr, shop: shopName }).replace(/<[^>]+>/g, "")}

${s.nextStep}

${shopifyUrl ? `${s.ctaShopify.replace(" →", "")}: ${shopifyUrl}` : ""}
${s.ctaDispute.replace(" →", "")}: ${disputeUrl}

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
      "[email] Pack saved alert failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
