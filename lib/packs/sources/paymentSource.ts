/**
 * Payment / AVS+CVV evidence source collector.
 *
 * Reads the pre-fetched OrderDetailNode from ctx.order and extracts
 * card payment verification data (AVS result, CVV result) from
 * order transactions. Contributes avs_cvv_match.
 */

import type { OrderTransaction, CardPaymentDetails } from "@/lib/shopify/queries/orders";
import type { EvidenceSection, BuildContext } from "../types";

function isCardPayment(
  details: OrderTransaction["paymentDetails"],
): details is CardPaymentDetails {
  return details?.__typename === "CardPaymentDetails";
}

export async function collectPaymentEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  if (!order?.transactions?.length) return [];

  // Find the first successful SALE or AUTHORIZATION with card payment details
  const cardTx = order.transactions.find(
    (t) =>
      (t.kind === "SALE" || t.kind === "AUTHORIZATION") &&
      t.status === "SUCCESS" &&
      isCardPayment(t.paymentDetails),
  );

  if (!cardTx || !isCardPayment(cardTx.paymentDetails)) return [];

  const details = cardTx.paymentDetails;
  const hasAvsOrCvv =
    details.avsResultCode != null || details.cvvResultCode != null;

  if (!hasAvsOrCvv) return [];

  return [
    {
      type: "other",
      label: "Payment Verification (AVS/CVV)",
      source: "shopify_transactions",
      fieldsProvided: ["avs_cvv_match"],
      data: {
        avsResultCode: details.avsResultCode,
        cvvResultCode: details.cvvResultCode,
        gateway: cardTx.gateway,
        cardCompany: details.company,
        lastFour: details.number,
      },
    },
  ];
}
