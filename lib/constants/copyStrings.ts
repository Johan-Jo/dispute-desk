/**
 * User-facing copy strings for dispute evidence actions.
 *
 * RULE: Avoid implying DisputeDesk sends evidence to card networks directly.
 * CI grep enforces this in app/ and components/ directories.
 */

export const COPY = {
  saveButton: "Save Evidence to Shopify",
  saveDescription:
    "Save your evidence to Shopify. This does not submit the dispute response.",
  openAdminLink: "Open in Shopify Admin to review and finalize",
  shopifySubmitNote:
    "Shopify will submit your evidence by the dispute due date, or you can submit manually in Shopify Admin.",
  missingOnlineSession:
    "Please re-open the app from Shopify Admin to authenticate before saving evidence.",
  missingEvidenceGid:
    "Dispute evidence ID not found. Sync the dispute first, then try again.",
} as const;
