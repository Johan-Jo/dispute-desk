/**
 * Email templates and HTML layout for DisputeDesk.
 * Table-based layout for broad email client compatibility (no <style> blocks).
 * Supports all six app locales: en-US, de-DE, fr-FR, es-ES, pt-BR, sv-SE.
 */

import type { Locale } from "@/lib/i18n/locales";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";

function replaceTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => variables[key] ?? "");
}

interface WelcomeTranslation {
  subject: string;
  greeting: string; // may contain {firstName}
  content: string;
  ctaText: string;
  preheader: string;
  regards: string;
  teamName: string;
  footerNote: string;
  copyright: string;
}

const WELCOME_TRANSLATIONS: Record<Locale, WelcomeTranslation> = {
  "en-US": {
    subject: "Your DisputeDesk account is ready",
    greeting: "Hi {firstName},",
    content:
      "Your account is all set. Connect your Shopify store and start managing chargeback evidence — DisputeDesk handles the heavy lifting automatically.",
    ctaText: "Go to Dashboard",
    preheader: "Your DisputeDesk account is ready.",
    regards: "Best regards,",
    teamName: "The DisputeDesk Team",
    footerNote: "You're receiving this because you signed up at DisputeDesk.",
    copyright: "© 2026 DisputeDesk. All rights reserved.",
  },
  "de-DE": {
    subject: "Dein DisputeDesk-Konto ist bereit",
    greeting: "Hallo {firstName},",
    content:
      "Dein Konto ist eingerichtet. Verbinde deinen Shopify-Shop und beginne mit der Verwaltung von Chargeback-Belegen – DisputeDesk erledigt die schwere Arbeit automatisch.",
    ctaText: "Zum Dashboard",
    preheader: "Dein DisputeDesk-Konto ist bereit.",
    regards: "Mit freundlichen Grüßen,",
    teamName: "Das DisputeDesk-Team",
    footerNote:
      "Du erhältst diese E-Mail, weil du dich bei DisputeDesk registriert hast.",
    copyright: "© 2026 DisputeDesk. Alle Rechte vorbehalten.",
  },
  "fr-FR": {
    subject: "Votre compte DisputeDesk est prêt",
    greeting: "Bonjour {firstName},",
    content:
      "Votre compte est configuré. Connectez votre boutique Shopify et commencez à gérer vos preuves de rétrofacturation — DisputeDesk s'occupe automatiquement du travail lourd.",
    ctaText: "Accéder au tableau de bord",
    preheader: "Votre compte DisputeDesk est prêt.",
    regards: "Cordialement,",
    teamName: "L'équipe DisputeDesk",
    footerNote:
      "Vous recevez cet e-mail car vous vous êtes inscrit sur DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Tous droits réservés.",
  },
  "es-ES": {
    subject: "Tu cuenta de DisputeDesk está lista",
    greeting: "Hola {firstName},",
    content:
      "Tu cuenta está configurada. Conecta tu tienda Shopify y comienza a gestionar las pruebas de contracargos — DisputeDesk se encarga del trabajo pesado automáticamente.",
    ctaText: "Ir al panel",
    preheader: "Tu cuenta de DisputeDesk está lista.",
    regards: "Saludos,",
    teamName: "El equipo de DisputeDesk",
    footerNote:
      "Recibes este correo porque te registraste en DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Todos los derechos reservados.",
  },
  "pt-BR": {
    subject: "Sua conta DisputeDesk está pronta",
    greeting: "Olá {firstName},",
    content:
      "Sua conta está configurada. Conecte sua loja Shopify e comece a gerenciar evidências de chargebacks — o DisputeDesk cuida do trabalho pesado automaticamente.",
    ctaText: "Ir ao painel",
    preheader: "Sua conta DisputeDesk está pronta.",
    regards: "Atenciosamente,",
    teamName: "A equipe DisputeDesk",
    footerNote:
      "Você está recebendo este e-mail porque se cadastrou no DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Todos os direitos reservados.",
  },
  "sv-SE": {
    subject: "Ditt DisputeDesk-konto är klart",
    greeting: "Hej {firstName},",
    content:
      "Ditt konto är konfigurerat. Anslut din Shopify-butik och börja hantera återkravbevis — DisputeDesk sköter det tunga arbetet automatiskt.",
    ctaText: "Gå till instrumentpanelen",
    preheader: "Ditt DisputeDesk-konto är klart.",
    regards: "Med vänliga hälsningar,",
    teamName: "DisputeDesk-teamet",
    footerNote:
      "Du får detta e-postmeddelande eftersom du registrerade dig på DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Alla rättigheter förbehållna.",
  },
};

export interface WelcomeEmailVariables {
  firstName: string;
  dashboardUrl: string;
  locale?: Locale;
}

function getTranslation(locale?: Locale): WelcomeTranslation {
  return WELCOME_TRANSLATIONS[locale ?? DEFAULT_LOCALE] ?? WELCOME_TRANSLATIONS[DEFAULT_LOCALE];
}

/**
 * Generate branded HTML for the welcome email.
 * Indigo header bar, white card body, CTA button, muted footer.
 * Rendered in the user's locale (falls back to en-US).
 */
export function generateWelcomeEmailHTML(variables: WelcomeEmailVariables): string {
  const t = getTranslation(variables.locale);
  const vars: Record<string, string> = {
    firstName: variables.firstName,
    dashboardUrl: variables.dashboardUrl,
  };
  const greeting = replaceTemplateVariables(t.greeting, vars);
  const content = replaceTemplateVariables(t.content, vars);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111827;">
  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:0;color:transparent;">${t.preheader}</div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
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
              <p style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${greeting}</p>
              <p style="margin:0 0 28px 0;font-size:15px;color:#374151;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${content}</p>

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>
                  <td style="background-color:#4F46E5;border-radius:8px;">
                    <a href="${variables.dashboardUrl}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${t.ctaText}</a>
                  </td>
                </tr>
              </table>

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
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function getWelcomeSubject(locale?: Locale): string {
  return getTranslation(locale).subject;
}

/**
 * Generate plain-text version of the welcome email.
 */
export function generateWelcomeEmailText(variables: WelcomeEmailVariables): string {
  const t = getTranslation(variables.locale);
  const vars: Record<string, string> = {
    firstName: variables.firstName,
    dashboardUrl: variables.dashboardUrl,
  };
  const greeting = replaceTemplateVariables(t.greeting, vars);
  const content = replaceTemplateVariables(t.content, vars);
  return `${t.subject}\n\n${greeting}\n\n${content}\n\n${t.ctaText}: ${variables.dashboardUrl}\n\n${t.regards}\n${t.teamName}`;
}
