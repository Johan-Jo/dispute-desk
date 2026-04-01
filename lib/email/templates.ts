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

// ─── Magic link email ─────────────────────────────────────────────────────

interface MagicLinkTranslation {
  subject: string;
  heading: string;
  content: string;
  ctaText: string;
  preheader: string;
  expiry: string;
  footerNote: string;
  copyright: string;
}

const MAGIC_LINK_TRANSLATIONS: Record<Locale, MagicLinkTranslation> = {
  "en-US": {
    subject: "Your DisputeDesk sign-in link",
    heading: "Sign in to DisputeDesk",
    content: "Click the button below to sign in instantly. This link expires in 1 hour and can only be used once.",
    ctaText: "Sign In",
    preheader: "Your one-click sign-in link for DisputeDesk.",
    expiry: "This link expires in 1 hour.",
    footerNote: "You're receiving this because you requested a sign-in link at DisputeDesk.",
    copyright: "© 2026 DisputeDesk. All rights reserved.",
  },
  "de-DE": {
    subject: "Dein DisputeDesk-Anmeldelink",
    heading: "Bei DisputeDesk anmelden",
    content: "Klicke auf die Schaltfläche unten, um dich sofort anzumelden. Dieser Link läuft in 1 Stunde ab und kann nur einmal verwendet werden.",
    ctaText: "Anmelden",
    preheader: "Dein Einmal-Anmeldelink für DisputeDesk.",
    expiry: "Dieser Link läuft in 1 Stunde ab.",
    footerNote: "Du erhältst diese E-Mail, weil du einen Anmeldelink bei DisputeDesk angefordert hast.",
    copyright: "© 2026 DisputeDesk. Alle Rechte vorbehalten.",
  },
  "fr-FR": {
    subject: "Votre lien de connexion DisputeDesk",
    heading: "Se connecter à DisputeDesk",
    content: "Cliquez sur le bouton ci-dessous pour vous connecter instantanément. Ce lien expire dans 1 heure et ne peut être utilisé qu'une seule fois.",
    ctaText: "Se connecter",
    preheader: "Votre lien de connexion en un clic pour DisputeDesk.",
    expiry: "Ce lien expire dans 1 heure.",
    footerNote: "Vous recevez cet e-mail car vous avez demandé un lien de connexion sur DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Tous droits réservés.",
  },
  "es-ES": {
    subject: "Tu enlace de acceso a DisputeDesk",
    heading: "Iniciar sesión en DisputeDesk",
    content: "Haz clic en el botón de abajo para iniciar sesión al instante. Este enlace caduca en 1 hora y solo puede usarse una vez.",
    ctaText: "Iniciar sesión",
    preheader: "Tu enlace de acceso rápido a DisputeDesk.",
    expiry: "Este enlace caduca en 1 hora.",
    footerNote: "Recibes este correo porque solicitaste un enlace de acceso en DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Todos los derechos reservados.",
  },
  "pt-BR": {
    subject: "Seu link de acesso ao DisputeDesk",
    heading: "Entrar no DisputeDesk",
    content: "Clique no botão abaixo para entrar instantaneamente. Este link expira em 1 hora e só pode ser usado uma vez.",
    ctaText: "Entrar",
    preheader: "Seu link de acesso rápido ao DisputeDesk.",
    expiry: "Este link expira em 1 hora.",
    footerNote: "Você está recebendo este e-mail porque solicitou um link de acesso no DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Todos os direitos reservados.",
  },
  "sv-SE": {
    subject: "Din inloggningslänk till DisputeDesk",
    heading: "Logga in på DisputeDesk",
    content: "Klicka på knappen nedan för att logga in direkt. Den här länken går ut om 1 timme och kan bara användas en gång.",
    ctaText: "Logga in",
    preheader: "Din snabba inloggningslänk till DisputeDesk.",
    expiry: "Den här länken går ut om 1 timme.",
    footerNote: "Du får detta e-postmeddelande eftersom du begärde en inloggningslänk på DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Alla rättigheter förbehållna.",
  },
};

export interface MagicLinkEmailVariables {
  actionLink: string;
  locale?: Locale;
}

