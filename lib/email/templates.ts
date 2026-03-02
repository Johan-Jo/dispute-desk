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

/** Welcome email template (English). */
const WELCOME_TEMPLATE = {
  subject: "Welcome to DisputeDesk — you're all set",
  greeting: "Hi {firstName}",
  content: `You're in. DisputeDesk helps you manage Shopify chargeback evidence: sync disputes, build evidence packs, and save them back to Shopify — with optional automation so you can focus on running your store.

Click the button below to open your dashboard and connect your first store.`,
  buttonText: "Go to dashboard",
  preheader: "You're all set. Open your dashboard to get started.",
  regards: "Best regards,",
  teamName: "The DisputeDesk Team",
  tagline: "DisputeDesk — Chargeback evidence, simplified.",
};

export interface WelcomeEmailVariables {
  firstName: string;
  dashboardUrl: string;
}

/**
 * Generate HTML for the welcome email using the shared layout.
 * Structure matches Estimate Pro: table-based, 600px, logo row, heading, intro, CTA, footer.
 */
export function generateWelcomeEmailHTML(variables: WelcomeEmailVariables): string {
  const vars: Record<string, string> = { firstName: variables.firstName, dashboardUrl: variables.dashboardUrl };
  const greeting = replaceTemplateVariables(WELCOME_TEMPLATE.greeting, vars);
  const content = replaceTemplateVariables(WELCOME_TEMPLATE.content, vars);
  const formattedContent = content.replace(/\n/g, "<br>");
  const emailHeading = WELCOME_TEMPLATE.subject;
  const ctaLabel = WELCOME_TEMPLATE.buttonText;
  const dashboardUrl = variables.dashboardUrl;
  const baseUrl = dashboardUrl.replace(/\/portal.*$/, "") || "https://disputedesk.com";
  const footerReply = "Need help? Reply to this email.";
  const linkDashboard = "Go to dashboard";
  const linkSignIn = "Sign in";

  const introBlock = `<p style="margin:0 0 8px 0;font-size:16px;color:#374151;line-height:1.5;">${greeting}</p>
          <div style="margin:0 0 20px 0;font-size:16px;color:#374151;line-height:1.5;">${formattedContent.trim()}</div>`;

  const buttonBg = "#1976d2";
  const buttonFg = "#ffffff";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailHeading}</title>
  <!--[if mso]><noscript><style>.btn { border-radius: 0 !important; }</style></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F5F7FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.5;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:0;color:transparent;">${WELCOME_TEMPLATE.preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F7FB;padding:32px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E6E8EF;border-radius:12px;-webkit-border-radius:12px;">
        <tr><td style="padding:24px 28px;border-bottom:1px solid #E6E8EF;">
          <h1 style="margin:0;font-size:20px;font-weight:700;color:#111827;"><span style="color:#000000;">Dispute</span><span style="color:#2563EB;">Desk</span></h1>
        </td></tr>
        <tr><td style="padding:28px 28px 24px;">
          <h2 style="margin:0 0 20px 0;font-size:24px;font-weight:700;color:#111827;line-height:1.3;">${emailHeading}</h2>
          ${introBlock}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 28px;">
            <a href="${dashboardUrl}" class="btn" style="display:inline-block;background-color:${buttonBg};color:${buttonFg} !important;padding:14px 18px;border-radius:10px;-webkit-border-radius:10px;text-decoration:none;font-size:16px;font-weight:700;">${ctaLabel}</a>
          </td></tr></table>
          <div style="margin:16px 0;padding:12px 16px;background-color:#f9fafb;border-radius:8px;"><p style="margin:0 0 6px 0;font-size:14px;color:#6b7280;">Or copy and paste this link into your browser:</p><a href="${dashboardUrl}" style="font-size:12px;color:#0b0b0b;word-break:break-all;text-decoration:underline;">${dashboardUrl}</a></div>
          <p style="margin:0 0 12px 0;font-size:14px;color:#6B7280;text-align:center;">
            <a href="${dashboardUrl}" style="color:#2563EB;text-decoration:none;">${linkDashboard}</a>
            <span style="color:#D1D5DB;margin:0 8px;">&bull;</span>
            <a href="${baseUrl}/auth/sign-in" style="color:#2563EB;text-decoration:none;">${linkSignIn}</a>
          </p>
        </td></tr>
        <tr><td style="padding:24px 28px;border-top:1px solid #E6E8EF;background-color:#F9FAFB;">
          <p style="margin:0 0 8px 0;font-size:14px;color:#6B7280;text-align:center;line-height:1.5;">${footerReply}</p>
          <p style="margin:0;font-size:13px;color:#9CA3AF;text-align:center;">© ${new Date().getFullYear()} DisputeDesk.</p>
        </td></tr>
      </table>
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
  return `${WELCOME_TEMPLATE.subject}\n\n${greeting}\n\n${content}\n\n${WELCOME_TEMPLATE.buttonText}: ${variables.dashboardUrl}\n\n---\n${WELCOME_TEMPLATE.regards}\n${WELCOME_TEMPLATE.teamName}\n${WELCOME_TEMPLATE.tagline}`;
}
