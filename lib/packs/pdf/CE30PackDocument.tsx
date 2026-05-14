import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import type { CE30PackageData, TransactionRow } from "@/lib/liabilityShift/packageTemplates";

/**
 * Visa Compelling Evidence 3.0 evidence-package PDF.
 *
 * Layout follows docs/epics/EPIC-LSE-2-evidence-package.md §Package shape:
 *   Page 1 — Cover + qualification headline + confidence badge
 *   Page 2 — Evidence: branch-specific (auto-qualified summary,
 *            qualification table with matched points highlighted, or
 *            partial-state message)
 *   Page 3 — Merchant statement
 *
 * Pure component — caller assembles CE30PackageData (see
 * lib/liabilityShift/packageTemplates.ts).
 */
export interface CE30PackPdfProps {
  data: CE30PackageData;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function CoverPage({ data }: CE30PackPdfProps) {
  const badgeColor =
    data.cover.confidenceBadge === "auto_qualified"
      ? "#1D4ED8"
      : data.cover.confidenceBadge === "high"
        ? "#16A34A"
        : data.cover.confidenceBadge === "medium"
          ? "#CA8A04"
          : "#94A3B8";

  return (
    <Page size="LETTER" style={styles.coverPage}>
      <Text style={styles.coverTitle}>Visa Compelling Evidence 3.0</Text>
      <Text style={styles.coverSubtitle}>{data.cover.merchantName}</Text>

      <View style={{ marginTop: 30, marginBottom: 30, alignItems: "center" }}>
        <Text style={[styles.coverScore, { color: badgeColor }]}>
          {data.cover.confidenceBadge === "auto_qualified"
            ? "Auto-qualified by Visa"
            : data.cover.confidenceBadge === "high"
              ? "Qualifies — high confidence"
              : data.cover.confidenceBadge === "medium"
                ? "Qualifies — medium confidence"
                : data.cover.confidenceBadge === "low"
                  ? "Qualifies — low confidence"
                  : "Qualifies"}
        </Text>
      </View>

      <Text style={styles.coverMeta}>
        Dispute ID: {data.cover.disputeId.split("/").pop() ?? data.cover.disputeId}
      </Text>
      <Text style={styles.coverMeta}>
        Transaction: {formatDate(data.cover.disputedTransactionAt)} — $
        {data.cover.disputedAmount}
      </Text>
      <Text style={styles.coverMeta}>Program: Visa CE 3.0 (Reason Code 10.4)</Text>

      <View style={{ marginTop: 40, paddingHorizontal: 60 }}>
        <Text style={{ fontSize: 11, textAlign: "center", color: "#0B1220" }}>
          {data.cover.headline}
        </Text>
      </View>
    </Page>
  );
}

function EvidencePage({ data }: CE30PackPdfProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.sectionTitle}>Qualification Evidence</Text>
      {renderEvidenceBody(data)}
    </Page>
  );
}

