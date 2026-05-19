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
 * (`Partial<CaseDetailsInput>`) so each caller can map its own meta
 * type onto this contract without losing nullability.
 */

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
}

export type CaseDetailsRow = readonly [label: string, value: string];

/**
 * Build the canonical Case Details rows in display order. Empty
 * values render as "—" so the layout doesn't shift between cases.
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

  return [
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
}
