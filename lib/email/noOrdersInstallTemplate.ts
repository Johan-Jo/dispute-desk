/**
 * The email a merchant receives when they install DisputeDesk on a store that
 * has no orders (docs/plans/no-orders-install-gate.plan.md).
 *
 * It REPLACES the normal install welcome for that merchant — sending "we're
 * already going through your orders" to a store with none would be false, and
 * inviting them in only to lock the door would be worse. It says plainly:
 *
 *   1. We can't complete the install, because the store has no order history
 *      and therefore no disputes for DisputeDesk to work on.
 *   2. Nothing was set up and nothing is charged.
 *   3. They are very welcome back once the store has orders.
 *
 * No CTA button: there is nothing to open. Copy constraint is the same as the
 * install welcome — no forbidden submission phrasings (CI forbidden-copy gate).
 */

import type { Locale } from "@/lib/i18n/locales";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";

interface NoOrdersTranslation {
  subject: string;
  preheader: string;
  /** Contains `{shopName}`. */
  greeting: string;
  greetingNoName: string;
  /** The reason: no order history, hence no disputes. */
  cannotInstall: string;
  nothingSetUp: string;
  welcomeBack: string;
  replyNote: string;
  regards: string;
  teamName: string;
  footerNote: string;
  copyright: string;
}