function renderEvidenceBody(data: CE30PackageData): React.ReactNode {
  const e = data.evidence;

  if (e.kind === "auto_qualified") {
    return (
      <View>
        <Text style={{ marginBottom: 12 }}>
          {e.via === "visa_data_only"
            ? "This transaction was processed using Visa Data Only authentication. Per Visa's announcement effective October 17, 2025, transactions authenticated via Visa Data Only are automatically pre-qualified for Compelling Evidence 3.0."
            : e.via === "merchant_confirmed"
              ? "The merchant has confirmed that this transaction was authenticated via 3-D Secure. The dispute is qualified for Visa Compelling Evidence 3.0."
              : "This transaction was authenticated via Visa Secure (3-D Secure 2). Per Visa's announcement effective October 17, 2025, Visa Secure-authenticated transactions are automatically pre-qualified for Compelling Evidence 3.0."}
        </Text>
        {e.feeAppliesFrom && (
          <Text style={{ fontSize: 9, color: "#64748B", marginBottom: 8 }}>
            Note: Visa charges a per-qualification fee on auto-qualified disputes
            from {e.feeAppliesFrom}.
          </Text>
        )}
        <Text>
          The auto-qualification metadata is attached to this dispute at the
          Visa network level. This package is provided for merchant records and
          to support the standard rebuttal evidence.
        </Text>
      </View>
    );
  }

  if (e.kind === "initial_billing") {
    return (
      <View>
        <Text style={{ marginBottom: 12 }}>
          This recurring billing transaction is matched against the initial
          subscription billing transaction, which carries the cardholder&apos;s
          original signup data (IP, device, shipping, account).
        </Text>
        {renderTransactionTable([e.disputedRow, e.initialBillingRow])}
        <Text style={{ marginTop: 12 }}>{e.matchSummary}</Text>
      </View>
    );
  }

  if (e.kind === "standard") {
    return (
      <View>
        <Text style={{ marginBottom: 12 }}>
          The cardholder has at least two prior undisputed transactions with
          this merchant in the 120–365 day window preceding the disputed
          transaction. Matching data points across all three transactions
          establish the cardholder relationship.
        </Text>
        {renderTransactionTable([e.disputedRow, ...e.priorRows])}
        <Text style={{ marginTop: 12 }}>{e.matchSummary}</Text>
      </View>
    );
  }

  // partial
  return (
    <View>
      <Text style={{ marginBottom: 12 }}>
        This dispute partially qualifies for CE 3.0 but is missing one or more
        requirements:
      </Text>
      {e.missingEvidence.map((m) => (
        <Text key={m} style={{ marginBottom: 4 }}>
          • {m}
        </Text>
      ))}
    </View>
  );
}

function renderTransactionTable(rows: TransactionRow[]): React.ReactNode {
  return (
    <View>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingBottom: 4, marginTop: 8 }}>
        <Text style={{ flex: 2, fontFamily: "Helvetica-Bold" }}>Order</Text>
        <Text style={{ flex: 2, fontFamily: "Helvetica-Bold" }}>Date</Text>
        <Text style={{ flex: 2, fontFamily: "Helvetica-Bold" }}>IP</Text>
        <Text style={{ flex: 3, fontFamily: "Helvetica-Bold" }}>Shipping</Text>
        <Text style={{ flex: 2, fontFamily: "Helvetica-Bold" }}>Account</Text>
      </View>
      {rows.map((r) => (
        <View
          key={r.orderId}
          style={{
            flexDirection: "row",
            paddingVertical: 4,
            borderBottomWidth: 0.5,
            borderBottomColor: "#F1F5F9",
          }}
        >
          <Text style={{ flex: 2 }}>
            {r.label}
            {"\n"}#{r.orderId}
          </Text>
          <Text style={{ flex: 2 }}>{formatDate(r.date)}</Text>
          <Text style={{ flex: 2 }}>
            {r.ip ? `${r.matchedPoints.ip ? "✓ " : ""}${r.ip}` : "—"}
          </Text>
          <Text style={{ flex: 3 }}>
            {r.shippingAddress
              ? `${r.matchedPoints.shipping ? "✓ " : ""}${r.shippingAddress}`
              : "—"}
          </Text>
          <Text style={{ flex: 2 }}>
            {r.customerAccount
              ? `${r.matchedPoints.account ? "✓ " : ""}${r.customerAccount}`
              : "—"}
          </Text>
        </View>
      ))}
    </View>
  );
}

function StatementPage({ data }: CE30PackPdfProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.sectionTitle}>Merchant Statement</Text>
      <Text>{data.statement}</Text>
      <Text style={{ marginTop: 30, fontSize: 9, color: "#64748B" }}>
        Generated by DisputeDesk · Template version: {data.templateVersion} ·
        Language: {data.language}
      </Text>
    </Page>
  );
}

export function CE30PackDocument({ data }: CE30PackPdfProps) {
  return (
    <Document>
      <CoverPage data={data} />
      <EvidencePage data={data} />
      <StatementPage data={data} />
    </Document>
  );
}
