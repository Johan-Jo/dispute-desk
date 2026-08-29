/**
 * The welcome email a merchant receives the moment they install from the
 * Shopify App Store.
 *
 * Distinct from the portal welcome in `templates.ts`, which greets a *person*
 * by first name and links to `/portal/dashboard`. An App Store merchant has no
 * Supabase portal user and cannot sign into the portal at all, so until now
 * they received no welcome email of any kind — `sendWelcomeEmail`'s only
 * callers are portal ones, and no `auth.users` row has been created since
 * 2026-05-29.
 *
 * Three deliberate differences from the portal welcome:
 *
 *   1. **Greets the STORE, not a person** (`{shopName}` → "Mein Maison"). This
 *      lands in a shared shop-owner inbox, so a first name would read wrong.
 *      Degrades to a name-less greeting when Shopify returned no name —
 *      never the myshopify subdomain, which is opaque ("6a8848-dd").
 *   2. **The CTA opens the embedded app** via `getEmbeddedAppUrl`, never the
 *      portal.
 *   3. **It sets expectations about the first sync taking a long time.** That
 *      is the email's real job: the orders backfill is enqueued during OAuth
 *      and runs for hours on a large store (a 66,700-order store was still
 *      `in_progress` ~5h after install), so a merchant who installs and finds
 *      an empty dashboard needs to know that is normal and unattended.
 *
 * Copy constraint: no locale may contain the submission phrasings the CI
 * forbidden-copy gate greps for (see the "Forbidden copy check" step in
 * .github/workflows/ci.yml for the exact list, and the assertion in
 * __tests__/installWelcome.test.ts). DisputeDesk files evidence with
 * *Shopify*, which passes it to the card network; we never contact a network
 * directly, and no merchant-facing copy may imply otherwise.
 */

import type { Locale } from "@/lib/i18n/locales";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";

interface InstallWelcomeTranslation {
  subject: string;
  preheader: string;
  /** Greeting used when the store name is known. Contains `{shopName}`. */
  greeting: string;
  /** Greeting used when Shopify gave us no usable store name. */
  greetingNoName: string;
  intro: string;
  nowHeading: string;
  nowBody1: string;
  nowBody2: string;
  waitHeading: string;
  waitBody1: string;
  waitBody2: string;
  ctaText: string;
  replyNote: string;
  regards: string;
  teamName: string;
  footerNote: string;
  copyright: string;
}

