/**
 * CE 3.0 evidence-package template definitions.
 *
 * The PDF rendering is in lib/packs/pdf/CE30PackDocument.tsx; this
 * module produces the strongly-typed *data* the PDF consumes. Pure —
 * easy to unit-test verdict → package data mapping.
 *
 * See docs/epics/EPIC-LSE-2-evidence-package.md §Output formats.
 */

import type { CE30Result, QualificationOrder } from "./types";

export const CE30_TEMPLATE_VERSION = "ce30-v1.0.0";

export interface CE30PackageData {
  templateVersion: string;
  language: string;
  /** Merchant-facing header. */
  cover: {
    merchantName: string;
    disputeId: string;
    disputedTransactionAt: string;
    disputedAmount: string;
    programInvoked: "ce_30";
    /** Single-line qualification headline. */
    headline: string;
    confidenceBadge: "high" | "medium" | "low" | "auto_qualified" | null;
  };
  /** Per-branch evidence body. Only one of these is populated. */
  evidence:
    | {
        kind: "auto_qualified";
        via: "visa_secure" | "visa_data_only" | "merchant_confirmed";
        feeAppliesFrom: string | null;
      }
    | {
        kind: "initial_billing";
        disputedRow: TransactionRow;
        initialBillingRow: TransactionRow;
        matchSummary: string;
      }
    | {
        kind: "standard";
        disputedRow: TransactionRow;
        priorRows: TransactionRow[];
        matchSummary: string;
      }
    | {
        kind: "partial";
        disputedRow: TransactionRow;
        priorRows: TransactionRow[];
        missingEvidence: string[];
      };
  /** Closing merchant statement, language-localized. */
  statement: string;
}

export interface TransactionRow {
  label: string; // "Disputed transaction" / "Prior order #2"
  orderId: string;
  date: string;
  amount: string;
  ip: string | null;
  shippingAddress: string | null;
  customerAccount: string | null;
  deviceFingerprintHash: string | null;
  /** Match indicators (✓ / ·) for the matched data points across rows. */
  matchedPoints: {
    ip: boolean;
    device: boolean;
    shipping: boolean;
    account: boolean;
  };
}

export interface BuildCE30PackageInput {
  merchantName: string;
  disputeId: string;
  language: string;
  verdict: CE30Result;
  disputed: QualificationOrder;
  /** Used by `standard` and `initial_billing` branches. */
  matchedPriors?: QualificationOrder[];
  /** Used by `initial_billing` branch. */
  initialBilling?: QualificationOrder | null;
}

export function buildCE30PackageData(input: BuildCE30PackageInput): CE30PackageData {
  const { merchantName, disputeId, language, verdict, disputed } = input;
  const cover = buildCover(merchantName, disputeId, disputed, verdict);

  let evidence: CE30PackageData["evidence"];
  if (verdict.branch === "auto_qualified" && verdict.autoQualificationVia) {
    evidence = {
      kind: "auto_qualified",
      via: verdict.autoQualificationVia,
      feeAppliesFrom: verdict.autoQualificationFeeApplies ? "2026-04-17" : null,
    };
  } else if (verdict.branch === "initial_billing" && input.initialBilling) {
    evidence = {
      kind: "initial_billing",
      disputedRow: buildTransactionRow(disputed, verdict, "Disputed transaction"),
      initialBillingRow: buildTransactionRow(
        input.initialBilling,
        verdict,
        "Initial subscription billing",
      ),
      matchSummary: summarizeMatch(verdict),
    };
  } else if (verdict.branch === "standard") {
    const priors = (input.matchedPriors ?? []).slice(0, 2);
    evidence = {
      kind: "standard",
      disputedRow: buildTransactionRow(disputed, verdict, "Disputed transaction"),
      priorRows: priors.map((p, i) =>
        buildTransactionRow(p, verdict, `Prior order #${i + 1}`),
      ),
      matchSummary: summarizeMatch(verdict),
    };
  } else {
    // Partial / does_not_qualify / not_applicable — these don't get a
    // CE 3.0 package generated. Callers should gate on verdict before
    // invoking buildCE30PackageData. Build a defensive "partial" shape
    // so the type system is honest.
    const priors = (input.matchedPriors ?? []).slice(0, 2);
    evidence = {
      kind: "partial",
      disputedRow: buildTransactionRow(disputed, verdict, "Disputed transaction"),
      priorRows: priors.map((p, i) =>
        buildTransactionRow(p, verdict, `Prior order #${i + 1}`),
      ),
      missingEvidence: verdict.missingEvidence,
    };
  }

  return {
    templateVersion: CE30_TEMPLATE_VERSION,
    language,
    cover,
    evidence,
    statement: buildStatement(language),
  };
}