const NO_ORDERS_TRANSLATIONS: Record<Locale, NoOrdersTranslation> = {
  en: {
    subject: "We couldn't set up DisputeDesk — your store has no orders yet",
    preheader:
      "DisputeDesk needs an order history to work from. You're very welcome back once your store has orders.",
    greeting: "Thanks for trying DisputeDesk, {shopName}",
    greetingNoName: "Thanks for trying DisputeDesk",
    cannotInstall:
      "Unfortunately we can't complete the installation: your store has no order history, and so no disputes for us to work on. DisputeDesk defends chargebacks using the orders you've already sold, so without orders there is nothing for it to do yet.",
    nothingSetUp:
      "Nothing has been set up on your store and you haven't been charged anything.",
    welcomeBack:
      "You're very welcome back once your store is up and running with orders — we'd be glad to help you then.",
    replyNote:
      "If you think this is a mistake, just reply to this email — it reaches a person.",
    regards: "Best regards,",
    teamName: "The DisputeDesk Team",
    footerNote:
      "You're receiving this because DisputeDesk was installed on your Shopify store.",
    copyright: "© 2026 DisputeDesk. All rights reserved.",
  },
  de: {
    subject:
      "Wir konnten DisputeDesk nicht einrichten — dein Shop hat noch keine Bestellungen",
    preheader:
      "DisputeDesk braucht eine Bestellhistorie, mit der es arbeiten kann. Du bist herzlich willkommen, sobald dein Shop Bestellungen hat.",
    greeting: "Danke, dass du DisputeDesk ausprobiert hast, {shopName}",
    greetingNoName: "Danke, dass du DisputeDesk ausprobiert hast",
    cannotInstall:
      "Leider können wir die Installation nicht abschließen: Dein Shop hat keine Bestellhistorie und damit keine Fälle, an denen wir arbeiten könnten. DisputeDesk wehrt Chargebacks anhand der Bestellungen ab, die du bereits verkauft hast — ohne Bestellungen gibt es noch nichts zu tun.",
    nothingSetUp:
      "In deinem Shop wurde nichts eingerichtet, und es sind keine Kosten für dich entstanden.",
    welcomeBack:
      "Du bist herzlich willkommen zurück, sobald dein Shop mit Bestellungen läuft — dann helfen wir dir gern.",
    replyNote:
      "Falls du glaubst, dass das ein Irrtum ist, antworte einfach auf diese E-Mail — sie erreicht einen echten Menschen.",
    regards: "Mit freundlichen Grüßen,",
    teamName: "Das DisputeDesk-Team",
    footerNote:
      "Du erhältst diese E-Mail, weil DisputeDesk in deinem Shopify-Shop installiert wurde.",
    copyright: "© 2026 DisputeDesk. Alle Rechte vorbehalten.",
  },
  fr: {
    subject:
      "Nous n'avons pas pu configurer DisputeDesk — votre boutique n'a pas encore de commandes",
    preheader:
      "DisputeDesk a besoin d'un historique de commandes pour travailler. Vous serez le bienvenu dès que votre boutique aura des commandes.",
    greeting: "Merci d'avoir essayé DisputeDesk, {shopName}",
    greetingNoName: "Merci d'avoir essayé DisputeDesk",
    cannotInstall:
      "Malheureusement, nous ne pouvons pas finaliser l'installation : votre boutique n'a aucun historique de commandes, et donc aucun litige sur lequel travailler. DisputeDesk défend les rétrofacturations à partir des commandes que vous avez déjà vendues ; sans commandes, il n'y a encore rien à faire.",
    nothingSetUp:
      "Rien n'a été configuré sur votre boutique et rien ne vous a été facturé.",
    welcomeBack:
      "Vous serez le bienvenu dès que votre boutique fonctionnera avec des commandes — nous serons ravis de vous aider à ce moment-là.",
    replyNote:
      "Si vous pensez qu'il s'agit d'une erreur, répondez simplement à cet e-mail — une vraie personne le lira.",
    regards: "Cordialement,",
    teamName: "L'équipe DisputeDesk",
    footerNote:
      "Vous recevez cet e-mail car DisputeDesk a été installé sur votre boutique Shopify.",
    copyright: "© 2026 DisputeDesk. Tous droits réservés.",
  },
  es: {
    subject:
      "No pudimos configurar DisputeDesk: tu tienda aún no tiene pedidos",
    preheader:
      "DisputeDesk necesita un historial de pedidos con el que trabajar. Serás muy bienvenido cuando tu tienda tenga pedidos.",
    greeting: "Gracias por probar DisputeDesk, {shopName}",
    greetingNoName: "Gracias por probar DisputeDesk",
    cannotInstall:
      "Lamentablemente no podemos completar la instalación: tu tienda no tiene historial de pedidos y, por tanto, no hay disputas en las que podamos trabajar. DisputeDesk defiende los contracargos a partir de los pedidos que ya has vendido; sin pedidos, todavía no hay nada que hacer.",
    nothingSetUp:
      "No se ha configurado nada en tu tienda y no se te ha cobrado nada.",
    welcomeBack:
      "Serás muy bienvenido de nuevo cuando tu tienda esté en marcha con pedidos: estaremos encantados de ayudarte entonces.",
    replyNote:
      "Si crees que se trata de un error, responde a este correo: lo lee una persona real.",
    regards: "Un saludo,",
    teamName: "El equipo de DisputeDesk",
    footerNote:
      "Recibes este correo porque DisputeDesk se instaló en tu tienda de Shopify.",
    copyright: "© 2026 DisputeDesk. Todos los derechos reservados.",
  },
  pt: {
    subject:
      "Não conseguimos configurar o DisputeDesk — sua loja ainda não tem pedidos",
    preheader:
      "O DisputeDesk precisa de um histórico de pedidos para trabalhar. Você será muito bem-vindo quando sua loja tiver pedidos.",
    greeting: "Obrigado por experimentar o DisputeDesk, {shopName}",
    greetingNoName: "Obrigado por experimentar o DisputeDesk",
    cannotInstall:
      "Infelizmente não podemos concluir a instalação: sua loja não tem histórico de pedidos e, portanto, não há disputas em que possamos trabalhar. O DisputeDesk defende chargebacks a partir dos pedidos que você já vendeu; sem pedidos, ainda não há nada para fazer.",
    nothingSetUp:
      "Nada foi configurado na sua loja e você não foi cobrado por nada.",
    welcomeBack:
      "Você será muito bem-vindo de volta quando sua loja estiver funcionando com pedidos — teremos prazer em ajudar você então.",
    replyNote:
      "Se achar que isso é um engano, basta responder a este e-mail — ele chega a uma pessoa de verdade.",
    regards: "Atenciosamente,",
    teamName: "A equipe DisputeDesk",
    footerNote:
      "Você está recebendo este e-mail porque o DisputeDesk foi instalado na sua loja Shopify.",
    copyright: "© 2026 DisputeDesk. Todos os direitos reservados.",
  },
  sv: {
    subject:
      "Vi kunde inte ställa in DisputeDesk — din butik har inga ordrar än",
    preheader:
      "DisputeDesk behöver en orderhistorik att arbeta med. Du är varmt välkommen tillbaka när din butik har ordrar.",
    greeting: "Tack för att du provade DisputeDesk, {shopName}",
    greetingNoName: "Tack för att du provade DisputeDesk",
    cannotInstall:
      "Tyvärr kan vi inte slutföra installationen: din butik har ingen orderhistorik och därmed inga ärenden som vi kan arbeta med. DisputeDesk försvarar återkrav utifrån de ordrar du redan har sålt — utan ordrar finns det inget att göra än.",
    nothingSetUp:
      "Inget har ställts in i din butik och du har inte debiterats något.",
    welcomeBack:
      "Du är varmt välkommen tillbaka när din butik är igång med ordrar — då hjälper vi dig gärna.",
    replyNote:
      "Om du tror att det här är ett misstag är det bara att svara på det här mejlet — det når en riktig människa.",
    regards: "Med vänliga hälsningar,",
    teamName: "DisputeDesk-teamet",
    footerNote:
      "Du får det här mejlet eftersom DisputeDesk installerades i din Shopify-butik.",
    copyright: "© 2026 DisputeDesk. Alla rättigheter förbehållna.",
  },
};

