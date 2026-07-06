/**
 * EvidenceRow — per-item row used by the unified evidence card.
 *
 * Compact two-column layout: a body block (title + reason + source)
 * on the left and a single strength pill on the right. The previous
 * three-pill layout (strength · package status · bank argument status)
 * was redundant — the disposition section header already names the
 * bucket the row sits in, so per-row status restated the same fact
 * three times. Pinned by `app/(embedded)/app/disputes/[id]/tabs/sections/EvidenceUsedSection.tsx`.
 *
 * Rows separate visually via a dashed top border on every row except
 * the first in its section, matching the redesign's `.EvRow` rule.
 */

"use client";

import { useTranslations } from "next-intl";
import type {
  DeliveryFacts,
  EvidenceRowViewModel,
  EvidenceSource,
  InternalSignalViewModel,
} from "../useEvidenceSections";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import { resolveToken } from "@/lib/i18n/resolveToken";

/** Format an ISO date as a short "Mon D" for the facts line. Returns
 *  null on garbage so the segment is dropped rather than showing NaN. */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * One-line concrete delivery facts: carrier + tracking (as a segment),
 * shipped date, and a delivery segment that flips on proofType
 * (Delivered {date} / signature / Not delivered (est. {date})). The
 * tracking number renders as a link in the JSX; this helper returns the
 * non-link text segments plus the tracking href/label separately.
 */
function buildDeliveryFactsLine(
  facts: DeliveryFacts,
  tRoot: ReturnType<typeof useTranslations>,
): { segments: string[]; trackingLabel: string | null; trackingUrl: string | null } {
  const NS = "disputes.deliveryProof";
  const segments: string[] = [];
  const shipped = shortDate(facts.shippedAt);

  // Shipped {date} [via {carrier}]
  if (shipped) {
    segments.push(
      facts.carrier
        ? tRoot(`${NS}.factsShippedVia`, { date: shipped, carrier: facts.carrier })
        : tRoot(`${NS}.factsShipped`, { date: shipped }),
    );
  } else if (facts.carrier) {
    segments.push(facts.carrier);
  }

  // Delivery segment — proof-state aware.
  if (facts.proofType === "signature_confirmed" && facts.signedByName) {
    segments.push(tRoot(`${NS}.factsSignedBy`, { name: facts.signedByName }));
  } else if (
    (facts.proofType === "signature_confirmed" ||
      facts.proofType === "delivered_confirmed") &&
    facts.deliveredAt
  ) {
    const del = shortDate(facts.deliveredAt);
    if (del) segments.push(tRoot(`${NS}.factsDelivered`, { date: del }));
  } else if (facts.proofType === "delivered_unverified") {
    const eta = shortDate(facts.estimatedDeliveryAt);
    const etaText = eta ? tRoot(`${NS}.factsEta`, { date: eta }) : "";
    segments.push(tRoot(`${NS}.factsNotDelivered`, { eta: etaText }));
  }

  const trackingLabel = facts.trackingNumber;
  const trackingUrl = facts.trackingUrl;
  return { segments, trackingLabel, trackingUrl };
}

function sourceLabel(
  source: EvidenceSource,
  t: ReturnType<typeof useTranslations>,
): string {
  if (source === "shopify") return t("sourceShopify");
  if (source === "merchant") return t("sourceMerchant");
  if (source === "store_policy") return t("sourceStorePolicy");
  return t("sourceDerived");
}

const TARGET_FIELD_LABEL: Record<string, string> = {
  shippingDocumentationFile: "Shipping documentation",
  customerCommunicationFile: "Customer communication",
  serviceDocumentationFile: "Proof of service",
  refundPolicyFile: "Refund policy",
  cancellationPolicyFile: "Cancellation policy",
  uncategorizedFile: "Other evidence",
};

type PillVariant = "strong" | "moderate" | "supporting" | "none";

const PILL_STYLES: Record<PillVariant, { bg: string; color: string }> = {
  strong: { bg: "#D1FAE5", color: "#065F46" },
  moderate: { bg: "#FEF3C7", color: "#92400E" },
  supporting: { bg: "#E5E7EB", color: "#374151" },
  none: { bg: "#F3F4F6", color: "#6B7280" },
};

function strengthPill(
  strength: EvidenceLineItem["strengthContribution"],
  t: ReturnType<typeof useTranslations>,
): { variant: PillVariant; label: string } {
  switch (strength) {
    case "strong":
      return { variant: "strong", label: t("strength.strong") };
    case "moderate":
      return { variant: "moderate", label: t("strength.moderate") };
    case "supporting":
      return { variant: "supporting", label: t("strength.supporting") };
    case "internal_only":
      // Internal-only rows reach this component via InternalSignalRow,
      // not the regular path. If one slips through (defensive), label
      // as Supporting — the section chip already says "Kept internal".
      return { variant: "supporting", label: t("strength.supporting") };
    default:
      return { variant: "none", label: t("strength.none") };
  }
}

function Pill({ variant, label }: { variant: PillVariant; label: string }) {
  const style = PILL_STYLES[variant];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        alignSelf: "start",
        background: style.bg,
        color: style.color,
      }}
    >
      {label}
    </span>
  );
}

