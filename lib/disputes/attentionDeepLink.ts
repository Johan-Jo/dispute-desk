/**
 * Attention → dispute-detail deep-link target.
 *
 * A dispute that needs the merchant's attention should land them on the
 * exact section that needs acting, with the section scrolled-to and
 * spotlighted (the workspace reads `?section=<key>` and pulses that card).
 * This maps an `attention_reason` to that section key so the dashboard
 * banner and the list rows deep-link consistently.
 *
 * Today the only concrete, merchant-actionable in-workspace attention is a
 * matched Gorgias conversation awaiting approval (`gorgias_evidence_ready`)
 * → the Gorgias review card on the Evidence tab. Other reasons either
 * aren't a workspace section (billing/technical → Settings) or were
 * removed as generic noise (recommended/opportunity), so they return null
 * and the link falls back to the dispute with no section spotlight.
 */

/** The `?section=` value the dispute-detail workspace understands. */
export type WorkspaceSectionKey = "gorgias-comms";

export function attentionSectionParam(
  attentionReason: string | null | undefined,
): WorkspaceSectionKey | null {
  if (attentionReason === "gorgias_evidence_ready") return "gorgias-comms";
  return null;
}

/** Section for a resolved presentation attention value (the list rows
 *  carry the presentation, not the raw reason). `requested` is the
 *  Gorgias-approval state → the Gorgias review card. */
export function attentionSectionForAttention(
  attention: string | null | undefined,
): WorkspaceSectionKey | null {
  if (attention === "requested") return "gorgias-comms";
  return null;
}

/** Build the dispute-detail path (optionally with the section spotlight).
 *  `base` is the app disputes root, e.g. "/app/disputes". */
export function disputeDeepLinkPath(
  base: string,
  disputeId: string,
  attentionReason: string | null | undefined,
): string {
  const section = attentionSectionParam(attentionReason);
  const path = `${base}/${disputeId}`;
  return section ? `${path}?section=${section}` : path;
}
