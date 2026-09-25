/**
 * Defence Package PDF document — bank-facing representment.
 *
 * Built to the Claude Design file "Chargeback Response v2" (2026-09-24), US
 * Letter, Inter. Structure, in order:
 *   1. Page 1, the case — top bar, eyebrow + timestamp, dispute title,
 *      subtitle, "Submitted on behalf of", three fact cards, Case Details.
 *   2. From page 2, numbered sections: Executive Summary, any other prose
 *      sections, Fulfillment (shipment cards on a multi-parcel order, prose
 *      otherwise), Evidence Basis (single-parcel / other claims), Supporting
 *      Evidence, Order Line Items (with total), Chronology of Events
 *      (vertical timeline), Conclusion (panel).
 *   3. Running header on pages 2+, footer with "n / N" on every page.
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
import { Document, Font, Link, Page, Text, View } from "@react-pdf/renderer";
import { COLORS, styles } from "./styles";
import { buildEvidenceBasisRows } from "./evidenceBasisRows";
import { isBankIncludedManualEvidence } from "../bankInclusion";
import { buildChronologyEvents, type ChronologyEvent } from "../chronology";
import { buildCaseDetailsRows } from "../render/caseDetails";
import { buildLineItems, type LineItem } from "../render/lineItems";
import { formatMoneyDisplay, reasonCodeForNetwork } from "../render/formatting";
// The derived content (shipment cards, timeline titles, totals, emphasis) is
// shared with the in-app preview, so the two cannot drift.
import {
  dateParts,
  deliveryFactIds,
  describeChronologyEvent,
  emphasisSegments,
  lineItemsTotal,
  orderPlacedLine,
  addressCard,
  laterOrderCard,
  productsOf,
  shipmentCards,
  shipmentsOf,
  singleShipmentOf,
  statusPillTone,
  type PillTone,
  type ShipmentCard as ShipmentCardModel,
} from "../render/documentModel";
import type {
  AddressExhibit,
  LaterOrderExhibit,
  ComposedDocumentBlock,
  EvidenceFact,
  ManualEvidenceRecord,
  NarrativeSectionKey,
  PackageMode,
  ReasonCodeFamilyKey,
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
  /** Reason-code family key (e.g. "unauthorized_fraud"). Drives the
   *  Case Details row deny list — fraud-family disputes don't render
   *  the Fulfillment status row on the bank-facing cover table because
   *  surfacing UNFULFILLED there weakens the authentication argument.
   *  See `lib/defence/render/caseDetails.ts`. */
  reasonCodeFamilyKey?: ReasonCodeFamilyKey | null;
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
  lineItemsFromContext?: Array<{ description: string; quantity: number; price: string; kind?: "item" | "adjustment" }>;
  /** Counsel v2: shipping and billing addresses, printed only when the letter
   *  claims they are identical (DefenceNarrativeOutput.addressExhibit). */
  addressExhibit?: AddressExhibit | null;
  /** Counsel v2: the customer's later order (DefenceNarrativeOutput.laterOrderExhibit). */
  laterOrderExhibit?: LaterOrderExhibit | null;
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
  /**
   * CANONICAL ROUTE (CP-B, PR 2). Set by `buildDefencePackageJob` when the
   * document is a projection of a `CaseArgumentPlan`.
   *
   * Two things change in the Supporting Evidence Index, and both are F3:
   *
   *   1. The index is selected on BANK ELIGIBILITY, not on `includeInPackage`.
   *      `includeInPackage` is a merchant/ops routing decision about where a
   *      document belongs in OUR product — it has never been a statement that
   *      the issuer may see the document, and using it as one is how a
   *      merchant-only upload reaches an issuer.
   *   2. The "Inclusion" column is not rendered. Its values — "Narrative +
   *      appendix", "Appendix" — are internal routing metadata. Printing them
   *      tells the issuer which of our own documents we chose to argue from
   *      versus merely attach, which is an invitation to ask what else there
   *      was and why it was not argued.
   *
   * Absent/false keeps the shipped rendering exactly, so the legacy path is
   * byte-identical while the switch is off.
   */
  issuerSafeSupportingIndex?: boolean;
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

// No automatic hyphenation: it split an email address ("rahma_khan1991@ya-
// hoo.com") and "charge-back" across lines.
Font.registerHyphenationCallback((word) => [word]);