/**
 * Shared row chrome — grid with body + pill column, dashed separator
 * between rows in the same section. Both the regular EvidenceRow and
 * the InternalSignalRow render through this.
 */
function RowFrame({
  title,
  desc,
  factsLine,
  sourceLine,
  attachmentChip,
  pill,
}: {
  title: string;
  desc: string | null;
  factsLine?: React.ReactNode;
  sourceLine: string;
  attachmentChip?: React.ReactNode;
  pill: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        padding: "12px 0",
        borderTop: "1px dashed #EBEBEB",
        alignItems: "start",
      }}
      data-evidence-row
    >
      <div>
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#202223",
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          {title}
          {attachmentChip ? <> {attachmentChip}</> : null}
        </p>
        {factsLine ? (
          <p
            style={{
              fontSize: 12.5,
              color: "#202223",
              lineHeight: 1.5,
              margin: "4px 0 0",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {factsLine}
          </p>
        ) : null}
        {desc ? (
          <p
            style={{
              fontSize: 12.5,
              color: "#4B5563",
              lineHeight: 1.5,
              margin: "4px 0 0",
            }}
          >
            {desc}
          </p>
        ) : null}
        <p
          style={{
            fontSize: 11,
            color: "#6D7175",
            margin: "6px 0 0",
            letterSpacing: "0.01em",
          }}
        >
          {sourceLine}
        </p>
      </div>
      {pill}
    </div>
  );
}

export function EvidenceRow({
  item,
  lineItem,
}: {
  item: EvidenceRowViewModel;
  lineItem?: EvidenceLineItem;
}) {
  const t = useTranslations("disputes.evidenceTab.row");
  // Root (unscoped) translator for token resolution — used to resolve
  // lineItem.reasonToken (encodes absolute key paths) and the canonical
  // signal label fallback below.
  const tRoot = useTranslations();
  const titleLabel = (() => {
    // Delivery rows carry a proof-state-specific title in `item.title`
    // (built by useEvidenceSections). Do NOT re-resolve the generic
    // canonical label — that's exactly the "Delivery confirmation" ×2
    // duplication this fix removes.
    if (item.deliveryFacts) return item.title;
    const labelKey = lineItem ? CANONICAL_EVIDENCE[lineItem.field]?.labelKey : null;
    if (!labelKey) return item.title;
    try {
      const resolved = tRoot(labelKey);
      return resolved === labelKey ? item.title : resolved;
    } catch {
      return item.title;
    }
  })();
  // Delivery rows use their proof-specific why-context (item.whyThisMatters);
  // other rows keep the lineItem reasonToken as before.
  const reasonLine = item.deliveryFacts
    ? item.whyThisMatters
    : lineItem?.reasonToken
      ? resolveToken(tRoot, lineItem.reasonToken)
      : (lineItem?.reason ?? item.whyThisMatters);
  const deliveryFactsLine = item.deliveryFacts
    ? buildDeliveryFactsLine(item.deliveryFacts, tRoot)
    : null;

  const pill = strengthPill(
    lineItem
      ? lineItem.strengthContribution
      : item.strength === "supporting"
        ? "supporting"
        : item.strength === "moderate"
          ? "moderate"
          : "strong",
    t,
  );

  const attachmentChip = item.nativeAttachment ? (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 8px",
        marginLeft: 6,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: "#DCFCE7",
        color: "#065F46",
      }}
    >
      {`📎 ${
        TARGET_FIELD_LABEL[item.nativeAttachment.targetField] ??
        item.nativeAttachment.targetField
      }`}
    </span>
  ) : null;

  const factsLine =
    deliveryFactsLine && deliveryFactsLine.segments.length > 0 ? (
      <>
        {deliveryFactsLine.segments.join(" · ")}
        {deliveryFactsLine.trackingLabel ? (
          <>
            {" · "}
            {deliveryFactsLine.trackingUrl ? (
              <a
                href={deliveryFactsLine.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#2C6ECB", textDecoration: "none" }}
              >
                {deliveryFactsLine.trackingLabel} ↗
              </a>
            ) : (
              deliveryFactsLine.trackingLabel
            )}
          </>
        ) : null}
      </>
    ) : null;

  return (
    <RowFrame
      title={titleLabel}
      desc={reasonLine}
      factsLine={factsLine}
      sourceLine={`${t("source")} · ${sourceLabel(item.source, t)}`}
      attachmentChip={attachmentChip}
      pill={<Pill variant={pill.variant} label={pill.label} />}
    />
  );
}

/**
 * Internal-only signal rendered in the "Kept internal" disposition
 * bucket. Same chrome as `EvidenceRow` for visual consistency, but
 * the data source is the classifier-derived `InternalSignalViewModel`
 * (title + explanation; no per-field strength or attachment) so the
 * pill is hard-coded to "Supporting" — the bucket chip already
 * carries the "Kept internal" tone.
 */
export function InternalSignalRow({
  signal,
}: {
  signal: InternalSignalViewModel;
}) {
  const t = useTranslations("disputes.evidenceTab.row");
  return (
    <RowFrame
      title={signal.title}
      desc={signal.explanation}
      sourceLine={`${t("source")} · ${t("sourceDerived")}`}
      pill={<Pill variant="supporting" label={t("strength.supporting")} />}
    />
  );
}
