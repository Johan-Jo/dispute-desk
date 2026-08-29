/**
 * Send "Gorgias evidence found — review & approve" email to the merchant.
 *
 * Triggered when a Gorgias enrichment run finishes with proposed evidence
 * (enrichGorgiasCommsJob sets needs_attention='gorgias_evidence_ready').
 * Before this, that state was an IN-APP flag only — no email — so a merchant
 * who didn't open the app would never know matched support conversations were
 * waiting for review + approval. This closes that gap.
 *
 * Recipient + preference: shop_setup team.payload.teamEmail, gated by the
 * evidenceReady notification toggle — the same pattern as sendPackSavedAlert
 * and sendEvidenceNeededAlert. Fire-and-forget — never throws (enrichment
 * must never be blocked by a mail failure).
 *
 * The CTA deep-links to the dispute workspace, where GorgiasCommsReviewSection
 * renders the matched conversations with Approve/Exclude actions. Approval
 * stays a deliberate merchant action; this email only prompts it.
 */

import { Resend } from "resend";
import { getEmbeddedAppUrl } from "@/lib/email/publicSiteUrl";
import { getServiceClient } from "@/lib/supabase/server";
import { DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO } from "@/lib/email/addresses";

// Read env at call time (not module load) so it's robust to test module
// caching and to env set after import.
const FROM_EMAIL = DEFAULT_FROM_EMAIL;
const REPLY_TO = DEFAULT_REPLY_TO;

export interface GorgiasEvidenceReadyAlertContext {
  shopId: string;
  disputeId: string;
  /** Number of proposed messages awaiting review (>= 1). */
  proposalCount: number;
  reason: string | null;
  amount: number | null;
  currencyCode: string | null;
}

type Locale = "en" | "es" | "pt" | "fr" | "de" | "sv";

interface S {
  subject: (p: { reason: string; amount: string }) => string;
  heading: string;
  intro: (p: { reason: string; amount: string; shop: string; count: number }) => string;
  nextStep: string;
  reviewNote: string;
  dueLabel: string;
  ctaDispute: string;
  footer: string;
}

const STRINGS: Record<Locale, S> = {
  en: {
    subject: ({ reason, amount }) => `Support evidence found: ${reason} dispute (${amount})`,
    heading: "Customer support evidence is ready to review",
    intro: ({ reason, amount, shop, count }) =>
      `We found <strong>${count}</strong> customer-support message${count === 1 ? "" : "s"} that may help defend the <strong>${reason}</strong> dispute (${amount}) on ${shop}.`,
    nextStep: "Review the matched conversation and approve the messages you want included in the evidence.",
    reviewNote: "Nothing is added to your evidence until you approve it — you stay in control of what goes to the bank.",
    dueLabel: "Due",
    ctaDispute: "Review evidence in DisputeDesk →",
    footer: "You received this because evidence alerts are enabled in DisputeDesk settings.",
  },
  es: {
    subject: ({ reason, amount }) => `Evidencia de soporte encontrada: disputa ${reason} (${amount})`,
    heading: "La evidencia de atención al cliente está lista para revisar",
    intro: ({ reason, amount, shop, count }) =>
      `Encontramos <strong>${count}</strong> mensaje${count === 1 ? "" : "s"} de atención al cliente que pueden ayudar a defender la disputa <strong>${reason}</strong> (${amount}) en ${shop}.`,
    nextStep: "Revisa la conversación coincidente y aprueba los mensajes que quieras incluir en la evidencia.",
    reviewNote: "No se agrega nada a tu evidencia hasta que lo apruebes: tú controlas lo que se envía al banco.",
    dueLabel: "Vence",
    ctaDispute: "Revisar evidencia en DisputeDesk →",
    footer: "Recibiste esto porque las alertas de evidencia están activadas en DisputeDesk.",
  },
  pt: {
    subject: ({ reason, amount }) => `Evidência de suporte encontrada: disputa ${reason} (${amount})`,
    heading: "A evidência de atendimento ao cliente está pronta para revisão",
    intro: ({ reason, amount, shop, count }) =>
      `Encontramos <strong>${count}</strong> mensage${count === 1 ? "m" : "ns"} de atendimento ao cliente que podem ajudar a defender a disputa <strong>${reason}</strong> (${amount}) em ${shop}.`,
    nextStep: "Revise a conversa correspondente e aprove as mensagens que deseja incluir na evidência.",
    reviewNote: "Nada é adicionado à sua evidência até você aprovar — você controla o que vai para o banco.",
    dueLabel: "Prazo",
    ctaDispute: "Revisar evidência no DisputeDesk →",
    footer: "Você recebeu isto porque os alertas de evidência estão ativados nas configurações do DisputeDesk.",
  },
  fr: {
    subject: ({ reason, amount }) => `Preuves de support trouvées : litige ${reason} (${amount})`,
    heading: "Les preuves du service client sont prêtes à être examinées",
    intro: ({ reason, amount, shop, count }) =>
      `Nous avons trouvé <strong>${count}</strong> message${count === 1 ? "" : "s"} du service client susceptible${count === 1 ? "" : "s"} d'aider à défendre le litige <strong>${reason}</strong> (${amount}) sur ${shop}.`,
    nextStep: "Examinez la conversation correspondante et approuvez les messages que vous souhaitez inclure dans les preuves.",
    reviewNote: "Rien n'est ajouté à vos preuves tant que vous ne l'avez pas approuvé — vous gardez le contrôle de ce qui est envoyé à la banque.",
    dueLabel: "Échéance",
    ctaDispute: "Examiner les preuves dans DisputeDesk →",
    footer: "Vous recevez ceci car les alertes de preuves sont activées dans les paramètres DisputeDesk.",
  },
  de: {
    subject: ({ reason, amount }) => `Support-Beweise gefunden: Reklamation ${reason} (${amount})`,
    heading: "Kundensupport-Beweise stehen zur Überprüfung bereit",
    intro: ({ reason, amount, shop, count }) =>
      `Wir haben <strong>${count}</strong> Kundensupport-Nachricht${count === 1 ? "" : "en"} gefunden, die bei der Verteidigung der <strong>${reason}</strong>-Reklamation (${amount}) bei ${shop} helfen könnten.`,
    nextStep: "Überprüfen Sie die zugeordnete Konversation und genehmigen Sie die Nachrichten, die Sie in die Beweise aufnehmen möchten.",
    reviewNote: "Nichts wird zu Ihren Beweisen hinzugefügt, bis Sie es genehmigen — Sie behalten die Kontrolle darüber, was an die Bank geht.",
    dueLabel: "Fällig",
    ctaDispute: "Beweise in DisputeDesk überprüfen →",
    footer: "Sie erhalten dies, weil Beweisbenachrichtigungen in den DisputeDesk-Einstellungen aktiviert sind.",
  },
  sv: {
    subject: ({ reason, amount }) => `Supportbevis hittade: tvist ${reason} (${amount})`,
    heading: "Kundtjänstbevis är redo att granskas",
    intro: ({ reason, amount, shop, count }) =>
      `Vi hittade <strong>${count}</strong> kundtjänstmeddelande${count === 1 ? "" : "n"} som kan hjälpa till att försvara <strong>${reason}</strong>-tvisten (${amount}) på ${shop}.`,
    nextStep: "Granska den matchade konversationen och godkänn de meddelanden du vill inkludera i bevisen.",
    reviewNote: "Ingenting läggs till i dina bevis förrän du godkänner det — du behåller kontrollen över vad som skickas till banken.",
    dueLabel: "Förfaller",
    ctaDispute: "Granska bevis i DisputeDesk →",
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
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code ?? "USD",
    }).format(amount);
  } catch {
    return `${code ?? "$"}${amount.toFixed(2)}`;
  }
}