/* ── Small formatters ─────────────────────────────────────────────── */

function blockBody(block: ComposedDocumentBlock | null): string {
  return block ? block.llmText.trim() || block.fallbackText.trim() : "";
}

/* ── Pills ────────────────────────────────────────────────────────── */

function Pill({ tone, label }: { tone: PillTone; label: string }) {
  const c =
    tone === "green"
      ? { bg: COLORS.greenBg, border: COLORS.greenBorder, text: COLORS.greenText }
      : tone === "blue"
        ? { bg: COLORS.blueBg, border: COLORS.blueBorder, text: COLORS.blueText }
        : { bg: COLORS.greyBg, border: COLORS.greyBorder, text: COLORS.greyText };
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.pillText, { color: c.text }]}>{label}</Text>
    </View>
  );
}


/* ── Running header / footer ──────────────────────────────────────── */

function caseRef(meta: DefencePackageMeta): string {
  return [`Dispute ${disputeIdShort(meta.disputeGid)}`, meta.orderName ? `Order ${meta.orderName}` : null]
    .filter(Boolean)
    .join(" · ");
}

/* The footer once printed internal build metadata ("prompt v26") and never
 * drew; it now carries the case reference and "n / N". */
function Footer({ meta }: { meta: DefencePackageMeta }) {
  return (
    // A render-prop on the fixed VIEW (the running header's pattern). A
    // render-prop Text nested inside a fixed View did not draw in this
    // document — the whole footer vanished (local harness, 2026-09-24).
    <View
      style={styles.footerSlot}
      fixed
      render={(props) => {
        const { pageNumber, totalPages } = props as { pageNumber: number; totalPages?: number };
        return (
          <View style={styles.footer}>
            <Text style={styles.footerLeft}>{caseRef(meta)}</Text>
            <Text style={styles.footerRight}>
              {totalPages ? `${pageNumber} / ${totalPages}` : String(pageNumber)}
            </Text>
          </View>
        );
      }}
    />
  );
}

function RunningHeader({ meta }: { meta: DefencePackageMeta }) {
  return (
    <View
      style={styles.runningHeaderSlot}
      fixed
      render={({ pageNumber }) =>
        // Pages 2+ only; the border belongs to the rendered row so page 1
        // shows no stray rule.
        pageNumber === 1 ? null : (
          <View style={styles.runningHeader}>
            <Text style={styles.runningLeft}>Chargeback response</Text>
            <Text style={styles.runningRight}>{caseRef(meta)}</Text>
          </View>
        )
      }
    />
  );
}

/* ── Section frame: "01  Executive Summary" ─────────────────────────── */

function Section({
  number,
  title,
  thesis,
  keepTogether = false,
  breakBefore = false,
  children,
}: {
  number: string;
  title: string;
  thesis?: string;
  keepTogether?: boolean;
  breakBefore?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section} wrap={!keepTogether} break={breakBefore}>
      <View wrap={false} minPresenceAhead={60}>
        <View style={styles.sectionHead}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{number}</Text>
          </View>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {thesis ? (
          <View style={styles.thesis}>
            <Text style={styles.thesisText}>{thesis}</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Prose with the order's product names set in bold (the design's executive
 *  summary). Paragraphs split on blank lines and stay whole across pages. */
function Prose({ text, emphasise = [] }: { text: string; emphasise?: string[] }) {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <Text key={i} style={styles.paragraph} wrap={p.length > 900}>
          {emphasisSegments(p, emphasise).map((seg, j) =>
            seg.strong ? (
              <Text key={j} style={styles.strong}>
                {seg.text}
              </Text>
            ) : (
              seg.text
            ),
          )}
        </Text>
      ))}
    </>
  );
}

/* ── Page 1 ───────────────────────────────────────────────────────── */

