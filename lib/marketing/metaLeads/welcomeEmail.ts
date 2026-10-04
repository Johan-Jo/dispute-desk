/**
 * First email to a Meta Instant Form lead. Plain, table-free, one call to action.
 * Sending is OFF unless META_LEADS_WELCOME_ENABLED=1 (see ingest.ts) — the copy below is a
 * draft for the founder to review before any lead is emailed.
 */

export type MetaLeadWelcomeEmail = { subject: string; html: string; text: string };

export function buildMetaLeadWelcomeEmail(opts: {
  firstName: string | null;
  installUrl: string;
  bookingUrl: string;
  unsubscribeUrl: string;
}): MetaLeadWelcomeEmail {
  const hello = opts.firstName ? `Hi ${opts.firstName},` : "Hi,";
  const subject = "Your chargebacks, handled — here's how DisputeDesk works";

  const lines = [
    hello,
    "Thanks for your interest in DisputeDesk.",
    "DisputeDesk watches your Shopify disputes, builds the evidence for each one from your own order data, and files it for you in Shopify — so you stop losing disputes you could have won.",
    `You can try it free on your store in about two minutes: ${opts.installUrl}`,
    `Prefer to talk it through first? Book a short call: ${opts.bookingUrl}`,
    "Or just reply to this email with a question — it goes straight to us.",
    "— The DisputeDesk team",
  ];

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111827;padding:24px 16px;max-width:560px;">
  <p>${hello}</p>
  <p>Thanks for your interest in DisputeDesk.</p>
  <p>DisputeDesk watches your Shopify disputes, builds the evidence for each one from your own order data, and files it for you in Shopify — so you stop losing disputes you could have won.</p>
  <p><a href="${opts.installUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px;">Try it free on your store</a></p>
  <p>Prefer to talk it through first? <a href="${opts.bookingUrl}">Book a short call</a>, or just reply to this email with a question — it goes straight to us.</p>
  <p>— The DisputeDesk team</p>
  <p style="margin-top:28px;font-size:12px;color:#6b7280;">You're receiving this because you asked for more information through a DisputeDesk ad. <a href="${opts.unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a></p>
</body></html>`;

  const text = `${lines.join("\n\n")}\n\n--\nYou're receiving this because you asked for more information through a DisputeDesk ad. Unsubscribe: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}