const INSTALL_WELCOME_TRANSLATIONS: Record<Locale, InstallWelcomeTranslation> = {
  en: {
    subject: "Welcome to DisputeDesk — we're already going through your orders",
    preheader:
      "Your evidence is being built from your order history. Here's what happens next.",
    greeting: "Welcome to DisputeDesk, {shopName}",
    greetingNoName: "Welcome to DisputeDesk",
    intro:
      "Thanks for installing — we're glad you're here. You don't need to do anything right now. We've already started.",
    nowHeading: "What's happening as you read this",
    nowBody1:
      "We're connected to your store and working through your order history — orders, fulfilments, tracking, customer details and payment records. That's the raw material every chargeback response is built from.",
    nowBody2:
      "For each dispute we find, we assemble the evidence automatically and file it with Shopify on your behalf, so nobody on your team is writing responses by hand against a deadline.",
    waitHeading: "This takes a while, and that's normal",
    waitBody1:
      "Depending on how many orders you have, the first sync can take anywhere from a few minutes to several hours. Larger stores take longer — there's a lot of history to read. You can close the tab; it keeps running in the background.",
    waitBody2:
      "We'll email you as soon as there's something worth your attention. Until then, there's nothing to watch.",
    ctaText: "Open DisputeDesk",
    replyNote:
      "If anything looks off, just reply to this email — it reaches a person.",
    regards: "Best regards,",
    teamName: "The DisputeDesk Team",
    footerNote:
      "You're receiving this because DisputeDesk was installed on your Shopify store.",
    copyright: "© 2026 DisputeDesk. All rights reserved.",
  },
  de: {
    subject:
      "Willkommen bei DisputeDesk — wir sehen deine Bestellungen bereits durch",
    preheader:
      "Deine Nachweise werden aus deiner Bestellhistorie aufgebaut. Das passiert als Nächstes.",
    greeting: "Willkommen bei DisputeDesk, {shopName}",
    greetingNoName: "Willkommen bei DisputeDesk",
    intro:
      "Danke für die Installation — schön, dass du da bist. Du musst jetzt nichts tun. Wir haben bereits angefangen.",
    nowHeading: "Was gerade passiert, während du das liest",
    nowBody1:
      "Wir sind mit deinem Shop verbunden und arbeiten uns durch deine Bestellhistorie — Bestellungen, Sendungen, Tracking, Kundendaten und Zahlungsbelege. Das ist die Grundlage für jede Chargeback-Antwort.",
    nowBody2:
      "Für jeden Fall, den wir finden, stellen wir die Nachweise automatisch zusammen und reichen sie in deinem Namen bei Shopify ein — niemand in deinem Team muss Antworten von Hand kurz vor Fristablauf schreiben.",
    waitHeading: "Das dauert eine Weile, und das ist normal",
    waitBody1:
      "Je nachdem, wie viele Bestellungen du hast, kann die erste Synchronisierung von wenigen Minuten bis zu mehreren Stunden dauern. Bei größeren Shops dauert es länger — es gibt viel Historie zu lesen. Du kannst den Tab schließen; es läuft im Hintergrund weiter.",
    waitBody2:
      "Wir melden uns per E-Mail, sobald es etwas gibt, das deine Aufmerksamkeit verdient. Bis dahin musst du nichts beobachten.",
    ctaText: "DisputeDesk öffnen",
    replyNote:
      "Falls etwas nicht stimmt, antworte einfach auf diese E-Mail — sie erreicht einen echten Menschen.",
    regards: "Mit freundlichen Grüßen,",
    teamName: "Das DisputeDesk-Team",
    footerNote:
      "Du erhältst diese E-Mail, weil DisputeDesk in deinem Shopify-Shop installiert wurde.",
    copyright: "© 2026 DisputeDesk. Alle Rechte vorbehalten.",
  },
  fr: {
    subject: "Bienvenue chez DisputeDesk — nous parcourons déjà vos commandes",
    preheader:
      "Vos preuves sont en cours de constitution à partir de votre historique de commandes. Voici la suite.",
    greeting: "Bienvenue chez DisputeDesk, {shopName}",
    greetingNoName: "Bienvenue chez DisputeDesk",
    intro:
      "Merci pour l'installation — ravis de vous compter parmi nous. Vous n'avez rien à faire pour le moment. Nous avons déjà commencé.",
    nowHeading: "Ce qui se passe pendant que vous lisez ceci",
    nowBody1:
      "Nous sommes connectés à votre boutique et parcourons votre historique de commandes — commandes, expéditions, suivis, coordonnées clients et enregistrements de paiement. C'est la matière première de toute réponse à une rétrofacturation.",
    nowBody2:
      "Pour chaque litige trouvé, nous assemblons les preuves automatiquement et les déposons auprès de Shopify en votre nom : personne dans votre équipe n'a à rédiger de réponse à la main juste avant l'échéance.",
    waitHeading: "Cela prend du temps, et c'est normal",
    waitBody1:
      "Selon le nombre de commandes, la première synchronisation peut prendre de quelques minutes à plusieurs heures. Les grandes boutiques prennent plus de temps — il y a beaucoup d'historique à lire. Vous pouvez fermer l'onglet ; le traitement continue en arrière-plan.",
    waitBody2:
      "Nous vous écrirons dès qu'il y aura quelque chose qui mérite votre attention. D'ici là, rien à surveiller.",
    ctaText: "Ouvrir DisputeDesk",
    replyNote:
      "Si quelque chose vous semble incorrect, répondez simplement à cet e-mail — une vraie personne le lira.",
    regards: "Cordialement,",
    teamName: "L'équipe DisputeDesk",
    footerNote:
      "Vous recevez cet e-mail car DisputeDesk a été installé sur votre boutique Shopify.",
    copyright: "© 2026 DisputeDesk. Tous droits réservés.",
  },
  es: {
    subject: "Bienvenido a DisputeDesk: ya estamos revisando tus pedidos",
    preheader:
      "Tus pruebas se están creando a partir de tu historial de pedidos. Esto es lo que sigue.",
    greeting: "Bienvenido a DisputeDesk, {shopName}",
    greetingNoName: "Bienvenido a DisputeDesk",
    intro:
      "Gracias por instalar la app: nos alegra tenerte aquí. No necesitas hacer nada ahora mismo. Ya hemos empezado.",
    nowHeading: "Qué está pasando mientras lees esto",
    nowBody1:
      "Estamos conectados a tu tienda y revisando tu historial de pedidos: pedidos, envíos, seguimiento, datos de clientes y registros de pago. Esa es la materia prima de toda respuesta a un contracargo.",
    nowBody2:
      "Para cada disputa que encontramos, reunimos las pruebas automáticamente y las presentamos ante Shopify en tu nombre, para que nadie de tu equipo tenga que redactar respuestas a mano contra reloj.",
    waitHeading: "Esto lleva un rato, y es normal",
    waitBody1:
      "Según cuántos pedidos tengas, la primera sincronización puede tardar desde unos minutos hasta varias horas. Las tiendas más grandes tardan más: hay mucho historial que leer. Puedes cerrar la pestaña; sigue funcionando en segundo plano.",
    waitBody2:
      "Te escribiremos en cuanto haya algo que merezca tu atención. Hasta entonces, no hay nada que vigilar.",
    ctaText: "Abrir DisputeDesk",
    replyNote:
      "Si algo no cuadra, responde a este correo: lo lee una persona real.",
    regards: "Un saludo,",
    teamName: "El equipo de DisputeDesk",
    footerNote:
      "Recibes este correo porque DisputeDesk se instaló en tu tienda de Shopify.",
    copyright: "© 2026 DisputeDesk. Todos los derechos reservados.",
  },
  pt: {
    subject: "Bem-vindo ao DisputeDesk — já estamos analisando seus pedidos",
    preheader:
      "Suas evidências estão sendo montadas a partir do seu histórico de pedidos. Veja o que vem a seguir.",
    greeting: "Bem-vindo ao DisputeDesk, {shopName}",
    greetingNoName: "Bem-vindo ao DisputeDesk",
    intro:
      "Obrigado por instalar — que bom ter você aqui. Você não precisa fazer nada agora. Já começamos.",
    nowHeading: "O que está acontecendo enquanto você lê isto",
    nowBody1:
      "Estamos conectados à sua loja e percorrendo seu histórico de pedidos: pedidos, envios, rastreamento, dados de clientes e registros de pagamento. É a matéria-prima de toda resposta a chargeback.",
    nowBody2:
      "Para cada disputa que encontramos, reunimos as evidências automaticamente e as enviamos à Shopify em seu nome, para que ninguém da sua equipe precise redigir respostas à mão em cima do prazo.",
    waitHeading: "Isso leva um tempo, e é normal",
    waitBody1:
      "Dependendo de quantos pedidos você tem, a primeira sincronização pode levar de alguns minutos a várias horas. Lojas maiores demoram mais — há muito histórico para ler. Você pode fechar a aba; o processo continua em segundo plano.",
    waitBody2:
      "Enviaremos um e-mail assim que houver algo que mereça sua atenção. Até lá, não há nada para acompanhar.",
    ctaText: "Abrir o DisputeDesk",
    replyNote:
      "Se algo parecer errado, basta responder a este e-mail — ele chega a uma pessoa de verdade.",
    regards: "Atenciosamente,",
    teamName: "A equipe DisputeDesk",
    footerNote:
      "Você está recebendo este e-mail porque o DisputeDesk foi instalado na sua loja Shopify.",
    copyright: "© 2026 DisputeDesk. Todos os direitos reservados.",
  },
  sv: {
    subject: "Välkommen till DisputeDesk — vi går redan igenom dina ordrar",
    preheader:
      "Ditt underlag byggs upp från din orderhistorik. Så här ser nästa steg ut.",
    greeting: "Välkommen till DisputeDesk, {shopName}",
    greetingNoName: "Välkommen till DisputeDesk",
    intro:
      "Tack för att du installerade — kul att ha dig här. Du behöver inte göra något just nu. Vi har redan börjat.",
    nowHeading: "Det här händer medan du läser",
    nowBody1:
      "Vi är anslutna till din butik och går igenom din orderhistorik — ordrar, leveranser, spårning, kunduppgifter och betalningsunderlag. Det är råmaterialet i varje svar på ett återkrav.",
    nowBody2:
      "För varje ärende vi hittar sammanställer vi underlaget automatiskt och lämnar in det till Shopify å dina vägnar, så att ingen i ditt team behöver skriva svar för hand strax före deadline.",
    waitHeading: "Det tar ett tag, och det är helt normalt",
    waitBody1:
      "Beroende på hur många ordrar du har kan den första synkroniseringen ta allt från några minuter till flera timmar. Större butiker tar längre tid — det finns mycket historik att läsa. Du kan stänga fliken; arbetet fortsätter i bakgrunden.",
    waitBody2:
      "Vi hör av oss via e-post så snart det finns något som kräver din uppmärksamhet. Fram till dess finns det inget du behöver bevaka.",
    ctaText: "Öppna DisputeDesk",
    replyNote:
      "Om något ser fel ut är det bara att svara på det här mejlet — det når en riktig människa.",
    regards: "Med vänliga hälsningar,",
    teamName: "DisputeDesk-teamet",
    footerNote:
      "Du får det här mejlet eftersom DisputeDesk installerades i din Shopify-butik.",
    copyright: "© 2026 DisputeDesk. Alla rättigheter förbehållna.",
  },
};