/* ── Helpers ── */

function buildCover(
  merchantName: string,
  disputeId: string,
  disputed: QualificationOrder,
  verdict: CE30Result,
): CE30PackageData["cover"] {
  let headline: string;
  if (verdict.branch === "auto_qualified") {
    headline =
      verdict.autoQualificationVia === "visa_data_only"
        ? "This dispute was auto-qualified for Visa Compelling Evidence 3.0 via Visa Data Only."
        : verdict.autoQualificationVia === "merchant_confirmed"
          ? "This dispute was auto-qualified for Visa Compelling Evidence 3.0 via merchant-confirmed 3-D Secure."
          : "This dispute was auto-qualified for Visa Compelling Evidence 3.0 via Visa Secure (3DS2).";
  } else if (verdict.branch === "initial_billing") {
    headline =
      "This recurring transaction qualifies for Visa Compelling Evidence 3.0 via the initial subscription billing transaction.";
  } else {
    headline =
      "This dispute qualifies for Visa Compelling Evidence 3.0 — matching data points across two undisputed prior transactions in the 120–365 day window establish the cardholder relationship.";
  }

  let confidenceBadge: CE30PackageData["cover"]["confidenceBadge"];
  if (verdict.branch === "auto_qualified") {
    confidenceBadge = "auto_qualified";
  } else {
    confidenceBadge = verdict.confidence;
  }

  return {
    merchantName,
    disputeId,
    disputedTransactionAt: disputed.createdAt,
    disputedAmount: disputed.totalAmount.toFixed(2),
    programInvoked: "ce_30",
    headline,
    confidenceBadge,
  };
}

function buildTransactionRow(
  order: QualificationOrder,
  verdict: CE30Result,
  label: string,
): TransactionRow {
  const matchedPoints = {
    ip: verdict.matchPoints.includes("ip"),
    device: verdict.matchPoints.includes("device"),
    shipping: verdict.matchPoints.includes("shipping"),
    account: verdict.matchPoints.includes("account"),
  };

  return {
    label,
    orderId: order.shopifyOrderId.split("/").pop() ?? order.shopifyOrderId,
    date: order.createdAt,
    amount: order.totalAmount.toFixed(2),
    ip: order.ipAddress,
    shippingAddress: formatShipping(order.shippingAddress),
    customerAccount: order.customerId ?? order.customerEmail,
    // Fingerprint shown as truncated hash (PII-safe).
    deviceFingerprintHash: order.deviceFingerprint
      ? `${order.deviceFingerprint.slice(0, 12)}…`
      : null,
    matchedPoints,
  };
}

function formatShipping(
  addr: QualificationOrder["shippingAddress"],
): string | null {
  if (!addr) return null;
  const parts = [
    addr.address1,
    addr.address2,
    addr.city,
    addr.provinceCode ?? addr.province,
    addr.zip,
    addr.countryCode ?? addr.country,
  ].filter((p) => p && p.toString().trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

function summarizeMatch(verdict: CE30Result): string {
  if (verdict.matchPoints.length === 0) {
    return "";
  }
  const labels: Record<string, string> = {
    ip: "IP address",
    device: "device fingerprint",
    shipping: "shipping address",
    account: "customer account",
  };
  const matchList = verdict.matchPoints.map((p) => labels[p] ?? p).join(", ");
  const anchorNote = verdict.hasAnchor
    ? " Anchor requirement (IP or device match) is satisfied."
    : "";
  return `Matched data points: ${matchList}.${anchorNote}`;
}

function buildStatement(language: string): string {
  // EN + PT-BR per PRD §10 Phase 2. Other locales fall back to English.
  if (language.toLowerCase().startsWith("pt")) {
    return (
      "Atestamos que a relação com este titular do cartão é genuína. O histórico " +
      "de transações anteriores e os pontos de dados correspondentes estabelecem " +
      "que o titular do cartão é o cliente legítimo. Solicitamos que o emissor " +
      "considere esta evidência sob o programa Visa Compelling Evidence 3.0."
    );
  }
  return (
    "We attest that the relationship with this cardholder is genuine. The " +
    "prior transaction history and matching data points establish that the " +
    "cardholder is the legitimate customer. We respectfully request the " +
    "issuer consider this evidence under the Visa Compelling Evidence 3.0 program."
  );
}
