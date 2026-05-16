/**
 * Defence Package PDF document — bank-facing representment.
 *
 * Structure (deterministic, in order):
 *   1. Cover page — title, dispute id, key fields
 *   2. Case Details table — dark-header, full case metadata
 *   3. Executive Summary           ⎫
 *   4. Transaction Overview        ⎪
 *   5. Chronology of Events        ⎪
 *   6. Order Line Items            ⎪  Each section opens with a deterministic
 *   7. Product / Service           ⎬  italic thesis blockquote (left-bordered
 *   8. Payment Authentication      ⎪  navy), keyed to reasonCodeModule +
 *   9. Fulfillment / Delivery      ⎪  sectionKey. The LLM-authored body
 *  10. Customer Communication      ⎪  follows underneath. Sections without
 *  11. Policy                      ⎪  facts are omitted entirely (no
 *  12. Manual Evidence             ⎭  placeholder, no padding).
 *  13. Evidence Basis              — deterministic, rendered from approved facts
 *  14. Conclusion                  — LLM body + framed call-out
 *
 * The thesis blockquotes ARE NOT LLM-authored. They are static per
 * (sectionKey × reasonCodeModule × packageMode). That way the visual
 * device the competitor uses — section-level argument summaries — can't
 * drift into overclaim territory.
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
  ReasonCodeModuleKey,
} from "../types";

export interface DefencePackageMeta {
  packageId: string;
  disputeGid: string | null;
  orderName: string | null;
  reasonCode: string | null;
  reasonCodeDisplay: string | null;
  reasonCodeModuleKey?: ReasonCodeModuleKey;
  shopName: string;
  merchantName: string | null;
  amountDisplay: string | null;
  cardNetwork: string | null;
  cardLast4?: string | null;
  paymentGateway?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  cardholderName?: string | null;
  customerEmail?: string | null;
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

function fmtIsoDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 19).replace("T", " ") + " UTC";
  } catch {
    return iso;
  }
}

function disputeIdShort(gid: string | null): string {
  if (!gid) return "—";
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}

/* ── Section thesis templates (deterministic) ─────────────────────────
 * Per (sectionKey × reasonCodeModuleKey × packageMode). These are the
 * italicized blockquotes that open each section. They are NOT
 * LLM-authored — they cannot drift into overclaim territory because
 * they are static. */

type ThesisKey = `${NarrativeSectionKey}:${string}:${PackageMode}`;

const THESIS_LIBRARY: Record<string, string> = {
  // Visa 10.4 / fraud — full mode
  "executiveSummary:visa_10_4_fraud:full":
    "This representment addresses a Visa 10.4 (Other Fraud — Card Absent) chargeback. The approved evidence — payment authentication, billing alignment, and the customer's documented engagement — establishes that the transaction was authorised by the cardholder.",
  "transactionOverviewArgument:visa_10_4_fraud:full":
    "The transaction was successfully authorised and captured using authentication factors specific to the cardholder. The payment record is internally consistent and aligned with cardholder-supplied data.",
  "chronologyArgument:visa_10_4_fraud:full":
    "The timeline of events records a deliberate purchase sequence — site engagement, order placement, successful authorisation, and order confirmation — each step traceable to the cardholder's session.",
  "paymentAuthenticationArgument:visa_10_4_fraud:full":
    "Authentication metrics align with a cardholder-initiated transaction. The verification results reflect data accessible to the legitimate cardholder.",
  "fulfillmentArgument:visa_10_4_fraud:full":
    "Fulfilment and access evidence corroborates that the order was processed and the customer received the agreed delivery or access path.",
  "communicationArgument:visa_10_4_fraud:full":
    "The documented communication record evidences direct cardholder engagement with the merchant before and around the disputed transaction.",
  "policyArgument:visa_10_4_fraud:full":
    "The merchant's published policies and the customer's acceptance record are documented and were available at the point of purchase.",
  "manualEvidenceArgument:visa_10_4_fraud:full":
    "Supplementary documentation provided by the merchant supports the foregoing argument.",
  "conclusion:visa_10_4_fraud:full":
    "Based on the approved evidence above, the merchant respectfully requests that the chargeback be reversed and the funds returned.",

  // Visa 10.4 / fraud — narrow mode (hedged)
  "executiveSummary:visa_10_4_fraud:narrow":
    "The available records support the merchant's position on this Visa 10.4 dispute. The argument below is necessarily narrow — only the documented evidence is cited.",
  "transactionOverviewArgument:visa_10_4_fraud:narrow":
    "The available transaction record indicates a successful authorisation consistent with the cardholder's session.",
  "chronologyArgument:visa_10_4_fraud:narrow":
    "The available timeline of events documents the relevant moments of the customer's interaction with the merchant.",
  "paymentAuthenticationArgument:visa_10_4_fraud:narrow":
    "The available authentication evidence is consistent with a cardholder-initiated transaction.",
  "fulfillmentArgument:visa_10_4_fraud:narrow":
    "The available fulfilment / access records are presented below.",
  "communicationArgument:visa_10_4_fraud:narrow":
    "The available communication evidence is presented below.",
  "policyArgument:visa_10_4_fraud:narrow":
    "The available policy disclosure record is presented below.",
  "manualEvidenceArgument:visa_10_4_fraud:narrow":
    "Supplementary documentation provided by the merchant is summarised below.",
  "conclusion:visa_10_4_fraud:narrow":
    "Based on the available evidence, the merchant respectfully requests review of this chargeback.",
};