export interface InstallWelcomeEmailVariables {
  /** Merchant-facing store name (Shopify `Shop.name`), e.g. "Mein Maison". */
  shopName?: string | null;
  /** Shopify Admin deep link that opens the embedded app. */
  appUrl: string;
  locale?: Locale;
}

function getTranslation(locale?: Locale): InstallWelcomeTranslation {
  return (
    INSTALL_WELCOME_TRANSLATIONS[locale ?? DEFAULT_LOCALE] ??
    INSTALL_WELCOME_TRANSLATIONS[DEFAULT_LOCALE]
  );
}

/**
 * Resolve the greeting, degrading to the name-less variant rather than
 * rendering an empty or placeholder name. `shop_domain` is deliberately NOT a
 * fallback — "Welcome to DisputeDesk, 6a8848-dd" is worse than no name at all.
 */
function resolveGreeting(
  t: InstallWelcomeTranslation,
  shopName?: string | null,
): string {
  const trimmed = shopName?.trim();
  if (!trimmed) return t.greetingNoName;
  return t.greeting.replace("{shopName}", trimmed);
}

export function getInstallWelcomeSubject(locale?: Locale): string {
  return getTranslation(locale).subject;
}

/** Branded HTML for the install welcome email. Mirrors the portal welcome shell. */
export function generateInstallWelcomeEmailHTML(
  variables: InstallWelcomeEmailVariables,
): string {
  const t = getTranslation(variables.locale);
  const greeting = resolveGreeting(t, variables.shopName);

  const paragraph = (text: string, marginBottom: number) =>
    `<p style="margin:0 0 ${marginBottom}px 0;font-size:15px;color:#374151;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${text}</p>`;
  const heading = (text: string) =>
    `<p style="margin:0 0 8px 0;font-size:15px;font-weight:700;color:#111827;line-height:1.4;font-family:Arial,Helvetica,sans-serif;">${text}</p>`;

  return `<!DOCTYPE html>
<html lang="${variables.locale ?? DEFAULT_LOCALE}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111827;">
  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:0;color:transparent;">${t.preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;padding:40px 16px;">
    <tr>
      <td align="center">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E5E7EB;overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="background-color:#4F46E5;padding:24px 40px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;font-family:Arial,Helvetica,sans-serif;">DisputeDesk</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${greeting}</p>
              ${paragraph(t.intro, 28)}

              ${heading(t.nowHeading)}
              ${paragraph(t.nowBody1, 16)}
              ${paragraph(t.nowBody2, 28)}

              ${heading(t.waitHeading)}
              ${paragraph(t.waitBody1, 16)}
              ${paragraph(t.waitBody2, 28)}

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background-color:#4F46E5;border-radius:8px;">
                    <a href="${variables.appUrl}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${t.ctaText}</a>
                  </td>
                </tr>
              </table>

              ${paragraph(t.replyNote, 28)}

              <!-- Divider -->
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

          <!-- Footer -->
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

/** Plain-text counterpart. Mirrors the HTML content. */
export function generateInstallWelcomeEmailText(
  variables: InstallWelcomeEmailVariables,
): string {
  const t = getTranslation(variables.locale);
  const greeting = resolveGreeting(t, variables.shopName);

  return [
    greeting,
    "",
    t.intro,
    "",
    t.nowHeading,
    t.nowBody1,
    "",
    t.nowBody2,
    "",
    t.waitHeading,
    t.waitBody1,
    "",
    t.waitBody2,
    "",
    `${t.ctaText}: ${variables.appUrl}`,
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