export interface NoOrdersEmailVariables {
  shopName?: string | null;
  locale?: Locale;
}

function getTranslation(locale?: Locale): NoOrdersTranslation {
  return (
    NO_ORDERS_TRANSLATIONS[locale ?? DEFAULT_LOCALE] ??
    NO_ORDERS_TRANSLATIONS[DEFAULT_LOCALE]
  );
}

function resolveGreeting(t: NoOrdersTranslation, shopName?: string | null): string {
  const trimmed = shopName?.trim();
  if (!trimmed) return t.greetingNoName;
  return t.greeting.replace("{shopName}", trimmed);
}

export function getNoOrdersInstallSubject(locale?: Locale): string {
  return getTranslation(locale).subject;
}

export function generateNoOrdersInstallEmailHTML(
  variables: NoOrdersEmailVariables,
): string {
  const t = getTranslation(variables.locale);
  const greeting = resolveGreeting(t, variables.shopName);
  const p = (text: string, mb: number) =>
    `<p style="margin:0 0 ${mb}px 0;font-size:15px;color:#374151;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${text}</p>`;

  return `<!DOCTYPE html>
<html lang="${variables.locale ?? DEFAULT_LOCALE}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:0;color:transparent;">${t.preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E5E7EB;overflow:hidden;">
          <tr>
            <td style="background-color:#4F46E5;padding:24px 40px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;font-family:Arial,Helvetica,sans-serif;">DisputeDesk</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${greeting}</p>
              ${p(t.cannotInstall, 16)}
              ${p(t.nothingSetUp, 16)}
              ${p(t.welcomeBack, 28)}
              ${p(t.replyNote, 28)}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="border-top:1px solid #E5E7EB;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#6B7280;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
                ${t.regards}<br>
                <span style="font-weight:600;color:#374151;">${t.teamName}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F9FAFB;padding:16px 40px;border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.5;font-family:Arial,Helvetica,sans-serif;">
                ${t.footerNote}<br>
                ${t.copyright}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function generateNoOrdersInstallEmailText(
  variables: NoOrdersEmailVariables,
): string {
  const t = getTranslation(variables.locale);
  return [
    resolveGreeting(t, variables.shopName),
    "",
    t.cannotInstall,
    "",
    t.nothingSetUp,
    "",
    t.welcomeBack,
    "",
    t.replyNote,
    "",
    t.regards,
    t.teamName,
    "",
    t.footerNote,
    t.copyright,
  ].join("\n");
}