const GENERIC_THESIS: Record<NarrativeSectionKey, string> = {
  executiveSummary:
    "This representment addresses the chargeback identified above. The approved evidence supporting the merchant's position is summarised below.",
  transactionOverviewArgument:
    "The transaction record is internally consistent with cardholder-initiated activity.",
  chronologyArgument:
    "The timeline of events records the relevant moments of the customer's interaction with the merchant.",
  paymentAuthenticationArgument:
    "Authentication and payment-record signals are presented below.",
  fulfillmentArgument:
    "Fulfilment, delivery, or access evidence is presented below.",
  communicationArgument:
    "Customer communication on record is presented below.",
  policyArgument:
    "Relevant policy disclosures and acceptance records are presented below.",
  manualEvidenceArgument:
    "Supplementary documentation provided by the merchant supports the foregoing argument.",
  conclusion:
    "Based on the evidence above, the merchant respectfully requests reversal of the chargeback.",
};

function thesisFor(
  sectionKey: NarrativeSectionKey,
  moduleKey: ReasonCodeModuleKey | undefined,
  mode: PackageMode,
): string {
  if (moduleKey) {
    const key: ThesisKey = `${sectionKey}:${moduleKey}:${mode}`;
    if (THESIS_LIBRARY[key]) return THESIS_LIBRARY[key];
  }
  return GENERIC_THESIS[sectionKey];
}

/* ── Section block ─────────────────────────────────────────────────── */

function SectionBlock({
  title,
  thesis,
  section,
  omitted,
}: {
  title: string;
  thesis: string;
  section: NarrativeSection;
  omitted: boolean;
}) {
  if (omitted || !section.text.trim()) return null;
  return (
    <View>
      <Text style={styles.h1}>{title}</Text>
      <View style={styles.thesisBox} wrap={false}>
        <Text style={styles.thesisText}>{thesis}</Text>
      </View>
      <Text style={styles.paragraph}>{section.text}</Text>
    </View>
  );
}

/* ── Cover page ───────────────────────────────────────────────────── */

function Cover({ meta }: { meta: DefencePackageMeta }) {
  const rows: Array<[string, string]> = [
    ["Dispute ID", disputeIdShort(meta.disputeGid)],
    ["Merchant", meta.merchantName ?? meta.shopName],
    ["Card network", meta.cardNetwork ?? "—"],
    ["Card (last 4)", meta.cardLast4 ?? "—"],
    ["Disputed amount", meta.amountDisplay ?? "—"],
    ["Reason code", meta.reasonCodeDisplay ?? meta.reasonCode ?? "—"],
    ["Order", meta.orderName ?? "—"],
    ["Transaction date", fmtIsoDate(meta.transactionDate)],
    ["Payment gateway", meta.paymentGateway ?? "—"],
    ["Generated", fmtIsoDate(meta.generatedAt)],
    ["Package version", `v${meta.version} (${meta.packageMode})`],
  ];
  return (
    <Page size="A4" style={styles.coverPage}>
      <Text style={styles.coverEyebrow}>Chargeback Representment</Text>
      <Text style={styles.coverTitle}>Complete Defence Package</Text>
      <Text style={styles.coverDisputeId}>Dispute {disputeIdShort(meta.disputeGid)}</Text>
      <Text style={styles.coverSubtitle}>
        Prepared for {meta.merchantName ?? meta.shopName}
      </Text>

      <View style={styles.coverDivider} />

      <View style={styles.coverFieldList}>
        {rows.map(([k, v]) => (
          <View key={k} style={styles.coverFieldRow} wrap={false}>
            <Text style={styles.coverFieldLabel}>{k}</Text>
            <Text style={styles.coverFieldValue}>{v}</Text>
          </View>
        ))}
      </View>

      <PageFooter meta={meta} />
    </Page>
  );
}

/* ── Case Details table ───────────────────────────────────────────── */