function reasonLabel(reason: string | null): string {
  if (!reason) return "dispute";
  return reason.replace(/_/g, " ").toLowerCase();
}

export async function sendGorgiasEvidenceReadyAlert(
  ctx: GorgiasEvidenceReadyAlertContext,
): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return;
  if (ctx.proposalCount < 1) return;

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
    // Same suppression contract as sendPackSavedAlert: an explicit `false`
    // opts out; anything else (including a missing preference) sends.
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
        .select("due_at")
        .eq("id", ctx.disputeId)
        .single(),
    ]);
    const shopDomain = shop?.shop_domain ?? "";
    const shopName = shopDomain || "your store";
    const reason = reasonLabel(ctx.reason);
    const amountStr = formatCurrency(ctx.amount, ctx.currencyCode);

    // `?section=gorgias-comms` lands the merchant on the Evidence tab's
    // "Customer support conversations" card (WorkspaceShell reads it to
    // select the tab; the card scrolls into view + spotlights the messages
    // awaiting approval) — not the top of the Overview tab.
    const disputeUrl = getEmbeddedAppUrl(
      shopDomain || null,
      `disputes/${ctx.disputeId}?section=gorgias-comms`,
    );

    const dueAt = dispute?.due_at ?? null;
    const dueDate = dueAt
      ? new Date(dueAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
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
        <td style="width:28px;height:28px;border-radius:50%;background:#EFF6FF;text-align:center;vertical-align:middle">
          <span style="color:#1D4ED8;font-size:14px;font-weight:700;line-height:28px">✉</span>
        </td>
        <td style="padding-left:8px;vertical-align:middle">
        <h1 style="font-size:20px;font-weight:600;color:#202223;margin:0">
          ${s.heading}
        </h1>
        </td>
      </tr></table>

      <p style="font-size:14px;color:#6D7175;margin:0 0 16px;line-height:1.5">
        ${s.intro({ reason, amount: amountStr, shop: shopName, count: ctx.proposalCount })}
      </p>

      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px 16px;margin-bottom:20px">
        <p style="font-size:13px;color:#1E40AF;margin:0 0 8px;line-height:1.5;font-weight:600">
          ${s.nextStep}
        </p>
        <p style="font-size:12px;color:#6B7280;margin:0 0 ${dueDate ? "8px" : "0"};line-height:1.4">
          ${s.reviewNote}
        </p>
        ${dueDate ? `<p style="font-size:13px;color:#1E40AF;margin:0;line-height:1.4;font-weight:600">${s.dueLabel}: ${dueDate}</p>` : ""}
      </div>

      <div>
        <a href="${disputeUrl}" style="display:inline-block;padding:12px 24px;background:#1D4ED8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:8px">${s.ctaDispute}</a>
      </div>
    </div>
    <p style="font-size:12px;color:#8C9196;text-align:center;margin:0">${s.footer}</p>
  </div>
</body>
</html>`;

    const text = `${s.heading}

${s.intro({ reason, amount: amountStr, shop: shopName, count: ctx.proposalCount }).replace(/<[^>]+>/g, "")}

${s.nextStep}
${s.reviewNote}${dueDate ? `\n${s.dueLabel}: ${dueDate}` : ""}

${s.ctaDispute.replace(" →", "")}: ${disputeUrl}

---
${s.footer}`;

    const resend = new Resend(resendApiKey);
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
      "[email] Gorgias evidence-ready alert failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
