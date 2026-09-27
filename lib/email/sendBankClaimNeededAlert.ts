/**
 * "Copy the bank's claim from Shopify" — targeted merchant email.
 *
 * Sent when a dispute starts needing the bank's claim (lib/disputes/bankClaim.ts):
 * Shopify reopened an answered dispute, or it is a `general` dispute with no
 * network reason code. The claim is visible only in Shopify Admin, so nothing
 * is filed until the merchant copies it across; without an email, a merchant
 * who does not open the app would find out at the deadline.
 *
 * The CTA deep-links to the exact place: the dispute page, `?section=bank-claim`,
 * where BankClaimCard takes the claim. A second link opens the ORDER in
 * Shopify Admin, whose chargeback details show the claim.
 *
 * Recipient + preference: shop_setup team.payload.teamEmail, gated by the
 * evidenceReady toggle — the same contract as the other evidence emails.
 * Dedupe (once per dispute and response cycle) is the caller's job.
 * Fire-and-forget — never throws.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { getServiceClient } from "@/lib/supabase/server";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";
import { getShopifyOrderUrl } from "@/lib/shopify/shopifyAdminUrl";
import type { BankClaimTrigger } from "@/lib/disputes/bankClaim";

export interface BankClaimNeededAlertContext {
  shopId: string;
  disputeId: string;
  trigger: BankClaimTrigger;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface S {
  subject: (p: { order: string }) => string;
  heading: string;
  introReopened: (p: { order: string; amount: string }) => string;
  introGeneral: (p: { order: string; amount: string }) => string;
  why: string;
  steps: string[];
  holdNote: string;
  dueLabel: string;
  ctaDispute: string;
  ctaShopify: string;
  footer: string;
}

const STRINGS: Record<Locale, S> = {
  en: {
    subject: ({ order }) => `Action needed: copy the bank's claim for ${order}`,
    heading: "We need the bank's claim to answer this dispute",
    introReopened: ({ order, amount }) =>
      `Shopify has reopened the dispute on order <strong>${order}</strong> (${amount}) after an earlier response. The bank is asking for a new response.`,
    introGeneral: ({ order, amount }) =>
      `The dispute on order <strong>${order}</strong> (${amount}) came in without a specific reason from the bank.`,
    why: "The bank's explanation of what the customer is disputing is only shown in your Shopify admin. Shopify doesn't share it with apps, so DisputeDesk can't read it on its own. Without it, a response can't answer what the bank actually asked.",
    steps: [
      "Open the order in Shopify and find the bank's claim in the chargeback details.",
      "Copy the claim's text into DisputeDesk using the button below.",
      "If Shopify shows no claim for this dispute, just tell us — that's a valid answer.",
    ],
    holdNote: "Until then, DisputeDesk won't send a response for this dispute.",
    dueLabel: "Response due",
    ctaDispute: "Add the bank's claim in DisputeDesk →",
    ctaShopify: "Open the order in Shopify",
    footer: "You received this because evidence alerts are enabled in DisputeDesk settings.",
  },
  es: {
    subject: ({ order }) => `Acción necesaria: copia la reclamación del banco para ${order}`,
    heading: "Necesitamos la reclamación del banco para responder a esta disputa",
    introReopened: ({ order, amount }) =>
      `Shopify ha reabierto la disputa del pedido <strong>${order}</strong> (${amount}) tras una respuesta anterior. El banco pide una nueva respuesta.`,
    introGeneral: ({ order, amount }) =>
      `La disputa del pedido <strong>${order}</strong> (${amount}) llegó sin un motivo concreto del banco.`,
    why: "La explicación del banco sobre lo que disputa el cliente solo se muestra en tu administrador de Shopify. Shopify no la comparte con las aplicaciones, así que DisputeDesk no puede leerla por sí mismo. Sin ella, la respuesta no puede contestar lo que el banco preguntó realmente.",
    steps: [
      "Abre el pedido en Shopify y busca la reclamación del banco en los detalles del contracargo.",
      "Copia el texto de la reclamación en DisputeDesk con el botón de abajo.",
      "Si Shopify no muestra ninguna reclamación para esta disputa, indícanoslo: es una respuesta válida.",
    ],
    holdNote: "Hasta entonces, DisputeDesk no enviará ninguna respuesta para esta disputa.",
    dueLabel: "Respuesta antes del",
    ctaDispute: "Añadir la reclamación del banco en DisputeDesk →",
    ctaShopify: "Abrir el pedido en Shopify",
    footer: "Recibiste esto porque las alertas de evidencia están activadas en DisputeDesk.",
  },
  pt: {
    subject: ({ order }) => `Ação necessária: copie a reclamação do banco para ${order}`,
    heading: "Precisamos da reclamação do banco para responder a esta disputa",
    introReopened: ({ order, amount }) =>
      `A Shopify reabriu a disputa do pedido <strong>${order}</strong> (${amount}) após uma resposta anterior. O banco pede uma nova resposta.`,
    introGeneral: ({ order, amount }) =>
      `A disputa do pedido <strong>${order}</strong> (${amount}) chegou sem um motivo específico do banco.`,
    why: "A explicação do banco sobre o que o cliente está contestando só aparece no seu admin da Shopify. A Shopify não a compartilha com apps, então o DisputeDesk não consegue lê-la sozinho. Sem ela, a resposta não consegue responder ao que o banco realmente perguntou.",
    steps: [
      "Abra o pedido na Shopify e encontre a reclamação do banco nos detalhes do estorno.",
      "Copie o texto da reclamação para o DisputeDesk usando o botão abaixo.",
      "Se a Shopify não mostrar nenhuma reclamação para esta disputa, é só nos avisar — é uma resposta válida.",
    ],
    holdNote: "Até lá, o DisputeDesk não enviará nenhuma resposta para esta disputa.",
    dueLabel: "Prazo da resposta",
    ctaDispute: "Adicionar a reclamação do banco no DisputeDesk →",
    ctaShopify: "Abrir o pedido na Shopify",
    footer: "Você recebeu isto porque os alertas de evidência estão ativados nas configurações do DisputeDesk.",
  },
  fr: {
    subject: ({ order }) => `Action requise : copiez la réclamation de la banque pour ${order}`,
    heading: "Nous avons besoin de la réclamation de la banque pour répondre à ce litige",
    introReopened: ({ order, amount }) =>
      `Shopify a rouvert le litige de la commande <strong>${order}</strong> (${amount}) après une première réponse. La banque demande une nouvelle réponse.`,
    introGeneral: ({ order, amount }) =>
      `Le litige de la commande <strong>${order}</strong> (${amount}) est arrivé sans motif précis de la banque.`,
    why: "L'explication de la banque sur ce que le client conteste n'apparaît que dans votre administration Shopify. Shopify ne la partage pas avec les applications, DisputeDesk ne peut donc pas la lire seul. Sans elle, la réponse ne peut pas répondre à ce que la banque a réellement demandé.",
    steps: [
      "Ouvrez la commande dans Shopify et trouvez la réclamation de la banque dans les détails de la rétrofacturation.",
      "Copiez le texte de la réclamation dans DisputeDesk avec le bouton ci-dessous.",
      "Si Shopify n'affiche aucune réclamation pour ce litige, dites-le-nous : c'est une réponse valable.",
    ],
    holdNote: "D'ici là, DisputeDesk n'enverra aucune réponse pour ce litige.",
    dueLabel: "Réponse avant le",
    ctaDispute: "Ajouter la réclamation de la banque dans DisputeDesk →",
    ctaShopify: "Ouvrir la commande dans Shopify",
    footer: "Vous recevez ceci car les alertes de preuves sont activées dans les paramètres DisputeDesk.",
  },
  de: {
    subject: ({ order }) => `Aktion erforderlich: Begründung der Bank für ${order} übernehmen`,
    heading: "Wir brauchen die Begründung der Bank, um diese Rückbuchung zu beantworten",
    introReopened: ({ order, amount }) =>
      `Shopify hat die Rückbuchung zur Bestellung <strong>${order}</strong> (${amount}) nach einer früheren Antwort wieder geöffnet. Die Bank verlangt eine neue Antwort.`,
    introGeneral: ({ order, amount }) =>
      `Die Rückbuchung zur Bestellung <strong>${order}</strong> (${amount}) kam ohne konkreten Grund von der Bank.`,
    why: "Die Begründung der Bank, was der Kunde beanstandet, wird nur in Ihrem Shopify-Adminbereich angezeigt. Shopify gibt sie nicht an Apps weiter, daher kann DisputeDesk sie nicht selbst lesen. Ohne sie kann die Antwort nicht auf das eingehen, was die Bank tatsächlich gefragt hat.",
    steps: [
      "Öffnen Sie die Bestellung in Shopify und suchen Sie die Begründung der Bank in den Rückbuchungsdetails.",
      "Kopieren Sie den Text der Begründung über die Schaltfläche unten in DisputeDesk.",
      "Wenn Shopify für diese Rückbuchung keine Begründung anzeigt, teilen Sie uns das einfach mit – das ist eine gültige Antwort.",
    ],
    holdNote: "Bis dahin sendet DisputeDesk für diese Rückbuchung keine Antwort.",
    dueLabel: "Antwort fällig am",
    ctaDispute: "Begründung der Bank in DisputeDesk hinzufügen →",
    ctaShopify: "Bestellung in Shopify öffnen",
    footer: "Sie erhalten dies, weil Beweisbenachrichtigungen in den DisputeDesk-Einstellungen aktiviert sind.",
  },
  sv: {
    subject: ({ order }) => `Åtgärd krävs: kopiera bankens anspråk för ${order}`,
    heading: "Vi behöver bankens anspråk för att besvara den här tvisten",
    introReopened: ({ order, amount }) =>
      `Shopify har öppnat tvisten för order <strong>${order}</strong> (${amount}) igen efter ett tidigare svar. Banken begär ett nytt svar.`,
    introGeneral: ({ order, amount }) =>
      `Tvisten för order <strong>${order}</strong> (${amount}) kom in utan något specifikt skäl från banken.`,
    why: "Bankens förklaring av vad kunden bestrider visas bara i din Shopify-admin. Shopify delar den inte med appar, så DisputeDesk kan inte läsa den själv. Utan den kan svaret inte bemöta det banken faktiskt frågade.",
    steps: [
      "Öppna ordern i Shopify och hitta bankens anspråk i återkravsdetaljerna.",
      "Kopiera anspråkets text till DisputeDesk med knappen nedan.",
      "Om Shopify inte visar något anspråk för den här tvisten, säg bara till – det är ett giltigt svar.",
    ],
    holdNote: "Tills dess skickar DisputeDesk inget svar för den här tvisten.",
    dueLabel: "Svar senast",
    ctaDispute: "Lägg till bankens anspråk i DisputeDesk →",
    ctaShopify: "Öppna ordern i Shopify",
    footer: "Du fick detta eftersom bevisaviseringar är aktiverade i DisputeDesk-inställningarna.",
  },
};

export function resolveBankClaimLocale(raw: string | null | undefined): Locale {
  if (!raw) return "en";
  const base = raw.split("-")[0].toLowerCase();
  return base in STRINGS ? (base as Locale) : "en";
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code ?? "USD" }).format(amount);
  } catch {
    return `${code ?? "$"}${amount.toFixed(2)}`;
  }
}

/** Pure renderer, exported for tests and previews. */
export function renderBankClaimNeededEmail(args: {
  locale: Locale;
  trigger: BankClaimTrigger;
  orderName: string;
  amount: string;
  dueDate: string | null;
  disputeUrl: string;
  shopifyUrl: string | null;
}): { subject: string; html: string; text: string } {
  const s = STRINGS[args.locale];
  const intro =
    args.trigger === "reopened"
      ? s.introReopened({ order: args.orderName, amount: args.amount })
      : s.introGeneral({ order: args.orderName, amount: args.amount });
  const subject = `[DisputeDesk] ${s.subject({ order: args.orderName })}`;
  const stepsHtml = s.steps
    .map((st, i) => `<li style="margin:0 0 6px">${i === 0 && args.shopifyUrl ? `<a href="${args.shopifyUrl}" style="color:#1D4ED8">${st}</a>` : st}</li>`)
    .join("");

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
      <h1 style="font-size:20px;font-weight:600;color:#202223;margin:0 0 12px">${s.heading}</h1>
      <p style="font-size:14px;color:#202223;margin:0 0 12px;line-height:1.5">${intro}</p>
      <p style="font-size:14px;color:#6D7175;margin:0 0 16px;line-height:1.5">${s.why}</p>
      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <ol style="font-size:13px;color:#7C2D12;margin:0 0 8px;padding-left:18px;line-height:1.5">${stepsHtml}</ol>
        <p style="font-size:12px;color:#9A3412;margin:0 0 ${args.dueDate ? "8px" : "0"};line-height:1.4">${s.holdNote}</p>
        ${args.dueDate ? `<p style="font-size:13px;color:#9A3412;margin:0;line-height:1.4;font-weight:600">${s.dueLabel}: ${args.dueDate}</p>` : ""}
      </div>
      <div>
        <a href="${args.disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:8px">${s.ctaDispute}</a>
      </div>
      ${args.shopifyUrl ? `<p style="font-size:13px;margin:8px 0 0"><a href="${args.shopifyUrl}" style="color:#1D4ED8">${s.ctaShopify}</a></p>` : ""}
    </div>
    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">${s.footer}</p>
  </div>
</body>
</html>`;

  const text = `${s.heading}

${intro.replace(/<[^>]+>/g, "")}

${s.why}

${s.steps.map((st, i) => `${i + 1}. ${st}`).join("\n")}

${s.holdNote}${args.dueDate ? `\n${s.dueLabel}: ${args.dueDate}` : ""}

${s.ctaDispute.replace(" →", "")}: ${args.disputeUrl}${args.shopifyUrl ? `\n${s.ctaShopify}: ${args.shopifyUrl}` : ""}

---
${s.footer}`;

  return { subject, html, text };
}

export async function sendBankClaimNeededAlert(
  ctx: BankClaimNeededAlertContext,
): Promise<{ sent: boolean; reason?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return { sent: false, reason: "no_api_key" };

  try {
    const sb = getServiceClient();
    const { data: setup } = await sb
      .from("shop_setup")
      .select("steps")
      .eq("shop_id", ctx.shopId)
      .single();
    const steps = setup?.steps as Record<string, { payload?: Record<string, unknown> }> | null;
    const teamPayload = steps?.team?.payload;
    const notifications = teamPayload?.notifications as { evidenceReady?: boolean } | null;
    if (notifications?.evidenceReady === false) return { sent: false, reason: "opted_out" };
    const teamEmail = teamPayload?.teamEmail as string | undefined;
    if (!teamEmail) return { sent: false, reason: "no_team_email" };

    const locale = resolveBankClaimLocale(
      (steps?.store_profile?.payload?.storeLocale as string | undefined) ?? null,
    );

    const [{ data: shop }, { data: dispute }] = await Promise.all([
      sb.from("shops").select("shop_domain").eq("id", ctx.shopId).single(),
      sb
        .from("disputes")
        .select("order_name, amount, currency_code, due_at, order_gid")
        .eq("id", ctx.disputeId)
        .single(),
    ]);
    const shopDomain = (shop?.shop_domain as string | undefined) ?? null;
    const dueAt = (dispute?.due_at as string | null) ?? null;
    const dueDate = dueAt
      ? new Date(dueAt).toLocaleDateString(locale === "en" ? "en-US" : locale, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

    const { subject, html, text } = renderBankClaimNeededEmail({
      locale,
      trigger: ctx.trigger,
      orderName: (dispute?.order_name as string | null) ?? "—",
      amount: formatCurrency(
        dispute?.amount != null ? Number(dispute.amount) : null,
        (dispute?.currency_code as string | null) ?? null,
      ),
      dueDate,
      disputeUrl: getEmbeddedAppUrl(shopDomain, `disputes/${ctx.disputeId}?section=bank-claim`),
      // Shopify shows the issuer claim in the chargeback details on the ORDER
      // page (Shopify Help: "Managing chargebacks in the Shopify admin").
      shopifyUrl:
        shopDomain && dispute?.order_gid
          ? getShopifyOrderUrl(shopDomain, dispute.order_gid as string)
          : null,
    });

    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send({
      from: DEFAULT_FROM_EMAIL,
      replyTo: DEFAULT_REPLY_TO,
      to: teamEmail.includes(",") ? teamEmail.split(",").map((e) => e.trim()) : teamEmail,
      subject,
      html,
      text,
    });
    if (error) return { sent: false, reason: error.message };
    return { sent: true };
  } catch (err) {
    console.error(
      "[email] bank-claim-needed alert failed:",
      err instanceof Error ? err.message : err,
    );
    return { sent: false, reason: "exception" };
  }
}