function getMagicLinkTranslation(locale?: Locale): MagicLinkTranslation {
  return MAGIC_LINK_TRANSLATIONS[locale ?? DEFAULT_LOCALE] ?? MAGIC_LINK_TRANSLATIONS[DEFAULT_LOCALE];
}

export function getMagicLinkSubject(locale?: Locale): string {
  return getMagicLinkTranslation(locale).subject;
}

export function generateMagicLinkEmailHTML(variables: MagicLinkEmailVariables): string {
  const t = getMagicLinkTranslation(variables.locale);

  return `<!DOCTYPE html>
<html lang="en">
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
              <p style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${t.heading}</p>
              <p style="margin:0 0 28px 0;font-size:15px;color:#374151;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${t.content}</p>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background-color:#4F46E5;border-radius:8px;">
                    <a href="${variables.actionLink}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${t.ctaText}</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#9CA3AF;font-family:Arial,Helvetica,sans-serif;">${t.expiry}</p>
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

export function generateMagicLinkEmailText(variables: MagicLinkEmailVariables): string {
  const t = getMagicLinkTranslation(variables.locale);
  return `${t.heading}\n\n${t.content}\n\n${t.ctaText}: ${variables.actionLink}\n\n${t.expiry}`;
}

// ─── Signup confirmation email ────────────────────────────────────────────

interface ConfirmationTranslation {
  subject: string;
  heading: string;
  greeting: string; // may contain {firstName}
  content: string;
  ctaText: string;
  preheader: string;
  expiry: string;
  footerNote: string;
  copyright: string;
}

const CONFIRMATION_TRANSLATIONS: Record<Locale, ConfirmationTranslation> = {
  "en-US": {
    subject: "Confirm your DisputeDesk account",
    heading: "You're almost there",
    greeting: "Hi {firstName},",
    content: "Click the button below to confirm your email address and activate your DisputeDesk account.",
    ctaText: "Confirm Email",
    preheader: "Confirm your email to activate your DisputeDesk account.",
    expiry: "This link expires in 24 hours.",
    footerNote: "You're receiving this because you created an account at DisputeDesk.",
    copyright: "© 2026 DisputeDesk. All rights reserved.",
  },
  "de-DE": {
    subject: "Bestätige dein DisputeDesk-Konto",
    heading: "Fast geschafft",
    greeting: "Hallo {firstName},",
    content: "Klicke auf die Schaltfläche unten, um deine E-Mail-Adresse zu bestätigen und dein DisputeDesk-Konto zu aktivieren.",
    ctaText: "E-Mail bestätigen",
    preheader: "Bestätige deine E-Mail, um dein DisputeDesk-Konto zu aktivieren.",
    expiry: "Dieser Link läuft in 24 Stunden ab.",
    footerNote: "Du erhältst diese E-Mail, weil du ein Konto bei DisputeDesk erstellt hast.",
    copyright: "© 2026 DisputeDesk. Alle Rechte vorbehalten.",
  },
  "fr-FR": {
    subject: "Confirmez votre compte DisputeDesk",
    heading: "Vous y êtes presque",
    greeting: "Bonjour {firstName},",
    content: "Cliquez sur le bouton ci-dessous pour confirmer votre adresse e-mail et activer votre compte DisputeDesk.",
    ctaText: "Confirmer l'e-mail",
    preheader: "Confirmez votre e-mail pour activer votre compte DisputeDesk.",
    expiry: "Ce lien expire dans 24 heures.",
    footerNote: "Vous recevez cet e-mail car vous avez créé un compte sur DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Tous droits réservés.",
  },
  "es-ES": {
    subject: "Confirma tu cuenta de DisputeDesk",
    heading: "Ya casi está",
    greeting: "Hola {firstName},",
    content: "Haz clic en el botón de abajo para confirmar tu dirección de correo electrónico y activar tu cuenta de DisputeDesk.",
    ctaText: "Confirmar correo",
    preheader: "Confirma tu correo para activar tu cuenta de DisputeDesk.",
    expiry: "Este enlace caduca en 24 horas.",
    footerNote: "Recibes este correo porque creaste una cuenta en DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Todos los derechos reservados.",
  },
  "pt-BR": {
    subject: "Confirme sua conta DisputeDesk",
    heading: "Quase lá",
    greeting: "Olá {firstName},",
    content: "Clique no botão abaixo para confirmar seu endereço de e-mail e ativar sua conta DisputeDesk.",
    ctaText: "Confirmar e-mail",
    preheader: "Confirme seu e-mail para ativar sua conta DisputeDesk.",
    expiry: "Este link expira em 24 horas.",
    footerNote: "Você está recebendo este e-mail porque criou uma conta no DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Todos os direitos reservados.",
  },
  "sv-SE": {
    subject: "Bekräfta ditt DisputeDesk-konto",
    heading: "Du är nästan klar",
    greeting: "Hej {firstName},",
    content: "Klicka på knappen nedan för att bekräfta din e-postadress och aktivera ditt DisputeDesk-konto.",
    ctaText: "Bekräfta e-post",
    preheader: "Bekräfta din e-post för att aktivera ditt DisputeDesk-konto.",
    expiry: "Den här länken går ut om 24 timmar.",
    footerNote: "Du får detta e-postmeddelande eftersom du skapade ett konto på DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Alla rättigheter förbehållna.",
  },
};

export interface ConfirmationEmailVariables {
  actionLink: string;
  locale?: Locale;
  fullName?: string;
}

function getConfirmationTranslation(locale?: Locale): ConfirmationTranslation {
  return CONFIRMATION_TRANSLATIONS[locale ?? DEFAULT_LOCALE] ?? CONFIRMATION_TRANSLATIONS[DEFAULT_LOCALE];
}

export function getConfirmationSubject(locale?: Locale): string {
  return getConfirmationTranslation(locale).subject;
}

export function generateConfirmationEmailHTML(variables: ConfirmationEmailVariables): string {
  const t = getConfirmationTranslation(variables.locale);
  const firstName = variables.fullName?.trim().split(/\s+/)[0] || "there";
  const greeting = t.greeting.replace("{firstName}", firstName);

  return `<!DOCTYPE html>
<html lang="en">
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
              <p style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${t.heading}</p>
              <p style="margin:0 0 4px 0;font-size:15px;color:#374151;font-family:Arial,Helvetica,sans-serif;">${greeting}</p>
              <p style="margin:0 0 28px 0;font-size:15px;color:#374151;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${t.content}</p>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background-color:#4F46E5;border-radius:8px;">
                    <a href="${variables.actionLink}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${t.ctaText}</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#9CA3AF;font-family:Arial,Helvetica,sans-serif;">${t.expiry}</p>
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

export function generateConfirmationEmailText(variables: ConfirmationEmailVariables): string {
  const t = getConfirmationTranslation(variables.locale);
  const firstName = variables.fullName?.trim().split(/\s+/)[0] || "there";
  const greeting = t.greeting.replace("{firstName}", firstName);
  return `${t.heading}\n\n${greeting}\n\n${t.content}\n\n${t.ctaText}: ${variables.actionLink}\n\n${t.expiry}`;
}

// ─── Password reset email ─────────────────────────────────────────────────

interface PasswordResetTranslation {
  subject: string;
  heading: string;
  content: string;
  ctaText: string;
  preheader: string;
  expiry: string;
  footerNote: string;
  copyright: string;
}

const PASSWORD_RESET_TRANSLATIONS: Record<Locale, PasswordResetTranslation> = {
  "en-US": {
    subject: "Reset your DisputeDesk password",
    heading: "Reset your password",
    content: "We received a request to reset your password. Click the button below to choose a new one. If you didn't request this, you can safely ignore this email.",
    ctaText: "Reset Password",
    preheader: "Reset your DisputeDesk password.",
    expiry: "This link expires in 1 hour.",
    footerNote: "You're receiving this because a password reset was requested for your DisputeDesk account.",
    copyright: "© 2026 DisputeDesk. All rights reserved.",
  },
  "de-DE": {
    subject: "DisputeDesk-Passwort zurücksetzen",
    heading: "Passwort zurücksetzen",
    content: "Wir haben eine Anfrage zum Zurücksetzen deines Passworts erhalten. Klicke auf die Schaltfläche unten, um ein neues zu wählen. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.",
    ctaText: "Passwort zurücksetzen",
    preheader: "Setze dein DisputeDesk-Passwort zurück.",
    expiry: "Dieser Link läuft in 1 Stunde ab.",
    footerNote: "Du erhältst diese E-Mail, weil ein Passwortreset für dein DisputeDesk-Konto angefordert wurde.",
    copyright: "© 2026 DisputeDesk. Alle Rechte vorbehalten.",
  },
  "fr-FR": {
    subject: "Réinitialiser votre mot de passe DisputeDesk",
    heading: "Réinitialisez votre mot de passe",
    content: "Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Si vous n'avez pas fait cette demande, ignorez cet e-mail.",
    ctaText: "Réinitialiser le mot de passe",
    preheader: "Réinitialisez votre mot de passe DisputeDesk.",
    expiry: "Ce lien expire dans 1 heure.",
    footerNote: "Vous recevez cet e-mail car une réinitialisation de mot de passe a été demandée pour votre compte DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Tous droits réservés.",
  },
  "es-ES": {
    subject: "Restablecer tu contraseña de DisputeDesk",
    heading: "Restablece tu contraseña",
    content: "Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón de abajo para elegir una nueva. Si no solicitaste esto, puedes ignorar este correo.",
    ctaText: "Restablecer contraseña",
    preheader: "Restablece tu contraseña de DisputeDesk.",
    expiry: "Este enlace caduca en 1 hora.",
    footerNote: "Recibes este correo porque se solicitó un restablecimiento de contraseña para tu cuenta de DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Todos los derechos reservados.",
  },
  "pt-BR": {
    subject: "Redefinir sua senha do DisputeDesk",
    heading: "Redefina sua senha",
    content: "Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para escolher uma nova. Se não foi você, pode ignorar este e-mail com segurança.",
    ctaText: "Redefinir senha",
    preheader: "Redefina sua senha do DisputeDesk.",
    expiry: "Este link expira em 1 hora.",
    footerNote: "Você está recebendo este e-mail porque foi solicitada uma redefinição de senha para sua conta DisputeDesk.",
    copyright: "© 2026 DisputeDesk. Todos os direitos reservados.",
  },
  "sv-SE": {
    subject: "Återställ ditt DisputeDesk-lösenord",
    heading: "Återställ ditt lösenord",
    content: "Vi fick en begäran om att återställa ditt lösenord. Klicka på knappen nedan för att välja ett nytt. Om du inte begärde detta kan du ignorera det här e-postmeddelandet.",
    ctaText: "Återställ lösenord",
    preheader: "Återställ ditt DisputeDesk-lösenord.",
    expiry: "Den här länken går ut om 1 timme.",
    footerNote: "Du får detta e-postmeddelande eftersom en lösenordsåterställning begärdes för ditt DisputeDesk-konto.",
    copyright: "© 2026 DisputeDesk. Alla rättigheter förbehållna.",
  },
};

export interface PasswordResetEmailVariables {
  actionLink: string;
  locale?: Locale;
}

function getPasswordResetTranslation(locale?: Locale): PasswordResetTranslation {
  return PASSWORD_RESET_TRANSLATIONS[locale ?? DEFAULT_LOCALE] ?? PASSWORD_RESET_TRANSLATIONS[DEFAULT_LOCALE];
}

export function getPasswordResetSubject(locale?: Locale): string {
  return getPasswordResetTranslation(locale).subject;
}

export function generatePasswordResetEmailHTML(variables: PasswordResetEmailVariables): string {
  const t = getPasswordResetTranslation(variables.locale);

  return `<!DOCTYPE html>
<html lang="en">
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
              <p style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">${t.heading}</p>
              <p style="margin:0 0 28px 0;font-size:15px;color:#374151;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${t.content}</p>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background-color:#4F46E5;border-radius:8px;">
                    <a href="${variables.actionLink}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${t.ctaText}</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#9CA3AF;font-family:Arial,Helvetica,sans-serif;">${t.expiry}</p>
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

export function generatePasswordResetEmailText(variables: PasswordResetEmailVariables): string {
  const t = getPasswordResetTranslation(variables.locale);
  return `${t.heading}\n\n${t.content}\n\n${t.ctaText}: ${variables.actionLink}\n\n${t.expiry}`;
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
