/**
 * DefencePackageHtmlView — the in-app preview of the Defence Package PDF,
 * drawn to the same "Chargeback Response v2" design (2026-09-24).
 *
 * Mirrors the deterministic PDF document structure (`lib/defence/pdf/
 * DefencePackageDocument.tsx`) section-for-section so what the merchant
 * sees in-app matches what the bank receives. The Polaris idiom replaces
 * the @react-pdf primitives but the content + ordering + filtering
 * rules are identical.
 *
 * Inputs:
 *   - row: latest defence_packages row (narrative_json, facts_json,
 *     status, version, mode, evidence_hash, prompt + model metadata).
 *   - dispute: optional dispute meta used to render the case-details
 *     table at the top.
 */

"use client";

import React, { Fragment } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@shopify/polaris";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSectionKey,
  PackageMode,
} from "@/lib/defence/types";
import { isSectionShown } from "@/lib/defence/sectionVisibility";
import { disputedAmountDisplay } from "@/lib/defence/shipmentRecordSections";
import { buildChronologyEvents, type ChronologyEvent } from "@/lib/defence/chronology";
import {
  SECTION_ORDER,
  SECTION_TITLES,
  sectionTitleFor,
} from "@/lib/defence/render/sections";
import { buildEvidenceBasisRows } from "@/lib/defence/pdf/evidenceBasisRows";
import { renderThesis } from "@/lib/defence/pdf/renderThesis";
import { familyKeyForModule, ALL_REASON_CODE_MODULES } from "@/lib/defence/reasonCodes/registry";
import { buildCaseDetailsRows } from "@/lib/defence/render/caseDetails";
import {
  buildLineItems,
  type LineItem,
} from "@/lib/defence/render/lineItems";
import type { ReasonCodeModuleKey } from "@/lib/defence/types";
import { formatMoneyDisplay, humanizeEnum, reasonCodeForNetwork } from "@/lib/defence/render/formatting";
import { DOCUMENT_COLORS } from "@/lib/defence/render/documentTheme";
import {
  dateParts,
  describeChronologyEvent,
  emphasisSegments,
  lineItemsTotal,
  orderPlacedLine,
  addressCard,
  laterOrderCard,
  productsOf,
  deliveryFactIds,
  shipmentCards,
  shipmentsOf,
  singleShipmentOf,
  statusPillTone,
  type PillTone,
  type ShipmentCard,
} from "@/lib/defence/render/documentModel";

/** Recognized reason-code module keys. Used to normalize an unknown
 *  `reason_code_module` to null before it reaches familyForModule()
 *  (which throws on unknown keys). Guards the tab against a crash from
 *  a bad/stale data row. */
const VALID_MODULE_KEYS = new Set<string>(
  ALL_REASON_CODE_MODULES.map((m) => m.key),
);

/**
 * Resolve the thesis blockquote text for a section.
 *
 * Both renderers now call `renderThesis()` from the templated thesis
 * system in `lib/defence/pdf/renderThesis.ts`. The HTML view's old
 * static per-module library (`GENERIC_THESIS` + `VISA_10_4_FRAUD_THESIS`)
 * is gone — it was a parallel implementation that needed to be
 * hand-synced with `lib/defence/pdf/thesisTemplates.ts`. Now both
 * surfaces produce identical thesis text for the same pack because
 * they share the same template registry + token resolver.
 *
 * Returns "" when the template's required tokens don't resolve
 * (no fact to ground the thesis claim). The renderer skips the
 * blockquote in that case.
 */
function thesisFor(
  sectionKey: NarrativeSectionKey,
  moduleKey: string | null | undefined,
  mode: PackageMode,
  facts: EvidenceFact[],
  caseContext?: { orderName?: string | null; disputeOpenedAt?: string | null; disputedAmount?: string | null },
): string | null {
  const familyKey = moduleKey
    ? familyKeyForModule(moduleKey as ReasonCodeModuleKey)
    : null;
  if (!familyKey) return null;
  const out = renderThesis({
    sectionKey,
    familyKey,
    packageMode: mode,
    approvedFacts: facts,
    caseContext,
  });
  return out || null;
}

// ─── Inputs ──────────────────────────────────────────────────────────

