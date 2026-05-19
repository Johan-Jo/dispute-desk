/**
 * Case Details rows — single source of truth for the (label, value)
 * pairs rendered at the top of the defence package on BOTH the PDF
 * and the embedded HTML view.
 *
 * The two surfaces drifted in two small ways before this module
 * existed:
 *   - PDF had a "Claim type" row; HTML view didn't.
 *   - PDF used "Merchant name"; HTML view used "Merchant".
 *
 * Both renderers now import `buildCaseDetailsRows()` so changes here
 * propagate to both surfaces. The shape is deliberately permissive
 * so each caller can map its own meta type onto this contract
 * without losing nullability.
 *
 * REASON-FAMILY-AWARE FILTERING (2026-05-19)
 * ------------------------------------------
 * Not every metadata field is safe to put in front of the bank in
 * every dispute family. Specifically: `Fulfillment status:
 * UNFULFILLED` reaches the bank inside the PDF and, on a Visa 10.4
 * fraud case, invites the issuer to ask "if you didn't ship it,
 * what is there to refute?" The fraud argument hinges on
 * cardholder authentication, not delivery — surfacing
 * fulfillmentStatus in the cover table is dead weight that creates
 * an attack surface.
 *
 * The `familyKey` input controls which rows render. Defaults
 * (when familyKey is null/unknown) keep every row — the legacy
 * behaviour.
 */

import type { ReasonCodeFamilyKey } from "../types";

/**
 * Inputs the row builder reads. Each renderer's meta is a superset
 * of this — PDF passes `DefencePackageMeta`, HTML view passes the
 * `DisputeContextLike` it receives as a prop.
 */
export interface CaseDetailsInput {
  disputeIdShort?: string | null;
  merchantName?: string | null;
  cardNetwork?: string | null;
  transactionDateDisplay?: string | null;
  amountDisplay?: string | null;
  reasonCodeDisplay?: string | null;
  claimType?: string | null;
  orderName?: string | null;
  cardholderName?: string | null;
  cardLast4?: string | null;
  paymentGateway?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  /**
   * Reason-code family for the dispute. Drives the row deny list
   * below. When null/unknown, no rows are filtered (legacy behaviour).
   */
  familyKey?: ReasonCodeFamilyKey | null;
}

export type CaseDetailsRow = readonly [label: string, value: string];

/**
 * Per-family row deny list. Rows named here are dropped from the
 * Case Details table on the bank-facing PDF (and the embedded HTML
 * mirror) because surfacing them would weaken the argument for that
 * family.
 *
 * Conservative by default — only fields whose presence
 * demonstrably HURTS the merchant for a specific family are listed.
 * Order metadata that's neutral or helpful stays visible everywhere.
 *
 * TypeScript exhaustiveness: typed as `Record<ReasonCodeFamilyKey,
 * Set<string>>` so adding a new family to the union forces a compile
 * error here, prompting a deliberate decision about that family's
 * row visibility.
 */
const ROW_DENY_BY_FAMILY: Record<ReasonCodeFamilyKey, Set<string>> = {
  // Unauthorized fraud (Visa 10.4 / MC 4837). The dispute is about
  // cardholder authentication, not delivery. Naming
  // fulfillmentStatus on the cover table — especially "UNFULFILLED"
  // — invites the issuer to question whether the merchant has any
  // basis to dispute at all. Keep it off the bank-facing table.
  unauthorized_fraud: new Set<string>(["Fulfillment status"]),
  // Other families: delivery / fulfillment are central to the
  // argument (INR proves it shipped; product-not-as-described
  // proves it arrived) — keep every row.
  item_not_received: new Set<string>(),
  product_not_as_described: new Set<string>(),
  credit_not_processed: new Set<string>(),
  duplicate_processing: new Set<string>(),
  cancelled_recurring: new Set<string>(),
  processing_error: new Set<string>(),
  authorization_error: new Set<string>(),
  fallback: new Set<string>(),
};

/**
 * Build the canonical Case Details rows in display order. Empty
 * values render as "—" so the layout doesn't shift between cases.
 * Rows in the per-family deny list are dropped entirely (no "—"
 * placeholder either — they don't exist as far as the bank is
 * concerned).
 *
 * Each renderer maps these rows onto its own table primitives:
 *   - PDF: striped @react-pdf <View> rows
 *   - HTML view: collapsed Polaris row stack
 */
export function buildCaseDetailsRows(
  input: CaseDetailsInput,
): CaseDetailsRow[] {
  const dash = (v: string | null | undefined) =>
    v && v.trim().length > 0 ? v : "—";

  const deny: Set<string> = input.familyKey
    ? (ROW_DENY_BY_FAMILY[input.familyKey] ?? new Set<string>())
    : new Set<string>();

  const allRows: CaseDetailsRow[] = [
    ["Dispute ID", dash(input.disputeIdShort)],
    ["Merchant name", dash(input.merchantName)],
    ["Card network", dash(input.cardNetwork)],
    ["Transaction date", dash(input.transactionDateDisplay)],
    ["Disputed amount", dash(input.amountDisplay)],
    ["Reason code", dash(input.reasonCodeDisplay)],
    ["Claim type", dash(input.claimType)],
    ["Order ID", dash(input.orderName)],
    ["Cardholder name", dash(input.cardholderName)],
    ["Card (last 4)", dash(input.cardLast4)],
    ["Payment gateway", dash(input.paymentGateway)],
    ["Financial status", dash(input.financialStatus)],
    ["Fulfillment status", dash(input.fulfillmentStatus)],
  ];

  return allRows.filter(([label]) => !deny.has(label));
}
