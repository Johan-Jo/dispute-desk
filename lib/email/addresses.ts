/**
 * Canonical From / Reply-To addresses for merchant-facing transactional email.
 *
 * Before this module the same two literals were re-declared in seventeen
 * senders, each with its own `process.env.X ?? "…"` fallback. Changing the
 * reply address meant finding all seventeen — so in practice it never changed,
 * and every email replied to `notifications@`, an unmonitored sending mailbox.
 * Several emails invite a reply in their copy ("just reply to this email — it
 * reaches a person"), which made that a promise we did not keep.
 *
 * Reply-To is therefore `support@disputedesk.app`, the actual ops address, and
 * is deliberately DIFFERENT from the From address: `notifications@mail.…` is a
 * verified Resend sending subdomain, while `support@` is a monitored inbox that
 * is not (and need not be) a verified sender.
 *
 * `EMAIL_FROM` / `EMAIL_REPLY_TO` still override, so an environment can point
 * either elsewhere without a code change.
 */

/** Verified Resend sending identity. Must stay on the verified subdomain. */
export const DEFAULT_FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";

/**
 * Monitored inbox merchant replies land in. Never a no-reply address — it
 * hurts deliverability, and our copy explicitly invites replies.
 */
export const DEFAULT_REPLY_TO =
  process.env.EMAIL_REPLY_TO ?? "DisputeDesk Support <support@disputedesk.app>";