interface DefencePackageRow {
  id: string;
  version: number;
  status:
    | "draft"
    | "stale"
    | "final"
    | "submitted"
    | "superseded"
    | "failed"
    | "skipped";
  package_mode: PackageMode | null;
  generated_at: string;
  pdf_path: string | null;
  evidence_hash: string;
  llm_model: string | null;
  prompt_family: string | null;
  prompt_version: number | null;
  reason_code_module: string | null;
  validation_status: "ok" | "failed" | "skipped" | null;
  narrative_json: DefenceNarrativeOutput | null;
  facts_json: EvidenceFact[] | null;
}

export interface DisputeContextLike {
  /** Used by sibling fetches that hit `/api/defence-packages/*` routes
   *  with explicit `?shop_id=` query params, defence-in-depth alongside
   *  the middleware-injected `x-shop-id` header. */
  shopId?: string | null;
  disputeGid?: string | null;
  orderName?: string | null;
  reason?: string | null;
  reasonCodeDisplay?: string | null;
  amount?: number | string | null;
  currencyCode?: string | null;
  cardNetwork?: string | null;
  cardLast4?: string | null;
  paymentGateway?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  cardholderName?: string | null;
  customerEmail?: string | null;
  transactionDate?: string | null;
  /** When the dispute was opened — the opening line states it when the
   *  carrier-recorded delivery came first. */
  openedAt?: string | null;
  merchantName?: string | null;
  shopName?: string | null;
  /** Full event timeline from the pack's access_log section. Threaded
   *  through by the workspace API so the HTML view renders the SAME
   *  chronology bullets the PDF shows the bank — no parallel
   *  synthesis. When absent/empty, the renderer falls back to the
   *  synthetic 2-event path (only fires on packs built before the
   *  orderSource events capture was added). */
  timelineEvents?: Array<{ at: string; text: string }>;
}