function FirstPage({ meta }: { meta: DefencePackageMeta }) {
  const reason = reasonCodeForNetwork(meta.reasonCodeDisplay, meta.cardNetwork) ?? meta.reasonCode ?? "—";
  const amount = formatMoneyDisplay(meta.amountDisplay);
  const merchant = meta.merchantName ?? meta.shopName;
  // Row builder is shared with the embedded HTML view via
  // `lib/defence/render/caseDetails.ts` — same fields, same order, same "—".
  const rows = buildCaseDetailsRows({
    disputeIdShort: disputeIdShort(meta.disputeGid),
    merchantName: merchant,
    cardNetwork: meta.cardNetwork,
    transactionDateDisplay: fmtIsoDate(meta.transactionDate),
    amountDisplay: meta.amountDisplay,
    reasonCodeDisplay: meta.reasonCodeDisplay ?? meta.reasonCode,
    claimType: meta.claimType,
    orderName: meta.orderName,
    cardholderName: meta.cardholderName,
    cardLast4: meta.cardLast4,
    paymentGateway: meta.paymentGateway,
    financialStatus: meta.financialStatus,
    fulfillmentStatus: meta.fulfillmentStatus,
    // unauthorized_fraud disputes drop the Fulfillment status row so an
    // UNFULFILLED value cannot undermine the authentication argument.
    familyKey: meta.reasonCodeFamilyKey ?? null,
  });
  const subtitle = [
    meta.orderName ? `Order ${meta.orderName}` : null,
    [reason, meta.claimType].filter(Boolean).join(" — ") || null,
    amount,
  ]
    .filter(Boolean)
    .join(" · ");
  const cards: Array<[string, string]> = [
    ["Disputed amount", amount ?? "—"],
    ["Reason code", reason],
    ["Claim type", meta.claimType ? meta.claimType.replace(/\s+claim$/i, "") : "—"],
  ];
  return (
    <View>
      <View style={styles.metaRow}>
        <Text style={styles.eyebrow}>Chargeback response</Text>
        <Text style={styles.metaRight}>{fmtIsoDate(meta.generatedAt)}</Text>
      </View>
      <Text style={styles.title}>Dispute {disputeIdShort(meta.disputeGid)}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <Text style={styles.onBehalf}>
        Submitted on behalf of <Text style={styles.onBehalfName}>{merchant}</Text>
      </Text>

      <View style={styles.cards}>
        {cards.map(([label, value], i) => (
          <React.Fragment key={label}>
            {i > 0 ? <View style={styles.cardGap} /> : null}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{label}</Text>
              <Text style={styles.cardValue}>{value}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      <Text style={styles.plainHeading}>Case Details</Text>
      <View style={styles.thRow}>
        <Text style={[styles.th, { width: "38%" }]}>Field</Text>
        <Text style={[styles.th, { flex: 1 }]}>Detail</Text>
      </View>
      {rows.map(([k, v], i) => {
        const pill = (k === "Financial status" || k === "Fulfillment status") && v !== "—";
        return (
          <View key={k} style={i % 2 === 0 ? styles.trZebra : styles.tr} wrap={false}>
            <Text style={[styles.tdLabel, { width: "38%" }]}>{k}</Text>
            <View style={{ flex: 1 }}>
              {pill ? (
                <Pill tone={statusPillTone(v)} label={v} />
              ) : (
                <Text style={styles.td}>{v}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ── Shipment cards (multi-parcel letters) ─────────────────────────── */

function ShipmentCard({ card, wide = false }: { card: ShipmentCardModel; wide?: boolean }) {
  return (
    <View style={styles.shipCard} wrap={false}>
      <View style={styles.shipHead}>
        <View style={styles.shipHeadRow}>
          <Text style={styles.shipLabel}>{card.eyebrow ?? `Shipment ${card.index}`}</Text>
          <Pill tone={card.status.tone} label={card.status.label} />
        </View>
        <Text style={styles.shipProduct}>{card.product}</Text>
      </View>
      <View style={wide ? styles.shipBodyWide : styles.shipBody}>
        {card.fields.map((f, i) => (
          <View
            key={f.label}
            style={
              wide
                ? i === card.fields.length - 1
                  ? styles.shipFieldWideLast
                  : styles.shipFieldWide
                : i === card.fields.length - 1
                  ? styles.shipFieldLast
                  : styles.shipField
            }
          >
            <Text style={styles.shipFieldLabel}>{f.label}</Text>
            <Text style={styles.shipFieldValue}>
              {f.value}
              {f.reference ? (
                <>
                  {" · "}
                  {f.reference.url ? (
                    <Link src={f.reference.url} style={styles.link}>
                      {f.reference.text}
                    </Link>
                  ) : (
                    f.reference.text
                  )}
                </>
              ) : null}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ShipmentCards({ cards }: { cards: ShipmentCardModel[] }) {
  const rows: ShipmentCardModel[][] = [];
  for (let i = 0; i < cards.length; i += 2) rows.push(cards.slice(i, i + 2));
  return (
    <View>
      {rows.map((pair, r) => (
        <View key={r} style={styles.shipRow} wrap={false}>
          <ShipmentCard card={pair[0]} />
          <View style={styles.shipGap} />
          {pair[1] ? <ShipmentCard card={pair[1]} /> : <View style={{ flex: 1 }} />}
        </View>
      ))}
    </View>
  );
}

/* ── Tables ───────────────────────────────────────────────────────── */

function LineItemsTable({ items }: { items: LineItem[] }) {
  const total = lineItemsTotal(items);
  return (
    <View>
      <View style={styles.thRow}>
        <Text style={[styles.th, { flex: 1 }]}>Description</Text>
        <Text style={[styles.th, { width: 50, textAlign: "right" }]}>Qty</Text>
        <Text style={[styles.th, { width: 100, textAlign: "right" }]}>Price</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} style={i % 2 === 0 ? styles.trZebra : styles.tr} wrap={false}>
          <Text style={[styles.td, { flex: 1 }]}>{it.description}</Text>
          <Text style={[styles.td, { width: 50, textAlign: "right" }]}>{it.kind === "adjustment" ? "" : it.quantity}</Text>
          <Text style={[styles.td, { width: 100, textAlign: "right" }]}>{it.price}</Text>
        </View>
      ))}
      {total ? (
        <View style={styles.totalRow} wrap={false}>
          <Text style={[styles.totalText, { flex: 1 }]}>Total</Text>
          <Text style={[styles.totalText, { width: 50, textAlign: "right" }]}>{total.quantity}</Text>
          <Text style={[styles.totalText, { width: 100, textAlign: "right" }]}>{total.amount}</Text>
        </View>
      ) : null}
    </View>
  );
}

function EvidenceBasisTable({ rows }: { rows: ReturnType<typeof buildEvidenceBasisRows> }) {
  // No caption: the Record/Detail table is self-explanatory, and the prior
  // caption leaked internal terminology onto the bank PDF.
  return (
    <View>
      <View style={styles.thRow}>
        <Text style={[styles.th, { width: "38%" }]}>Record</Text>
        <Text style={[styles.th, { flex: 1 }]}>Detail</Text>
      </View>
      {rows.map((r, i) => (
        <View key={`${r.factId}-${r.label}`} style={i % 2 === 0 ? styles.trZebra : styles.tr} wrap={false}>
          <Text style={[styles.td, { width: "38%", fontWeight: 600, paddingRight: 10 }]}>{r.label}</Text>
          <Text style={[styles.td, { flex: 1 }]}>
            {r.value}
            {r.link ? (
              <>
                {" · "}
                <Link src={r.link.url} style={styles.link}>
                  {r.link.label}
                </Link>
              </>
            ) : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

function inclusionLabel(m: ManualEvidenceRecord): string {
  if (m.includeInBankNarrative && m.includeInPackage) return "Narrative + appendix";
  if (m.includeInBankNarrative) return "Narrative";
  if (m.includeInPackage) return "Appendix";
  return "Not included";
}

function SupportingEvidenceTable({
  included,
  issuerSafe,
}: {
  included: ManualEvidenceRecord[];
  issuerSafe: boolean;
}) {
  return (
    <View>
      <View style={styles.thRow}>
        <Text style={[styles.th, { flex: 2 }]}>Document</Text>
        <Text style={[styles.th, { flex: issuerSafe ? 4.4 : 3 }]}>Type &amp; description</Text>
        {/* The internal routing column. Never on the issuer-safe route. */}
        {issuerSafe ? null : <Text style={[styles.th, { flex: 1.4 }]}>Inclusion</Text>}
      </View>
      {included.map((m, i) => (
        <View key={m.id} style={i % 2 === 0 ? styles.trZebra : styles.tr} wrap={false}>
          <Text style={[styles.td, { flex: 2, fontWeight: 600 }]}>{m.filename}</Text>
          <Text style={[styles.td, { flex: issuerSafe ? 4.4 : 3 }]}>
            {m.fileType ?? "—"}
            {m.description ? ` — ${m.description}` : ""}
          </Text>
          {issuerSafe ? null : <Text style={[styles.td, { flex: 1.4 }]}>{inclusionLabel(m)}</Text>}
        </View>
      ))}
    </View>
  );
}

/* ── Chronology ───────────────────────────────────────────────────────
 * Events come from `lib/defence/chronology.ts` (shared with the HTML view).
 * Each gets a short title and a marker: filled for money and fulfilment,
 * hollow for customer notifications, green for the carrier's own record. */

function Chronology({ events, shipments }: { events: ChronologyEvent[]; shipments: ReturnType<typeof shipmentsOf> }) {
  return (
    <View>
      {events.map((e, i) => {
        const parts = dateParts(e.at);
        const { title, marker } = describeChronologyEvent(e, shipments);
        const last = i === events.length - 1;
        return (
          <View key={`${e.at}-${i}`} style={styles.chronoRow} wrap={false}>
            <View style={styles.chronoDateCol}>
              <Text style={styles.chronoDate}>{parts ? parts[0] : e.at}</Text>
              {parts ? <Text style={styles.chronoTime}>{parts[1]}</Text> : null}
            </View>
            <View style={styles.chronoRail}>
              {last ? null : <View style={styles.chronoLine} />}
              <View
                style={marker === "green" ? styles.dotGreen : marker === "hollow" ? styles.dotHollow : styles.dotFilled}
              />
            </View>
            <View style={styles.chronoBody}>
              <Text style={styles.chronoTitle}>{title}</Text>
              <Text style={styles.chronoText}>{e.text}</Text>
            </View>
          </View>
        );
      })}
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
  const issuerSafe = data.issuerSafeSupportingIndex === true;
  const lineItems = buildLineItems(approvedFacts, meta.lineItemsFromContext);
  const chronology = buildChronologyEvents(
    { ...meta, orderTotalDisplay: lineItemsTotal(lineItems)?.amount ?? null },
    approvedFacts,
  );
  const shipments = shipmentsOf(approvedFacts);
  const multiParcel = shipments.length > 1;
  // Single parcel: the carrier record as a card; the Evidence Basis then
  // leaves out the rows the card already shows.
  const single = multiParcel ? null : singleShipmentOf(approvedFacts, chronology, meta.orderName);
  const shownOnCard = single ? deliveryFactIds(approvedFacts) : new Set<string>();
  const evidenceRows = buildEvidenceBasisRows(approvedFacts).filter((r) => !shownOnCard.has(r.factId));
  const included = issuerSafe
    ? manualEvidence.filter(isBankIncludedManualEvidence)
    : manualEvidence.filter((m) => m.includeInPackage);
  const productNames = [
    ...lineItems.map((it) => it.description),
    ...shipments.map(productsOf),
  ];

  // Sections are numbered in the order they actually render.
  let n = 0;
  const num = () => String(++n).padStart(2, "0");

  const prose = (key: NarrativeSectionKey) => {
    const block = findBlock(composedBlocks, key);
    const body = blockBody(block);
    if (!block || !body) return null;
    return (
      <Section key={key} number={num()} title={block.heading} thesis={block.thesisText.trim() || undefined}>
        <Prose text={body} emphasise={productNames} />
      </Section>
    );
  };

  const overviewBlock = findBlock(composedBlocks, "transactionOverviewArgument");
  const lineItemsArgument =
    overviewBlock?.recordBuilt && lineItems.length > 0 ? blockBody(overviewBlock) : null;
  const chronologyBlock = findBlock(composedBlocks, "chronologyArgument");
  const chronologyBody = blockBody(chronologyBlock);
  const conclusion = findBlock(composedBlocks, "conclusion");
  const conclusionBody = blockBody(conclusion);

  return (
    <Document
      author="DisputeDesk"
      subject="Chargeback Representment — Complete Defence Package"
      creator="DisputeDesk Grounded Defence Package Builder"
    >
      <Page size="LETTER" style={styles.firstPage}>
        <Footer meta={meta} />
        <RunningHeader meta={meta} />
        {/* Page 1 only: not `fixed`, so it draws where it sits. */}
        <View style={styles.topBar} />

        <View style={{ marginTop: -32 }}>
          <FirstPage meta={meta} />
        </View>

        {/* The argument starts on page 2, under the running header. */}
        <View break>
          {prose("executiveSummary")}
          {/* A record-built overview argues the line items: it prints under
              the table instead (review of #352543, 2026-09-25). */}
          {lineItemsArgument ? null : prose("transactionOverviewArgument")}
          {prose("paymentAuthenticationArgument")}

          {multiParcel ? (
            <Section number={num()} title="Shipping, Delivery & Evidence">
              <ShipmentCards cards={shipmentCards(shipments, chronology)} />
            </Section>
          ) : single ? (
            <Section
              number={num()}
              title={findBlock(composedBlocks, "fulfillmentArgument")?.heading ?? "Shipping & Delivery"}
            >
              {/* One parcel: a full-width card with its fields side by side —
                  half a row of empty page otherwise (review of #352543). */}
              <View style={styles.shipRow} wrap={false}>
                <ShipmentCard card={shipmentCards([single], chronology)[0]} wide />
              </View>
              {addressCard(meta.addressExhibit) ? (
                <View style={[styles.shipRow, { marginTop: 12 }]} wrap={false}>
                  <ShipmentCard card={addressCard(meta.addressExhibit)!} wide />
                </View>
              ) : null}
              {blockBody(findBlock(composedBlocks, "fulfillmentArgument")) ? (
                <View style={{ marginTop: 14 }}>
                  <Prose
                    text={blockBody(findBlock(composedBlocks, "fulfillmentArgument")) as string}
                    emphasise={productNames}
                  />
                </View>
              ) : null}
            </Section>
          ) : (
            prose("fulfillmentArgument")
          )}

          {prose("communicationArgument")}
          {prose("policyArgument")}

          {!multiParcel && evidenceRows.length > 0 ? (
            <Section number={num()} title="Evidence Basis" keepTogether={evidenceRows.length <= 8}>
              <EvidenceBasisTable rows={evidenceRows} />
            </Section>
          ) : null}

          {prose("manualEvidenceArgument")}

          {included.length > 0 ? (
            <Section number={num()} title="Supporting Evidence">
              <SupportingEvidenceTable included={included} issuerSafe={issuerSafe} />
            </Section>
          ) : null}

          {lineItems.length > 0 ? (
            <Section number={num()} title="Order Line Items" keepTogether={lineItems.length <= 10}>
              {orderPlacedLine(meta.orderName, meta.transactionDate) ? (
                <Text style={{ fontSize: 9.5, color: COLORS.muted, marginBottom: 8 }}>
                  {orderPlacedLine(meta.orderName, meta.transactionDate)}
                </Text>
              ) : null}
              <LineItemsTable items={lineItems} />
              {lineItemsArgument ? (
                <View style={{ marginTop: 14 }}>
                  <Prose text={lineItemsArgument} emphasise={productNames} />
                </View>
              ) : null}
              {/* The same customer's later order, under the disputed order's
                  items (maintainer, 2026-09-25: it fits this page). */}
              {laterOrderCard(meta.laterOrderExhibit) ? (
                <View style={[styles.shipRow, { marginTop: 22 }]} wrap={false}>
                  <ShipmentCard card={laterOrderCard(meta.laterOrderExhibit)!} wide />
                </View>
              ) : null}
            </Section>
          ) : null}

          {chronology.length > 0 || chronologyBody ? (
            <Section
              number={num()}
              title="Chronology of Events"
              thesis={chronologyBlock?.thesisText.trim() || undefined}
              keepTogether={chronology.length <= 12}
            >
              {chronologyBody ? (
                <View style={{ marginBottom: 18 }}>
                  <Prose text={chronologyBody} />
                </View>
              ) : null}
              {chronology.length > 0 ? <Chronology events={chronology} shipments={shipments} /> : null}
            </Section>
          ) : null}

          {conclusion && (conclusionBody || conclusion.thesisText.trim()) ? (
            <Section number={num()} title={conclusion.heading} keepTogether>
              {/* The reasoning, then the request (review of #352543). */}
              <View style={styles.conclusion}>
                {conclusionBody ? (
                  <Text style={[styles.conclusionBody, conclusion.thesisText.trim() ? { marginBottom: 10 } : {}]}>
                    {conclusionBody}
                  </Text>
                ) : null}
                {conclusion.thesisText.trim() ? (
                  <Text style={[styles.conclusionRequest, { marginBottom: 0 }]}>{conclusion.thesisText.trim()}</Text>
                ) : null}
              </View>
            </Section>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}
