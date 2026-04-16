/**
 * Payment / AVS+CVV / card metadata / risk / IP evidence source collector.
 *
 * Reads the pre-fetched OrderDetailNode from ctx.order and extracts:
 * - Card payment verification (AVS, CVV) — only when CardPaymentDetails present
 * - Card metadata (BIN, network, wallet, cardholder name)
 * - Risk assessments (level + facts from Shopify or third-party fraud apps)
 * - Customer IP (from order.clientIp — may be null on many stores)
 *
 * AVS/CVV availability is CONDITIONAL on gateway and payment type.
 * Missing AVS/CVV is NOT an error — it's recorded as unavailable_from_gateway.
 */

import type {
  OrderTransaction,
  CardPaymentDetails,
  OrderRiskAssessment,
} from "@/lib/shopify/queries/orders";
import type { EvidenceSection, BuildContext } from "../types";

function isCardPayment(
  details: OrderTransaction["paymentDetails"],
): details is CardPaymentDetails {
  return details?.__typename === "CardPaymentDetails";
}

/**
 * Determine the AVS/CVV availability status for this order's payment.
 * Returns a structured object so callers know WHY data is or isn't present.
 */
export type AvsCvvStatus =
  | "available"             // AVS and/or CVV codes present
  | "unavailable_from_gateway" // Card payment but gateway didn't return codes
  | "not_applicable";       // Non-card payment (PayPal, manual, etc.)

export interface CardEvidenceData {
  [key: string]: unknown;
  avsCvvStatus: AvsCvvStatus;
  avsResultCode: string | null;
  cvvResultCode: string | null;
  bin: string | null;
  cardCompany: string | null;
  lastFour: string | null;
  cardholderName: string | null;
  expirationMonth: number | null;
  expirationYear: number | null;
  wallet: string | null;
  gateway: string;
}

export interface RiskEvidenceData {
  [key: string]: unknown;
  overallLevel: string;
  assessments: Array<{
    riskLevel: string;
    provider: string | null;
    facts: Array<{ description: string; sentiment: string }>;
  }>;
}

export interface IpEvidenceData {
  [key: string]: unknown;
  ip: string;
  source: "order_client_ip" | "manual_input";
}

export async function collectPaymentEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  if (!order) return [];

  const sections: EvidenceSection[] = [];

  // ── Card payment evidence ──
  const cardSection = collectCardEvidence(order.transactions);
  if (cardSection) sections.push(cardSection);

  // ── Risk assessment evidence ──
  const riskSection = collectRiskEvidence(order.riskAssessments);
  if (riskSection) sections.push(riskSection);

  // ── IP evidence ──
  const ipSection = collectIpEvidence(order.clientIp);
  if (ipSection) sections.push(ipSection);

  return sections;
}

function collectCardEvidence(
  transactions: OrderTransaction[] | undefined,
): EvidenceSection | null {
  if (!transactions?.length) return null;

  // Find the first successful SALE or AUTHORIZATION with card payment details
  const cardTx = transactions.find(
    (t) =>
      (t.kind === "SALE" || t.kind === "AUTHORIZATION") &&
      t.status === "SUCCESS" &&
      isCardPayment(t.paymentDetails),
  );

  // Non-card payment — not an error, just not applicable
  if (!cardTx || !isCardPayment(cardTx.paymentDetails)) {
    // Check if there's ANY successful transaction (non-card)
    const anySuccessTx = transactions.find(
      (t) =>
        (t.kind === "SALE" || t.kind === "AUTHORIZATION") &&
        t.status === "SUCCESS",
    );
    if (!anySuccessTx) return null;

    // Non-card payment exists — record status as not_applicable
    return {
      type: "other",
      label: "Payment Verification",
      source: "shopify_transactions",
      fieldsProvided: ["avs_cvv_match"],
      data: {
        avsCvvStatus: "not_applicable" as AvsCvvStatus,
        avsResultCode: null,
        cvvResultCode: null,
        gateway: anySuccessTx.gateway,
      } satisfies Partial<CardEvidenceData>,
    };
  }

  const details = cardTx.paymentDetails;
  const hasAvsOrCvv =
    (details.avsResultCode != null && details.avsResultCode !== "") ||
    (details.cvvResultCode != null && details.cvvResultCode !== "");

  const avsCvvStatus: AvsCvvStatus = hasAvsOrCvv
    ? "available"
    : "unavailable_from_gateway";

  const data: CardEvidenceData = {
    avsCvvStatus,
    avsResultCode: details.avsResultCode,
    cvvResultCode: details.cvvResultCode,
    bin: details.bin,
    cardCompany: details.company,
    lastFour: details.number,
    cardholderName: details.name,
    expirationMonth: details.expirationMonth,
    expirationYear: details.expirationYear,
    wallet: details.wallet,
    gateway: cardTx.gateway,
  };

  return {
    type: "other",
    label: "Payment Verification (AVS/CVV)",
    source: "shopify_transactions",
    fieldsProvided: ["avs_cvv_match"],
    data,
  };
}

function collectRiskEvidence(
  riskAssessments: OrderRiskAssessment[] | undefined,
): EvidenceSection | null {
  if (!riskAssessments?.length) return null;

  // Derive overall level: highest severity wins
  const levelOrder = { NONE: 0, PENDING: 1, LOW: 2, MEDIUM: 3, HIGH: 4 };
  let overallLevel = "NONE";
  for (const ra of riskAssessments) {
    if ((levelOrder[ra.riskLevel] ?? 0) > (levelOrder[overallLevel as keyof typeof levelOrder] ?? 0)) {
      overallLevel = ra.riskLevel;
    }
  }

  const data: RiskEvidenceData = {
    overallLevel,
    assessments: riskAssessments.map((ra) => ({
      riskLevel: ra.riskLevel,
      provider: ra.provider?.title ?? null,
      facts: ra.facts.map((f) => ({
        description: f.description,
        sentiment: f.sentiment,
      })),
    })),
  };

  return {
    type: "other",
    label: "Fraud Risk Assessment",
    source: "shopify_risk",
    fieldsProvided: ["risk_analysis"],
    data,
  };
}

function collectIpEvidence(
  clientIp: string | null | undefined,
): EvidenceSection | null {
  // clientIp may be null on many stores (Shopify restriction)
  if (!clientIp) return null;

  const data: IpEvidenceData = {
    ip: clientIp,
    source: "order_client_ip",
  };

  return {
    type: "other",
    label: "Customer Purchase IP",
    source: "shopify_order",
    fieldsProvided: ["customer_ip"],
    data,
  };
}