interface Props {
  row: DefencePackageRow;
  dispute?: DisputeContextLike;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function disputeIdShort(gid: string | null | undefined): string {
  if (!gid) return "—";
  return gid.split("/").pop() ?? gid;
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtAmount(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "—";
  return currency ? `${currency} ${amount}` : String(amount);
}

// SECTION_ORDER + SECTION_TITLES imported from
// `lib/defence/render/sections.ts` — single source of truth shared
// with the PDF render pipeline (`lib/defence/pdf/composePdfBlocks.ts`).

// Evidence Basis filter + sort + per-fact value rendering all live in
// `lib/defence/pdf/evidenceBasisRows.ts` — single source of truth shared
// with the PDF renderer. Call `buildEvidenceBasisRows(facts)` to get
// the same {factId, category, label, value} rows the bank sees.
//
// The old local `buildEvidenceBasis()` + `renderFactValue()` here were
// a parallel implementation that drifted from the canonical version
// (e.g. they output the raw gateway codes verbatim and
// "Order on record (UNFULFILLED)" — both bank-readability problems the
// canonical formatter now translates to plain language).

/**
 * Chronology rendering is now a thin wrapper over the shared
 * `buildChronologyEvents()` in `lib/defence/chronology.ts`. Both the
 * PDF and this HTML view import from there — there is no parallel
 * implementation anywhere. The wrapper exists only to map this
 * file's `DisputeContextLike` (a UI prop type) to the
 * `ChronologyContext` shape the shared builder expects.
 */
function chronologyEvents(
  dispute: DisputeContextLike | undefined,
  facts: EvidenceFact[],
  orderTotalDisplay: string | null = null,
): ChronologyEvent[] {
  return buildChronologyEvents(
    {
      orderTotalDisplay,
      timelineEvents: dispute?.timelineEvents ?? null,
      transactionDate: dispute?.transactionDate ?? null,
      orderName: dispute?.orderName ?? null,
      cardNetwork: dispute?.cardNetwork ?? null,
      cardLast4: dispute?.cardLast4 ?? null,
    },
    facts,
  );
}

// ─── Component ───────────────────────────────────────────────────────
//
// Rendered to the "Chargeback Response v2" design, the same document the PDF
// draws (lib/defence/pdf/DefencePackageDocument.tsx): the case header, fact
// cards and Case Details, then numbered sections — shipment cards on a
// multi-parcel order, line items with a total, a vertical chronology, and the
// conclusion panel. The derived content comes from the shared
// `lib/defence/render/documentModel.ts`, so the two cannot drift. The copy is
// the document's own (English, as filed), not merchant UI copy.

const C = DOCUMENT_COLORS;
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const css = {
  doc: { fontFamily: FONT, color: C.body, fontSize: 14, lineHeight: 1.55 } as React.CSSProperties,
  bar: { height: 6, background: C.accent, borderRadius: "6px 6px 0 0", margin: "-20px -20px 20px" } as React.CSSProperties,
  metaRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" } as React.CSSProperties,
  eyebrow: { fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: "0.12em", textTransform: "uppercase" } as React.CSSProperties,
  metaRight: { fontSize: 12, color: C.muted },
  title: { fontSize: 32, fontWeight: 700, color: C.ink, letterSpacing: "-0.02em", lineHeight: 1.15, margin: "16px 0 6px" } as React.CSSProperties,
  subtitle: { fontSize: 16, color: C.muted },
  onBehalf: { fontSize: 14, color: C.muted, marginTop: 12 },
  factGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, margin: "22px 0 28px" } as React.CSSProperties,
  factCard: { background: C.accentSoft, borderRadius: 10, padding: "14px 16px" },
  factLabel: { fontSize: 11, fontWeight: 600, color: C.accent, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 } as React.CSSProperties,
  factValue: { fontSize: 22, fontWeight: 700, color: C.ink, lineHeight: 1.2 },
  plainHeading: { fontSize: 20, fontWeight: 700, color: C.accent, paddingBottom: 10, borderBottom: `2px solid ${C.accent}`, marginBottom: 10 },
  sectionHead: { display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, borderBottom: `2px solid ${C.accent}`, margin: "32px 0 14px" },
  badge: { background: C.accent, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "3px 7px" },
  sectionTitle: { fontSize: 20, fontWeight: 700, color: C.accent },
  th: { fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 12px", textAlign: "left" } as React.CSSProperties,
  td: { fontSize: 14, color: C.ink, padding: "9px 12px", verticalAlign: "top" } as React.CSSProperties,
  tdLabel: { fontSize: 14, color: C.muted, padding: "9px 12px", verticalAlign: "top" } as React.CSSProperties,
  paragraph: { fontSize: 15, color: C.body, margin: "0 0 10px" },
  thesis: { borderLeft: `3px solid ${C.accent}`, paddingLeft: 12, margin: "0 0 12px", color: C.ink, fontWeight: 500 },
  link: { color: C.accent, textDecoration: "none" },
};

function Pill({ tone, label }: { tone: PillTone; label: string }) {
  const c =
    tone === "green"
      ? { bg: C.greenBg, border: C.greenBorder, text: C.greenText }
      : tone === "blue"
        ? { bg: C.blueBg, border: C.blueBorder, text: C.blueText }
        : { bg: C.greyBg, border: C.greyBorder, text: C.greyText };
  return (
    <span
      style={{
        display: "inline-block",
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        borderRadius: 6,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.5,
      }}
    >
      {label}
    </span>
  );
}

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={css.sectionHead}>
        <span style={css.badge}>{number}</span>
        <span style={css.sectionTitle}>{title}</span>
      </div>
      {children}
    </section>
  );
}

function Prose({ text, emphasise = [] }: { text: string; emphasise?: string[] }) {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <p key={i} style={css.paragraph}>
          {emphasisSegments(p, emphasise).map((seg, j) =>
            seg.strong ? (
              <strong key={j} style={{ color: C.ink }}>
                {seg.text}
              </strong>
            ) : (
              <Fragment key={j}>{seg.text}</Fragment>
            ),
          )}
        </p>
      ))}
    </>
  );
}

