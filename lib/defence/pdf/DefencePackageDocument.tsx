/**
 * Defence Package PDF document — bank-facing representment.
 *
 * Structure (deterministic, in order):
 *   1. Cover page — title, dispute id, key fields
 *   2. Case Details table — dark-header, full case metadata
 *   3. Composed argumentative sections (Executive Summary, Transaction
 *      Overview, Chronology of Events, Order Line Items, Payment
 *      Authentication, Fulfillment, Customer Communication, Policy,
 *      Manual Evidence, Conclusion).
 *   4. Evidence Basis — deterministic, rendered from approved facts
 *   5. Supporting Evidence Index — when manual evidence is present
 *
 * Phase 4 (2026-05-16): thesis blockquotes come from
 * fact-templated `ComposedDocumentBlock[]`. The renderer is
 * presentational over those blocks — it never composes prose. All
 * argumentative bytes pass through `validateComposedDocument` before
 * this component renders. Section ordering, chronology bullets,
 * evidence basis, and the supporting-evidence index remain
 * deterministic and read from `meta` + `approvedFacts` + `manualEvidence`.
 */

import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import { buildEvidenceBasisRows } from "./evidenceBasisRows";
import type {
  ComposedDocumentBlock,
  EvidenceFact,
  ManualEvidenceRecord,
  NarrativeSectionKey,
  PackageMode,
  ReasonCodeModuleKey,
} from "../types";

export interface DefencePackageMeta {
  packageId: string;
  disputeGid: string | null;
  orderName: string | null;
  reasonCode: string | null;
  /** Bank-facing network reference label, e.g. "Visa 10.4 / Mastercard
   *  4837". The reason-code identifier with no product/claim noun. */
  reasonCodeDisplay: string | null;
  /** Merchant-facing claim category label, e.g. "Unauthorized
   *  transaction claim". Distinct from `reasonCodeDisplay`; describes
   *  what the cardholder is alleging in the merchant's own words.
   *  v2.2+. */
  claimType?: string | null;
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
  /** Full event timeline from the access_log pack section. When present,
   *  the renderer uses it directly to build chronology bullets; when
   *  null/empty, falls back to the synthetic 2-event path derived from
   *  meta.transactionDate. */
  timelineEvents?: Array<{ at: string; text: string }>;
  /** Line items extracted from `pack_json.sections[type=order].data.lineItems`
   *  by `deriveOrderContext`. */
  lineItemsFromContext?: Array<{ description: string; quantity: number; price: string }>;
  generatedAt: string;
  version: number;
  packageMode: PackageMode;
  promptFamily?: string;
  promptVersion: number;
  modelUsed: string;
  /** Truncated to 10–12 chars in the Package Metadata block. */
  evidenceHash?: string | null;
  generatedBy?: "system" | "merchant" | "admin";
}

export interface DefencePackageDocumentData {
  meta: DefencePackageMeta;
  /** Phase 4+: pre-validated argumentative prose. The renderer is
   *  PRESENTATIONAL over these blocks — it never composes prose. */
  composedBlocks: ComposedDocumentBlock[];
  approvedFacts: EvidenceFact[];
  manualEvidence: ManualEvidenceRecord[];
}

/* ── Helpers ── */

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

function findBlock(
  blocks: ComposedDocumentBlock[],
  sectionKey: NarrativeSectionKey,
): ComposedDocumentBlock | null {
  return blocks.find((b) => b.sectionKey === sectionKey) ?? null;
}

/* ── Section block (presentational) ─────────────────────────────────
 * Renders H1 + (thesis blockquote if non-empty) + body (llmText or
 * fallbackText). Caller decides whether to wrap in a special
 * container (e.g. conclusion's call-out box). When `block` is null
 * the section is dropped entirely. */
