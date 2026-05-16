/**
 * Defence Package PDF document.
 *
 * Deterministic 15-section layout. LLM owns prose only; this component
 * decides the structure, ordering, and which deterministic facts get
 * rendered as the Evidence Basis section.
 *
 * Sections honour `narrative.omittedSections[]` — omitted sections render
 * nothing (no placeholder, no "TBD"). Cover and Evidence Basis always
 * render; Conclusion is required for a final package.
 */

import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import { buildEvidenceBasisRows } from "./evidenceBasisRows";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  ManualEvidenceRecord,
  NarrativeSection,
  NarrativeSectionKey,
  PackageMode,
} from "../types";

export interface DefencePackageMeta {
  packageId: string;
  disputeGid: string | null;
  orderName: string | null;
  reasonCode: string | null;
  reasonCodeDisplay: string | null;
  shopName: string;
  merchantName: string | null;
  amountDisplay: string | null;
  cardNetwork: string | null;
  transactionDate: string | null;
  generatedAt: string;
  version: number;
  packageMode: PackageMode;
  promptVersion: number;
  modelUsed: string;
}

export interface DefencePackageDocumentData {
  meta: DefencePackageMeta;
  narrative: DefenceNarrativeOutput;
  approvedFacts: EvidenceFact[];
  manualEvidence: ManualEvidenceRecord[];
}

/* ── Helpers ── */

function omittedSet(narrative: DefenceNarrativeOutput): Set<NarrativeSectionKey> {
  return new Set(narrative.omittedSections.map((o) => o.sectionKey));
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ── Cover ── */

function Cover({ meta }: { meta: DefencePackageMeta }) {
  return (
    <Page size="A4" style={styles.coverPage}>
      <Text style={styles.coverEyebrow}>Chargeback Representment</Text>
      <Text style={styles.coverTitle}>Complete Defence Package</Text>
      <Text style={styles.coverSubtitle}>
        Prepared for {meta.shopName} • v{meta.version} • {meta.packageMode === "narrow" ? "Narrow" : "Full"} package
      </Text>

      <View style={styles.coverGrid}>
        <CoverRow label="Dispute ID" value={meta.disputeGid?.split("/").pop() ?? "—"} />
        <CoverRow label="Order" value={meta.orderName ?? "—"} />
        <CoverRow label="Merchant" value={meta.merchantName ?? meta.shopName} />
        <CoverRow label="Reason code" value={meta.reasonCodeDisplay ?? meta.reasonCode ?? "—"} />
        <CoverRow label="Card network" value={meta.cardNetwork ?? "—"} />
        <CoverRow label="Disputed amount" value={meta.amountDisplay ?? "—"} />
        <CoverRow label="Transaction date" value={fmtDateTime(meta.transactionDate)} />
        <CoverRow label="Generated" value={fmtDateTime(meta.generatedAt)} />
        <CoverRow label="Package version" value={`v${meta.version}`} />
      </View>

      <View style={[styles.noticeBox, { marginTop: 24 }]}>
        <Text style={styles.noticeText}>
          This document was prepared from approved evidence on file. Each
          argument paragraph is traceable to one or more approved facts listed
          in the Evidence Basis section.
        </Text>
      </View>

      <PageFooter meta={meta} />
    </Page>
  );
}

function CoverRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.coverGridRow} wrap={false}>
      <Text style={styles.coverGridLabel}>{label}</Text>
      <Text style={styles.coverGridValue}>{value}</Text>
    </View>
  );
}

/* ── Body sections ── */

function SectionBlock({
  title,
  section,
  omitted,
}: {
  title: string;
  section: NarrativeSection;
  omitted: boolean;
}) {
  if (omitted || !section.text.trim()) return null;
  return (
    <View wrap={false}>
      <Text style={styles.h1}>{title}</Text>
      <Text style={styles.paragraph}>{section.text}</Text>
    </View>
  );
}