function CaseDetailsTable({ meta }: { meta: DefencePackageMeta }) {
  const rows: Array<[string, string]> = [
    ["Dispute ID", disputeIdShort(meta.disputeGid)],
    ["Merchant name", meta.merchantName ?? meta.shopName],
    ["Card network", meta.cardNetwork ?? "—"],
    ["Transaction date", fmtIsoDate(meta.transactionDate)],
    ["Disputed amount", meta.amountDisplay ?? "—"],
    ["Reason code", meta.reasonCodeDisplay ?? meta.reasonCode ?? "—"],
    ["Order ID", meta.orderName ?? "—"],
    ["Cardholder name", meta.cardholderName ?? "—"],
    ["Card (last 4)", meta.cardLast4 ?? "—"],
    ["Payment gateway", meta.paymentGateway ?? "—"],
    ["Financial status", meta.financialStatus ?? "—"],
    ["Fulfillment status", meta.fulfillmentStatus ?? "—"],
  ];
  return (
    <View>
      <Text style={styles.h1}>Case Details</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={styles.tableHeaderCell}>Field</Text>
          <Text style={styles.tableHeaderCell}>Detail</Text>
        </View>
        {rows.map(([k, v], i) => (
          <View
            key={k}
            style={i % 2 === 0 ? styles.tableRow : styles.tableRowStripe}
            wrap={false}
          >
            <Text style={styles.tableCellLabel}>{k}</Text>
            <Text style={styles.tableCellValue}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ── Chronology bullets (deterministic, from approved facts) ──────── */

interface ChronologyEvent {
  at: string;
  text: string;
}

function chronologyEvents(
  meta: DefencePackageMeta,
  facts: EvidenceFact[],
): ChronologyEvent[] {
  const events: ChronologyEvent[] = [];
  if (meta.transactionDate) {
    events.push({
      at: meta.transactionDate,
      text: `Order placed on the merchant's storefront${meta.orderName ? ` (${meta.orderName})` : ""}.`,
    });
    events.push({
      at: meta.transactionDate,
      text: `Authorisation captured against the cardholder's ${meta.cardNetwork ?? "card"}${meta.cardLast4 ? ` ending in ${meta.cardLast4}` : ""}.`,
    });
  }
  // Confirmation timestamp would live on a customer_communication fact.
  for (const f of facts) {
    if (f.category === "customer_communication") {
      const at = typeof f.value.lastMessageAt === "string" ? (f.value.lastMessageAt as string) : null;
      if (at) {
        events.push({
          at,
          text: `Customer correspondence with the merchant${f.value.customerConfirmsOrder === true ? " — order receipt confirmed by the customer" : ""}.`,
        });
      }
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

function ChronologyBullets({ events }: { events: ChronologyEvent[] }) {
  if (events.length === 0) return null;
  return (
    <View>
      {events.map((e, i) => (
        <View key={`${e.at}-${i}`} style={styles.bulletRow} wrap={false}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>
            <Text style={styles.bulletTimestamp}>{e.at}</Text>
            {"   "}
            {e.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ── Order line items table (deterministic, from order_record fact) ── */

interface LineItem {
  description: string;
  quantity: number;
  price: string;
}

function lineItemsFromFacts(facts: EvidenceFact[]): LineItem[] {
  for (const f of facts) {
    if (f.category !== "order_record") continue;
    const raw = f.value.lineItems;
    if (!Array.isArray(raw)) continue;
    return raw
      .map((it) => {
        const obj = it as Record<string, unknown>;
        const description = typeof obj.description === "string" ? obj.description : null;
        const quantity = typeof obj.quantity === "number" ? obj.quantity : null;
        const price = typeof obj.price === "string" ? obj.price : null;
        if (!description || quantity == null || !price) return null;
        return { description, quantity, price } as LineItem;
      })
      .filter((it): it is LineItem => it !== null);
  }
  return [];
}

function LineItemsTable({ items }: { items: LineItem[] }) {
  if (items.length === 0) return null;
  return (
    <View>
      <Text style={styles.h1}>Order Line Items</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Description</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Qty</Text>
          <Text style={styles.tableHeaderCellRight}>Price</Text>
        </View>
        {items.map((item, i) => (
          <View
            key={i}
            style={i % 2 === 0 ? styles.tableRow : styles.tableRowStripe}
            wrap={false}
          >
            <Text style={[styles.tableCell, { flex: 3 }]}>{item.description}</Text>
            <Text style={[styles.tableCell, { flex: 1 }]}>{item.quantity}</Text>
            <Text style={styles.tableCellRight}>{item.price}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ── Evidence Basis ──────────────────────────────────────────────── */

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
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderCell}>Signal</Text>
            <Text style={styles.tableHeaderCell}>Detail</Text>
          </View>
          {rows.map((r, i) => (
            <View
              key={r.factId}
              style={i % 2 === 0 ? styles.tableRow : styles.tableRowStripe}
              wrap={false}
            >
              <Text style={styles.tableCellLabel}>{r.label}</Text>
              <Text style={styles.tableCellValue}>{r.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/* ── Supporting Evidence Index ──────────────────────────────────── */

function SupportingEvidenceIndex({
  manualEvidence,
}: {
  manualEvidence: ManualEvidenceRecord[];
}) {
  const included = manualEvidence.filter((m) => m.includeInPackage);
  if (included.length === 0) return null;
  return (
    <View>
      <Text style={styles.h1}>Supporting Evidence Index</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={styles.tableHeaderCell}>Document</Text>
          <Text style={styles.tableHeaderCell}>Type & description</Text>
        </View>
        {included.map((m, i) => (
          <View
            key={m.id}
            style={i % 2 === 0 ? styles.tableRow : styles.tableRowStripe}
            wrap={false}
          >
            <Text style={styles.tableCellLabel}>{m.filename}</Text>
            <Text style={styles.tableCellValue}>
              {m.fileType ?? "—"}
              {m.description ? ` — ${m.description}` : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ── Footer ──────────────────────────────────────────────────────── */

function PageFooter({ meta }: { meta: DefencePackageMeta }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerLeft}>
        Defence Package v{meta.version} • {meta.packageMode} • prompt v{meta.promptVersion}
      </Text>
      <Text
        style={styles.footerRight}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

/* ── Conclusion call-out ─────────────────────────────────────────── */

function ConclusionBlock({
  thesis,
  section,
  omitted,
}: {
  thesis: string;
  section: NarrativeSection;
  omitted: boolean;
}) {
  if (omitted || !section.text.trim()) return null;
  return (
    <View>
      <Text style={styles.h1}>Conclusion</Text>
      <View style={styles.thesisBox} wrap={false}>
        <Text style={styles.thesisText}>{thesis}</Text>
      </View>
      <View style={styles.conclusionBox}>
        <Text style={styles.paragraphLast}>{section.text}</Text>
      </View>
    </View>
  );
}

/* ── Main ────────────────────────────────────────────────────────── */

export function DefencePackageDocument({
  data,
}: {
  data: DefencePackageDocumentData;
}) {
  const { meta, narrative, approvedFacts, manualEvidence } = data;
  const omitted = omittedSet(narrative);
  const moduleKey = meta.reasonCodeModuleKey;
  const mode = meta.packageMode;
  const t = (k: NarrativeSectionKey) => thesisFor(k, moduleKey, mode);

  const chronology = chronologyEvents(meta, approvedFacts);
  const lineItems = lineItemsFromFacts(approvedFacts);

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
          thesis={t("executiveSummary")}
          section={narrative.executiveSummary}
          omitted={omitted.has("executiveSummary")}
        />

        <SectionBlock
          title="Transaction Overview"
          thesis={t("transactionOverviewArgument")}
          section={narrative.transactionOverviewArgument}
          omitted={omitted.has("transactionOverviewArgument")}
        />

        {!omitted.has("chronologyArgument") && narrative.chronologyArgument.text.trim() && (
          <View>
            <Text style={styles.h1}>Chronology of Events</Text>
            <View style={styles.thesisBox} wrap={false}>
              <Text style={styles.thesisText}>{t("chronologyArgument")}</Text>
            </View>
            <Text style={styles.paragraph}>{narrative.chronologyArgument.text}</Text>
            <ChronologyBullets events={chronology} />
          </View>
        )}

        <LineItemsTable items={lineItems} />

        <SectionBlock
          title="Payment Authentication"
          thesis={t("paymentAuthenticationArgument")}
          section={narrative.paymentAuthenticationArgument}
          omitted={omitted.has("paymentAuthenticationArgument")}
        />

        <SectionBlock
          title="Fulfillment, Delivery & Access"
          thesis={t("fulfillmentArgument")}
          section={narrative.fulfillmentArgument}
          omitted={omitted.has("fulfillmentArgument")}
        />

        <SectionBlock
          title="Customer Communication"
          thesis={t("communicationArgument")}
          section={narrative.communicationArgument}
          omitted={omitted.has("communicationArgument")}
        />

        <SectionBlock
          title="Policy Disclosure"
          thesis={t("policyArgument")}
          section={narrative.policyArgument}
          omitted={omitted.has("policyArgument")}
        />

        <SectionBlock
          title="Supplementary Merchant Evidence"
          thesis={t("manualEvidenceArgument")}
          section={narrative.manualEvidenceArgument}
          omitted={omitted.has("manualEvidenceArgument")}
        />

        <EvidenceBasis approvedFacts={approvedFacts} />

        <ConclusionBlock
          thesis={t("conclusion")}
          section={narrative.conclusion}
          omitted={omitted.has("conclusion")}
        />

        <SupportingEvidenceIndex manualEvidence={manualEvidence} />

        <PageFooter meta={meta} />
      </Page>
    </Document>
  );
}