function ZebraTable({
  head,
  rows,
  widths,
  align,
}: {
  head: string[];
  rows: React.ReactNode[][];
  widths?: string[];
  align?: Array<"left" | "right">;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} style={{ ...css.th, width: widths?.[i], textAlign: align?.[i] ?? "left" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r} style={{ background: r % 2 === 0 ? C.zebra : "transparent" }}>
            {cells.map((cell, i) => (
              <td
                key={i}
                style={{
                  ...(i === 0 && head[0] === "Field" ? css.tdLabel : css.td),
                  textAlign: align?.[i] ?? "left",
                  borderTopLeftRadius: i === 0 ? 6 : 0,
                  borderBottomLeftRadius: i === 0 ? 6 : 0,
                  borderTopRightRadius: i === cells.length - 1 ? 6 : 0,
                  borderBottomRightRadius: i === cells.length - 1 ? 6 : 0,
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShipmentCardView({ card, wide = false }: { card: ShipmentCard; wide?: boolean }) {
  return (
    <div style={{ border: `1px solid ${C.hairline}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ background: C.accentSoft, padding: "14px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ ...css.eyebrow, fontSize: 11 }}>{card.eyebrow ?? `Shipment ${card.index}`}</span>
          <Pill tone={card.status.tone} label={card.status.label} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{card.product}</div>
      </div>
      <div
        style={
          wide
            ? { padding: "14px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }
            : { padding: "4px 18px 10px" }
        }
      >
        {card.fields.map((f, i) => (
          <div
            key={f.label}
            style={
              wide
                ? {}
                : {
                    padding: "10px 0",
                    borderBottom: i === card.fields.length - 1 ? "none" : `1px solid ${C.hairline}`,
                  }
            }
          >
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 2 }}>{f.label}</div>
            <div style={{ fontSize: 14, color: C.ink, fontWeight: 500, whiteSpace: "pre-line" }}>
              {f.value}
              {f.reference ? (
                <>
                  {" · "}
                  {f.reference.url ? (
                    <a href={f.reference.url} target="_blank" rel="noopener noreferrer" style={css.link}>
                      {f.reference.text}
                    </a>
                  ) : (
                    f.reference.text
                  )}
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChronologyView({
  events,
  shipments,
}: {
  events: ChronologyEvent[];
  shipments: ReturnType<typeof shipmentsOf>;
}) {
  return (
    <div>
      {events.map((e, i) => {
        const parts = dateParts(e.at);
        const { title, marker } = describeChronologyEvent(e, shipments);
        const last = i === events.length - 1;
        const dot: React.CSSProperties =
          marker === "green"
            ? { background: C.greenDot }
            : marker === "hollow"
              ? { background: "#fff", border: `2px solid ${C.accent}`, width: 7, height: 7 }
              : { background: C.accent };
        return (
          <div key={`${e.at}-${i}`} style={{ display: "grid", gridTemplateColumns: "150px 28px 1fr", minHeight: 58 }}>
            <div style={{ paddingBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{parts ? parts[0] : e.at}</div>
              {parts ? <div style={{ fontSize: 12.5, color: C.muted }}>{parts[1]}</div> : null}
            </div>
            <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
              {last ? null : (
                <div style={{ position: "absolute", top: 12, bottom: 0, width: 2, background: C.accentLine }} />
              )}
              <div style={{ position: "relative", width: 11, height: 11, borderRadius: "50%", marginTop: 5, ...dot }} />
            </div>
            <div style={{ paddingBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{title}</div>
              <div style={{ fontSize: 14, color: C.muted }}>{e.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DefencePackageHtmlView({ row, dispute }: Props) {
  const t = useTranslations("disputes.defencePackageHtml");
  // No narrative → render nothing (e.g., skipped / failed packages).
  if (!row.narrative_json || !row.facts_json) {
    return null;
  }
  const narrative = row.narrative_json;
  const facts = row.facts_json;
  const omitted = new Set<NarrativeSectionKey>(
    narrative.omittedSections.map((o) => o.sectionKey),
  );
  const mode: PackageMode = row.package_mode ?? "full";
  // Guard against an unrecognized reason_code_module: familyForModule()
  // THROWS on an unknown key, which would white-screen the whole tab on a
  // single bad/stale row. Normalize to null so the null-safe paths run.
  const moduleKey = VALID_MODULE_KEYS.has(row.reason_code_module as string)
    ? row.reason_code_module
    : null;
  const reasonModule = moduleKey ? ALL_REASON_CODE_MODULES.find((m) => m.key === moduleKey) ?? null : null;

  const lineItems: LineItem[] = buildLineItems(facts);
  const chrono = chronologyEvents(dispute, facts, lineItemsTotal(lineItems)?.amount ?? null);
  const total = lineItemsTotal(lineItems);
  const shipments = shipmentsOf(facts);
  const multiParcel = shipments.length > 1;
  // Same as the PDF: a single parcel's carrier record is a card, and the
  // Evidence Basis leaves out what the card shows.
  const single = multiParcel ? null : singleShipmentOf(facts, chrono, dispute?.orderName ?? null);
  const shownOnCard = single ? deliveryFactIds(facts) : new Set<string>();
  const evidenceBasis = buildEvidenceBasisRows(facts).filter((r) => !shownOnCard.has(r.factId));
  const productNames = [...lineItems.map((it) => it.description), ...shipments.map(productsOf)];
  const caseContext = {
    orderName: dispute?.orderName ?? null,
    disputeOpenedAt: dispute?.openedAt ?? null,
    disputedAmount: disputedAmountDisplay(
      dispute?.amount == null ? null : Number(dispute.amount),
      dispute?.currencyCode ?? null,
    ),
  };

  const fulfillmentFallbackVisible =
    omitted.has("fulfillmentArgument") &&
    typeof dispute?.fulfillmentStatus === "string" &&
    dispute.fulfillmentStatus.toUpperCase() === "FULFILLED";

  // The PDF's label: the module's network code narrowed to the card used
  // ("Visa 13.1"). Without a card network (BNPL) or a module, the Shopify
  // reason in words — never the raw enum ("PRODUCT_NOT_RECEIVED").
  const reason =
    (dispute?.reasonCodeDisplay
      ? reasonCodeForNetwork(dispute.reasonCodeDisplay, dispute?.cardNetwork ?? null)
      : dispute?.cardNetwork && reasonModule
        ? reasonCodeForNetwork(reasonModule.displayName, dispute.cardNetwork)
        : null) ?? humanizeEnum(dispute?.reason);
  const amount = formatMoneyDisplay(fmtAmount(dispute?.amount, dispute?.currencyCode));
  const merchant = dispute?.merchantName ?? dispute?.shopName ?? t("defaultMerchant");

  // Case Details rows come from the shared builder so the PDF and this view
  // show the same fields in the same order. `familyKey` drives the per-family
  // deny list (fraud disputes hide Fulfillment status).
  const caseRows = buildCaseDetailsRows({
    disputeIdShort: disputeIdShort(dispute?.disputeGid),
    merchantName: merchant,
    cardNetwork: dispute?.cardNetwork ?? null,
    transactionDateDisplay: fmtIso(dispute?.transactionDate),
    amountDisplay: amount,
    reasonCodeDisplay: reason,
    claimType: reasonModule?.claimType ?? null,
    orderName: dispute?.orderName ?? null,
    cardholderName: dispute?.cardholderName ?? null,
    cardLast4: dispute?.cardLast4 ?? null,
    paymentGateway: dispute?.paymentGateway ?? null,
    financialStatus: dispute?.financialStatus ?? null,
    fulfillmentStatus: dispute?.fulfillmentStatus ?? null,
    familyKey: moduleKey ? familyKeyForModule(moduleKey as ReasonCodeModuleKey) : null,
  });

  // Empty-card guard: no narrative text, evidence, events or line items →
  // render nothing rather than an empty titled shell.
  const hasNarrativeText = SECTION_ORDER.some((key) => {
    const section = narrative[key as NarrativeSectionKey];
    return section && !omitted.has(key as NarrativeSectionKey) && section.text?.trim();
  });
  if (!(hasNarrativeText || evidenceBasis.length > 0 || chrono.length > 0 || lineItems.length > 0)) {
    return null;
  }

  const visible = (key: NarrativeSectionKey) =>
    isSectionShown(narrative, key, moduleKey) && !omitted.has(key) && narrative[key]?.text?.trim()
      ? narrative[key].text.trim()
      : null;

  // Numbered in the order sections actually render, as in the PDF.
  let n = 0;
  const num = () => String(++n).padStart(2, "0");

  const prose = (key: NarrativeSectionKey) => {
    const body = visible(key);
    if (!body) return null;
    // Counsel v2: the model-written punchline replaces the templated headline, as in the PDF.
    const thesis =
      key === "executiveSummary" && narrative.headline !== undefined
        ? narrative.headline.trim() || null
        : thesisFor(key, moduleKey, mode, facts, caseContext);
    return (
      <Section key={key} number={num()} title={sectionTitleFor(key, facts)}>
        {thesis ? <p style={css.thesis}>{thesis}</p> : null}
        <Prose text={body} emphasise={productNames} />
      </Section>
    );
  };

  const conclusionBody = visible("conclusion");
  // The request line stands alone when the body is empty (record-built letters).
  const conclusionThesis = thesisFor("conclusion", moduleKey, mode, facts, caseContext);
  const chronologyBody = visible("chronologyArgument");
  const lineItemsArgument =
    narrative.transactionOverviewArgument?.source === "record" && lineItems.length > 0
      ? visible("transactionOverviewArgument")
      : null;

  return (
    <Card padding="500">
      <div style={css.doc}>
        <div style={css.bar} />
        <div style={css.metaRow}>
          <span style={css.eyebrow}>Chargeback response</span>
          <span style={css.metaRight}>{fmtIso(row.generated_at)}</span>
        </div>
        <div style={css.title}>Dispute {disputeIdShort(dispute?.disputeGid)}</div>
        <div style={css.subtitle}>
          {[
            dispute?.orderName ? `Order ${dispute.orderName}` : null,
            [reason, reasonModule?.claimType].filter(Boolean).join(" — ") || null,
            amount,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div style={css.onBehalf}>
          Submitted on behalf of <strong style={{ color: C.accent, fontWeight: 600 }}>{merchant}</strong>
        </div>

        <div style={css.factGrid}>
          {[
            ["Disputed amount", amount ?? "—"],
            ["Reason code", reason ?? "—"],
            ["Claim type", reasonModule?.claimType ? reasonModule.claimType.replace(/\s+claim$/i, "") : "—"],
          ].map(([label, value]) => (
            <div key={label} style={css.factCard}>
              <div style={css.factLabel}>{label}</div>
              <div style={css.factValue}>{value}</div>
            </div>
          ))}
        </div>

        <div style={css.plainHeading}>Case Details</div>
        <ZebraTable
          head={["Field", "Detail"]}
          widths={["38%", "62%"]}
          rows={caseRows.map(([k, v]) => [
            k,
            (k === "Financial status" || k === "Fulfillment status") && v !== "—" ? (
              <Pill tone={statusPillTone(v)} label={v} />
            ) : (
              v
            ),
          ])}
        />

        {prose("executiveSummary")}
        {/* A record-built overview argues the line items: it prints under
            the table instead, as in the PDF. */}
        {lineItemsArgument ? null : prose("transactionOverviewArgument")}
        {prose("paymentAuthenticationArgument")}

        {multiParcel ? (
          <Section number={num()} title="Shipping, Delivery & Evidence">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              {shipmentCards(shipments, chrono).map((card) => (
                <ShipmentCardView key={card.index} card={card} />
              ))}
            </div>
          </Section>
        ) : single ? (
          <Section number={num()} title={sectionTitleFor("fulfillmentArgument", facts)}>
            {shipmentCards([single], chrono).map((card) => (
              <ShipmentCardView key={card.index} card={card} wide />
            ))}
            {addressCard(narrative.addressExhibit) ? (
              <div style={{ marginTop: 12 }}>
                <ShipmentCardView card={addressCard(narrative.addressExhibit)!} wide />
              </div>
            ) : null}
            {visible("fulfillmentArgument") ? (
              <div style={{ marginTop: 16 }}>
                <Prose text={visible("fulfillmentArgument") as string} emphasise={productNames} />
              </div>
            ) : null}
          </Section>
        ) : visible("fulfillmentArgument") ? (
          prose("fulfillmentArgument")
        ) : fulfillmentFallbackVisible ? (
          <Section number={num()} title={sectionTitleFor("fulfillmentArgument", facts)}>
            <p style={css.paragraph}>
              The merchant&apos;s order record marks the order as shipped. No separate delivery,
              access-use, or service-completion claim is made in this section unless supported by
              approved evidence.
            </p>
          </Section>
        ) : null}

        {prose("communicationArgument")}
        {prose("policyArgument")}

        {/* The PDF prints no Evidence Basis without rows; neither does the
            preview when a shipment card already shows the record. */}
        {!multiParcel && !(single && evidenceBasis.length === 0) ? (
          <Section number={num()} title={t("evidenceBasis")}>
            {evidenceBasis.length === 0 ? (
              <p style={css.paragraph}>{t("noBankEligibleFacts")}</p>
            ) : (
              <ZebraTable
                head={["Record", "Detail"]}
                widths={["38%", "62%"]}
                rows={evidenceBasis.map((r) => [
                  <span key="l" style={{ fontWeight: 600 }}>{r.label}</span>,
                  <span key="v">
                    {r.value}
                    {r.link ? (
                      <>
                        {" · "}
                        <a href={r.link.url} target="_blank" rel="noopener noreferrer" style={css.link}>
                          {r.link.label}
                        </a>
                      </>
                    ) : null}
                  </span>,
                ])}
              />
            )}
          </Section>
        ) : null}

        {prose("manualEvidenceArgument")}

        {lineItems.length > 0 ? (
          <Section number={num()} title={t("orderLineItems")}>
            {orderPlacedLine(dispute?.orderName, dispute?.transactionDate) ? (
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
                {orderPlacedLine(dispute?.orderName, dispute?.transactionDate)}
              </div>
            ) : null}
            <ZebraTable
              head={["Description", "Qty", "Price"]}
              widths={["70%", "10%", "20%"]}
              align={["left", "right", "right"]}
              rows={lineItems.map((it) => [it.description, it.kind === "adjustment" ? "" : String(it.quantity), it.price])}
            />
            {total ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "70% 10% 20%",
                  borderTop: `2px solid ${C.ink}`,
                  marginTop: 6,
                  paddingTop: 10,
                  color: C.accent,
                  fontWeight: 700,
                }}
              >
                <span style={{ padding: "0 12px" }}>Total</span>
                <span style={{ padding: "0 12px", textAlign: "right" }}>{total.quantity}</span>
                <span style={{ padding: "0 12px", textAlign: "right" }}>{total.amount}</span>
              </div>
            ) : null}
            {lineItemsArgument ? (
              <div style={{ marginTop: 16 }}>
                <Prose text={lineItemsArgument} emphasise={productNames} />
              </div>
            ) : null}
          </Section>
        ) : null}

        {chrono.length > 0 || chronologyBody ? (
          <Section number={num()} title={SECTION_TITLES.chronologyArgument}>
            {chronologyBody ? (
              <div style={{ marginBottom: 20 }}>
                <Prose text={chronologyBody} />
              </div>
            ) : null}
            {laterOrderCard(narrative.laterOrderExhibit) ? (
              <div style={{ marginBottom: 20 }}>
                <ShipmentCardView card={laterOrderCard(narrative.laterOrderExhibit)!} wide />
              </div>
            ) : null}
            {chrono.length > 0 ? <ChronologyView events={chrono} shipments={shipments} /> : null}
          </Section>
        ) : null}

        {conclusionBody || conclusionThesis ? (
          <Section number={num()} title={SECTION_TITLES.conclusion}>
            <div style={{ background: C.accentSoft, borderRadius: 12, padding: "22px 26px" }}>
              {/* The reasoning, then the request, as in the PDF. */}
              {conclusionBody ? (
                <div style={{ fontSize: 15, color: C.ink, marginBottom: conclusionThesis ? 12 : 0 }}>{conclusionBody}</div>
              ) : null}
              {conclusionThesis ? (
                <div style={{ fontSize: 18, fontWeight: 600, color: C.accent, lineHeight: 1.4 }}>{conclusionThesis}</div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {/* Package Metadata intentionally NOT rendered: operator audit data,
            surfaced in /admin/defence-package/runs/[id] only. */}
      </div>
    </Card>
  );
}