function CaseDetailsTable({ meta }: { meta: DefencePackageMeta }) {
  const rows: Array<[string, string]> = [
    ["Dispute ID", meta.disputeGid?.split("/").pop() ?? "—"],
    ["Merchant", meta.merchantName ?? meta.shopName],
    ["Card network", meta.cardNetwork ?? "—"],
    ["Transaction date", fmtDateTime(meta.transactionDate)],
    ["Disputed amount", meta.amountDisplay ?? "—"],
    ["Reason code", meta.reasonCodeDisplay ?? meta.reasonCode ?? "—"],
    ["Order", meta.orderName ?? "—"],
  ];
  return (
    <View>
      <Text style={styles.h1}>Case Details</Text>
      <View style={styles.table}>
        {rows.map(([k, v]) => (
          <View key={k} style={styles.tableRow} wrap={false}>
            <Text style={styles.tableCellBold}>{k}</Text>
            <Text style={styles.tableCellRight}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function EvidenceBasis({ approvedFacts }: { approvedFacts: EvidenceFact[] }) {
  const rows = buildEvidenceBasisRows(approvedFacts);
  return (
    <View>
      <Text style={styles.h1}>Evidence Basis</Text>
      <Text style={styles.mutedNote}>
        Facts used to ground the arguments above. Rendered directly from
        approved evidence — not from generated text.
      </Text>
      {rows.length === 0 ? (
        <Text style={styles.paragraph}>(No bank-eligible facts available.)</Text>
      ) : (
        <View style={styles.table}>
          {rows.map((r) => (
            <View key={r.factId} style={styles.tableRow} wrap={false}>
              <Text style={styles.tableCellBold}>{r.label}</Text>
              <Text style={styles.tableCellRight}>{r.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function SupportingEvidenceIndex({ manualEvidence }: { manualEvidence: ManualEvidenceRecord[] }) {
  const included = manualEvidence.filter((m) => m.includeInPackage);
  if (included.length === 0) return null;
  return (
    <View>
      <Text style={styles.h1}>Supporting Evidence Index</Text>
      <View style={styles.table}>
        {included.map((m) => (
          <View key={m.id} style={styles.tableRow} wrap={false}>
            <Text style={styles.tableCellBold}>{m.filename}</Text>
            <Text style={styles.tableCellRight}>
              {m.fileType ?? "—"}
              {m.bankEligible ? " • Bank-eligible" : ""}
              {m.description ? ` — ${m.description}` : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ── Footer ── */

function PageFooter({ meta }: { meta: DefencePackageMeta }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerLeft}>
        Defence Package v{meta.version} • {meta.packageMode} • prompt v{meta.promptVersion}
      </Text>
      <Text
        style={styles.footerRight}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} / ${totalPages}`
        }
      />
    </View>
  );
}

/* ── Main ── */

export function DefencePackageDocument({ data }: { data: DefencePackageDocumentData }) {
  const { meta, narrative, approvedFacts, manualEvidence } = data;
  const omitted = omittedSet(narrative);

  return (
    <Document
      author="DisputeDesk"
      subject="Chargeback Representment — Complete Defence Package"
      creator="DisputeDesk Grounded Defence Package Builder"
    >
      <Cover meta={meta} />

      <Page size="A4" style={styles.page}>
        <CaseDetailsTable meta={meta} />

        <SectionBlock
          title="Executive Summary"
          section={narrative.executiveSummary}
          omitted={omitted.has("executiveSummary")}
        />

        <SectionBlock
          title="Transaction Overview"
          section={narrative.transactionOverviewArgument}
          omitted={omitted.has("transactionOverviewArgument")}
        />

        <SectionBlock
          title="Chronology of Events"
          section={narrative.chronologyArgument}
          omitted={omitted.has("chronologyArgument")}
        />

        <SectionBlock
          title="Payment Authentication and Risk Analysis"
          section={narrative.paymentAuthenticationArgument}
          omitted={omitted.has("paymentAuthenticationArgument")}
        />

        <SectionBlock
          title="Fulfillment, Delivery and Access Evidence"
          section={narrative.fulfillmentArgument}
          omitted={omitted.has("fulfillmentArgument")}
        />

        <SectionBlock
          title="Customer Communication Evidence"
          section={narrative.communicationArgument}
          omitted={omitted.has("communicationArgument")}
        />

        <SectionBlock
          title="Policy Evidence"
          section={narrative.policyArgument}
          omitted={omitted.has("policyArgument")}
        />

        <SectionBlock
          title="Manual Merchant Evidence"
          section={narrative.manualEvidenceArgument}
          omitted={omitted.has("manualEvidenceArgument")}
        />

        <EvidenceBasis approvedFacts={approvedFacts} />

        <SectionBlock
          title="Conclusion / Requested Outcome"
          section={narrative.conclusion}
          omitted={omitted.has("conclusion")}
        />

        <SupportingEvidenceIndex manualEvidence={manualEvidence} />

        <PageFooter meta={meta} />
      </Page>
    </Document>
  );
}