function SectionBlock({
  block,
}: {
  block: ComposedDocumentBlock | null;
}) {
  if (!block) return null;
  const body = block.llmText.trim() || block.fallbackText.trim();
  if (!body) return null;
  const thesis = block.thesisText.trim();
  return (
    <View minPresenceAhead={80}>
      <View wrap={false}>
        <Text style={styles.h1}>{block.heading}</Text>
        {thesis ? (
          <View style={styles.thesisBox}>
            <Text style={styles.thesisText}>{thesis}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.paragraph}>{body}</Text>
    </View>
  );
}

/* ── Cover page ───────────────────────────────────────────────────── */

function Cover({ meta }: { meta: DefencePackageMeta }) {
  return (
    <Page size="A4" style={styles.coverPage}>
      <Text style={styles.coverEyebrow}>Chargeback Representment</Text>
      <Text style={styles.coverTitle}>Complete Defence Package</Text>
      <Text style={styles.coverDisputeId}>Dispute {disputeIdShort(meta.disputeGid)}</Text>
      <Text style={styles.coverSubtitle}>
        Prepared for {meta.merchantName ?? meta.shopName}
      </Text>
      <Text style={styles.coverSubtitle}>
        {[meta.reasonCodeDisplay, meta.claimType].filter(Boolean).join(" — ") || meta.reasonCode || "—"} • {meta.amountDisplay ?? "—"} • v{meta.version} ({meta.packageMode})
      </Text>
      <Text style={styles.coverSubtitle}>
        Generated {fmtIsoDate(meta.generatedAt)}
      </Text>
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
    ["Claim type", meta.claimType ?? "—"],
    ["Order ID", meta.orderName ?? "—"],
    ["Cardholder name", meta.cardholderName ?? "—"],
    ["Card (last 4)", meta.cardLast4 ?? "—"],
    ["Payment gateway", meta.paymentGateway ?? "—"],
    ["Financial status", meta.financialStatus ?? "—"],
    ["Fulfillment status", meta.fulfillmentStatus ?? "—"],
  ];
  return (
    <View minPresenceAhead={120}>
      <Text style={styles.h1}>Case Details</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader} wrap={false}>
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

/* ── Chronology bullets (deterministic, from meta) ──────────────────── */

interface ChronologyEvent {
  at: string;
  text: string;
}

function chronologyEvents(
  meta: DefencePackageMeta,
  facts: EvidenceFact[],
): ChronologyEvent[] {
  if (Array.isArray(meta.timelineEvents) && meta.timelineEvents.length > 0) {
    return [...meta.timelineEvents].sort((a, b) => a.at.localeCompare(b.at));
  }
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

/* ── Order line items table ──────────────────────────────────────── */

interface LineItem {
  description: string;
  quantity: number;
  price: string;
}

function lineItemsFromFacts(facts: EvidenceFact[], meta: DefencePackageMeta): LineItem[] {
  if (Array.isArray(meta.lineItemsFromContext) && meta.lineItemsFromContext.length > 0) {
    return meta.lineItemsFromContext;
  }
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
    <View minPresenceAhead={100}>
      <Text style={styles.h1}>Order Line Items</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader} wrap={false}>
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
  if (rows.length === 0) return null;
  return (
    <View minPresenceAhead={120}>
      <Text style={styles.h1}>Evidence Basis</Text>
      <Text style={styles.mutedNote}>
        Approved bank-facing facts used to ground this package.
      </Text>
      <View style={styles.table}>
        <View style={styles.tableHeader} wrap={false}>
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
    </View>
  );
}

/* ── Supporting Evidence Index ──────────────────────────────────── */

function inclusionLabel(m: ManualEvidenceRecord): string {
  if (m.includeInBankNarrative && m.includeInPackage) return "Narrative + appendix";
  if (m.includeInBankNarrative) return "Narrative";
  if (m.includeInPackage) return "Appendix";
  return "Not included";
}

function SupportingEvidenceIndex({
  manualEvidence,
}: {
  manualEvidence: ManualEvidenceRecord[];
}) {
  const included = manualEvidence.filter((m) => m.includeInPackage);
  if (included.length === 0) return null;
  return (
    <View minPresenceAhead={100}>
      <Text style={styles.h1}>Supporting Evidence Index</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader} wrap={false}>
          <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Document</Text>
          <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Type &amp; description</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.4 }]}>Inclusion</Text>
        </View>
        {included.map((m, i) => (
          <View
            key={m.id}
            style={i % 2 === 0 ? styles.tableRow : styles.tableRowStripe}
            wrap={false}
          >
            <Text style={[styles.tableCellLabel, { flex: 2 }]}>{m.filename}</Text>
            <Text style={[styles.tableCellValue, { flex: 3 }]}>
              {m.fileType ?? "—"}
              {m.description ? ` — ${m.description}` : ""}
            </Text>
            <Text style={[styles.tableCellValue, { flex: 1.4 }]}>
              {inclusionLabel(m)}
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

function ConclusionBlock({ block }: { block: ComposedDocumentBlock | null }) {
  if (!block) return null;
  const body = block.llmText.trim() || block.fallbackText.trim();
  if (!body) return null;
  const thesis = block.thesisText.trim();
  return (
    <View minPresenceAhead={100}>
      <Text style={styles.h1}>{block.heading}</Text>
      {thesis ? (
        <View style={styles.thesisBox}>
          <Text style={styles.thesisText}>{thesis}</Text>
        </View>
      ) : null}
      <View style={styles.conclusionBox}>
        <Text style={styles.paragraphLast}>{body}</Text>
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
  const { meta, composedBlocks, approvedFacts, manualEvidence } = data;
  const chronology = chronologyEvents(meta, approvedFacts);
  const lineItems = lineItemsFromFacts(approvedFacts, meta);
  const chronologyBlock = findBlock(composedBlocks, "chronologyArgument");

  return (
    <Document
      author="DisputeDesk"
      subject="Chargeback Representment — Complete Defence Package"
      creator="DisputeDesk Grounded Defence Package Builder"
    >
      <Cover meta={meta} />

      <Page size="A4" style={styles.page}>
        <CaseDetailsTable meta={meta} />

        <SectionBlock block={findBlock(composedBlocks, "executiveSummary")} />
        <SectionBlock block={findBlock(composedBlocks, "transactionOverviewArgument")} />

        {/* Chronology: thesis + LLM prose + deterministic bullets. The
            bullets come from meta — they aren't argumentative prose
            and don't pass through composedBlocks. */}
        {chronology.length > 0 || (chronologyBlock && (chronologyBlock.llmText.trim() || chronologyBlock.fallbackText.trim())) ? (
          <View minPresenceAhead={100}>
            <View wrap={false}>
              <Text style={styles.h1}>Chronology of Events</Text>
              {chronologyBlock && chronologyBlock.thesisText.trim() ? (
                <View style={styles.thesisBox}>
                  <Text style={styles.thesisText}>
                    {chronologyBlock.thesisText.trim()}
                  </Text>
                </View>
              ) : null}
            </View>
            {chronologyBlock && (chronologyBlock.llmText.trim() || chronologyBlock.fallbackText.trim()) ? (
              <Text style={styles.paragraph}>
                {chronologyBlock.llmText.trim() || chronologyBlock.fallbackText.trim()}
              </Text>
            ) : null}
            <ChronologyBullets events={chronology} />
          </View>
        ) : null}

        <LineItemsTable items={lineItems} />

        <SectionBlock block={findBlock(composedBlocks, "paymentAuthenticationArgument")} />
        <SectionBlock block={findBlock(composedBlocks, "fulfillmentArgument")} />
        <SectionBlock block={findBlock(composedBlocks, "communicationArgument")} />
        <SectionBlock block={findBlock(composedBlocks, "policyArgument")} />

        <EvidenceBasis approvedFacts={approvedFacts} />

        <SectionBlock block={findBlock(composedBlocks, "manualEvidenceArgument")} />

        <SupportingEvidenceIndex manualEvidence={manualEvidence} />

        <ConclusionBlock block={findBlock(composedBlocks, "conclusion")} />

        <PageFooter meta={meta} />
      </Page>
    </Document>
  );
}
