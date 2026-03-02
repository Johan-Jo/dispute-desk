/**
 * Email templates and HTML layout for DisputeDesk.
 * Layout ported from Estimate Pro (string-based HTML, table layout for email clients).
 */

function replaceTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => variables[key] ?? "");
}

/** Welcome email template (English). Kept minimal and transactional to avoid spam filters. */
const WELCOME_TEMPLATE = {
  subject: "Your DisputeDesk account is ready",
  greeting: "Hi {firstName}",
  content: `Your account is set up. Sign in to manage Shopify chargeback evidence and connect your store.`,
  /** Single link text (no "click the button below" or "copy this link" — reduces spam pattern match). */
  signInLinkText: "Sign in to DisputeDesk",
  preheader: "Your DisputeDesk account is ready.",
  regards: "Best regards,",
  teamName: "The DisputeDesk Team",
};

export interface WelcomeEmailVariables {
  firstName: string;
  dashboardUrl: string;
}

/**
 * Generate HTML for the welcome email. Simple transactional layout (one link, no big CTA or "copy link" block) to reduce spam classification.
 */
export function generateWelcomeEmailHTML(variables: WelcomeEmailVariables): string {
  const vars: Record<string, string> = { firstName: variables.firstName, dashboardUrl: variables.dashboardUrl };
  const greeting = replaceTemplateVariables(WELCOME_TEMPLATE.greeting, vars);
  const content = replaceTemplateVariables(WELCOME_TEMPLATE.content, vars);
  const dashboardUrl = variables.dashboardUrl;
  const emailHeading = WELCOME_TEMPLATE.subject;
  const linkText = WELCOME_TEMPLATE.signInLinkText;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailHeading}</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#333;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:0;color:transparent;">${WELCOME_TEMPLATE.preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:20px 12px;">
    <tr><td>
      <p style="margin:0 0 20px 0;font-size:18px;font-weight:600;color:#111827;">DisputeDesk</p>
      <p style="margin:0 0 16px 0;">${greeting}</p>
      <p style="margin:0 0 16px 0;">${content}</p>
      <p style="margin:0 0 24px 0;"><a href="${dashboardUrl}" style="color:#1976d2;text-decoration:underline;">${linkText}</a></p>
      <p style="margin:0;font-size:14px;color:#6b7280;">${WELCOME_TEMPLATE.regards}<br>${WELCOME_TEMPLATE.teamName}</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function getWelcomeSubject(): string {
  return WELCOME_TEMPLATE.subject;
}

/**
 * Generate plain-text version of the welcome email.
 */
export function generateWelcomeEmailText(variables: WelcomeEmailVariables): string {
  const vars: Record<string, string> = { firstName: variables.firstName, dashboardUrl: variables.dashboardUrl };
  const greeting = replaceTemplateVariables(WELCOME_TEMPLATE.greeting, vars);
  const content = replaceTemplateVariables(WELCOME_TEMPLATE.content, vars);
  return `${WELCOME_TEMPLATE.subject}\n\n${greeting}\n\n${content}\n\n${WELCOME_TEMPLATE.signInLinkText}: ${variables.dashboardUrl}\n\n${WELCOME_TEMPLATE.regards}\n${WELCOME_TEMPLATE.teamName}`;
}
