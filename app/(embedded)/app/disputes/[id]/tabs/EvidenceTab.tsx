"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Collapsible,
  Icon,
  DropZone,
  Spinner,
  Popover,
  ActionList,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  MinusCircleIcon,
  CreditCardIcon,
  DeliveryIcon,
  PersonIcon,
  GlobeIcon,
  LockIcon,
  OrderIcon,
  ChatIcon,
  NoteIcon,
  FileIcon,
} from "@shopify/polaris-icons";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import type { EvidenceItemWithStrength, WaiveReason } from "../workspace-components/types";
import type { CounterclaimNode } from "@/lib/argument/types";
import {
  EVIDENCE_EVALUATION_HELPER,
  evidenceRowStatus,
} from "@/lib/argument/evidenceStatus";
import { categoryFor } from "@/lib/argument/canonicalEvidence";
import { categoryBadge } from "@/lib/argument/categoryBadge";
import styles from "../workspace.module.css";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

const WAIVE_REASON_LABELS: Record<WaiveReason, string> = {
  not_applicable: "Not applicable to this dispute",
  evidence_unavailable: "I can\u2019t get this evidence",
  already_in_shopify: "Already submitted separately",
  merchant_accepts_risk: "I understand the risk",
  other: "Other reason",
};

/* Plain-English description for each evidence row, used in both EvidenceTab
 * and OverviewTab (kept in sync via WHY_EVIDENCE_MATTERS). Bank-grade
 * wording — what the row actually proves to the bank, in plain language. */
const WHY_TEXT: Record<string, string> = {
  order_confirmation: "A complete record of the order, including items, amount, and customer details.",
  shipping_tracking: "Carrier confirmation that the order was shipped and delivered.",
  delivery_proof: "Proof of delivery through signature or photographic confirmation.",
  billing_address_match: "Matches the billing address to the order",
  avs_cvv_match: "Card security checks confirming the purchaser had access to billing details.",
  product_description: "Proves the product matched its description",
  refund_policy: "Shows customer agreed to refund terms",
  shipping_policy: "Documents shipping commitments",
  cancellation_policy: "Proves cancellation rules were disclosed",
  customer_communication: "Messages or emails showing engagement before or after the purchase.",
  customer_account_info: "Account age and activity supporting a legitimate customer profile.",
  duplicate_explanation: "Explains why charges are not duplicates",
  supporting_documents: "Additional proof that strengthens your case",
  activity_log: "Evidence of prior successful transactions from the same customer.",
  device_session_consistency: "Technical signals showing consistent device and session behavior.",
  ip_location_check: "Verification of purchase location compared to billing details and prior activity.",
};

/* Plain-language label for each evidence field — used in "How strong your case is".
 * Bank-grade titles per the 2026-04-21 evidence-model rename. */
const FRIENDLY_FIELD_LABEL: Record<string, string> = {
  order_confirmation: "Transaction Record",
  shipping_tracking: "Shipping Confirmation",
  delivery_proof: "Delivery Confirmation (Signature / Photo)",
  billing_address_match: "Billing address match",
  avs_cvv_match: "Payment Verification (AVS & CVV)",
  product_description: "Product listing",
  refund_policy: "Refund policy",
  shipping_policy: "Shipping policy",
  cancellation_policy: "Cancellation policy",
  customer_communication: "Customer Communication",
  customer_account_info: "Customer Account Profile",
  duplicate_explanation: "Duplicate-charge explanation",
  supporting_documents: "Extra supporting documents",
  activity_log: "Customer History",
  device_session_consistency: "Device & Session Consistency",
  ip_location_check: "IP & Location Check",
};

/* Plain-language impact statement for missing evidence. */
const MISSING_IMPACT: Record<string, string> = {
  order_confirmation: "the case loses its anchor — required to prove this was a real transaction.",
  shipping_tracking: "you can\u2019t prove the order left your warehouse.",
  delivery_proof: "you can\u2019t prove the customer received the package — reduces strength for delivery-related disputes.",
  billing_address_match: "the bank can\u2019t verify the cardholder.",
  avs_cvv_match: "the bank has no proof the card security checks passed.",
  product_description: "you can\u2019t prove the product matched what was advertised.",
  refund_policy: "the bank assumes no refund terms were disclosed.",
  shipping_policy: "delivery timing claims are harder to defend.",
  cancellation_policy: "cancellation timing claims are harder to defend.",
  customer_communication: "the bank doesn\u2019t see your engagement with the customer.",
  customer_account_info: "the bank can\u2019t tell whether this is a first-time buyer or an established repeat customer.",
  duplicate_explanation: "the bank assumes the charges are duplicates.",
  activity_log: "the bank can\u2019t see legitimate purchase history.",
  supporting_documents: "the case has fewer corroborating signals.",
  ip_location_check: "no location verification data was available for this order \u2014 this is optional evidence and the case isn\u2019t weaker without it.",
  device_session_consistency: "no device or session signal was available for this order.",
};

function friendlyLabel(field: string, fallback: string): string {
  return FRIENDLY_FIELD_LABEL[field] ?? fallback;
}

function impactSentence(field: string): string {
  const tail = MISSING_IMPACT[field] ?? "the case is weaker than it could be.";
  return `Missing ${friendlyLabel(field, field).toLowerCase()} \u2014 without it, ${tail}`;
}

/* ── Outcome helper ── *
 *
 * The Evidence tab shows ONE verdict at the top, derived directly
 * from `derived.caseStrength.overall` — the canonical engine output.
 * The previous design also showed a "Confidence" pill via
 * `confidenceFrom(level, score)`, but those thresholds were written
 * against the legacy 0-100 ratio; after the P2.1 scoring rewrite
 * `score` became a count-based weighted sum (`strongCount * 3 +
 * moderateCount * 2`, typically 0-N), so a moderate case landed in
 * the `score < 40 → "Low"` branch and contradicted the header
 * "Moderate case" pill. Removed in 2026-04-26 (option B). The
 * follow-up unification will move every tab to
 * `caseStrength.heroVariant` for a single, app-wide verdict.
 */
function outcomeFromStrength(level: string): { label: string; tone: "success" | "warning" | "critical" } {
  if (level === "strong") return { label: "Likely to win", tone: "success" };
  if (level === "moderate") return { label: "Moderate", tone: "warning" };
  return { label: "Weak", tone: "critical" };
}

/* ── Argument-block icon mapping ── *
 * Picks a leading icon for a counterclaim by inspecting which evidence
 * fields support it. Falls back to Lock for "payment-feeling" / generic
 * blocks so the visual still aligns with the Figma argument-block
 * pattern (CreditCard / Delivery / Person / Globe / Lock).
 */
function counterclaimIcon(supportingFields: string[]): typeof CreditCardIcon {
  const set = new Set(supportingFields);
  if (set.has("avs_cvv_match") || set.has("billing_address_match")) return CreditCardIcon;
  if (set.has("shipping_tracking") || set.has("delivery_proof")) return DeliveryIcon;
  if (
    set.has("customer_account_info") ||
    set.has("activity_log") ||
    set.has("customer_communication")
  ) {
    return PersonIcon;
  }
  if (set.has("ip_location_check") || set.has("device_session_consistency")) return GlobeIcon;
  return LockIcon;
}

/** Per-category leading icon (matches the argument-block visual pattern). */
const CATEGORY_ICON: Record<string, typeof CreditCardIcon> = {
  order: OrderIcon,
  payment: CreditCardIcon,
  fulfillment: DeliveryIcon,
  communication: ChatIcon,
  policy: NoteIcon,
  identity: PersonIcon,
  merchant: FileIcon,
};

/** Flat strength pill (matches Figma `px-2 py-0.5 rounded-md text-xs`). */
function strengthPillStyle(strength: string): { bg: string; color: string; label: string } {
  if (strength === "strong") return { bg: "#D1FAE5", color: "#065F46", label: "Strong" };
  if (strength === "moderate") return { bg: "#FEF3C7", color: "#92400E", label: "Moderate" };
  return { bg: "#FEF3C7", color: "#92400E", label: "Supporting" };
}

/* ── Content Preview Renderers ── */

function renderContent(field: string, content: Record<string, unknown> | null): React.ReactNode {
  if (!content) return null;

  // Shipping / Tracking
  if (field === "shipping_tracking" || field === "delivery_proof") {
    const fulfillments = content.fulfillments as Array<Record<string, unknown>> | undefined;
    if (!fulfillments?.length) return <GenericPreview data={content} />;
    return (
      <div className={styles.contentPreview}>
        {fulfillments.map((f, i) => (
          <BlockStack key={i} gap="100">
            {Array.isArray(f.tracking) ? (f.tracking as Array<Record<string, unknown>>).map((t, j) => (
              <div key={j}>
                <Row label="Carrier" value={String(t.carrier ?? "\u2014")} />
                <Row label="Tracking" value={String(t.number ?? "\u2014")} />
              </div>
            )) : null}
            <Row label="Status" value={String(f.displayStatus ?? f.status ?? "\u2014")} />
            {typeof f.deliveredAt === "string" ? <Row label="Delivered" value={formatDate(f.deliveredAt)} /> : null}
            {typeof f.createdAt === "string" ? <Row label="Shipped" value={formatDate(f.createdAt)} /> : null}
          </BlockStack>
        ))}
      </div>
    );
  }

  // AVS / CVV
  if (field === "avs_cvv_match") {
    return (
      <div className={styles.contentPreview}>
        <Row label="AVS" value={String(content.avsResultCode ?? "\u2014")} />
        <Row label="CVV" value={String(content.cvvResultCode ?? "\u2014")} />
        <Row label="Gateway" value={String(content.gateway ?? "\u2014")} />
        {typeof content.lastFour === "string" ? <Row label="Card" value={`****${content.lastFour}`} /> : null}
      </div>
    );
  }

  // Order
  if (field === "order_confirmation") {
    return (
      <div className={styles.contentPreview}>
        <Row label="Order" value={String(content.orderName ?? "\u2014")} />
        <Row label="Created" value={typeof content.createdAt === "string" ? formatDate(content.createdAt) : "\u2014"} />
        {content.totals && typeof content.totals === "object" ? (
          <Row label="Total" value={`${(content.totals as Record<string, unknown>).currency ?? ""} ${(content.totals as Record<string, unknown>).total ?? ""}`} />
        ) : null}
      </div>
    );
  }

  // Policy
  if (field.includes("policy")) {
    const policies = content.policies as Array<Record<string, unknown>> | undefined;
    if (policies?.length) {
      const p = policies[0];
      return (
        <div className={styles.contentPreview}>
          <Row label="Type" value={String(p.policyType ?? "\u2014")} />
          <Row label="Captured" value={typeof p.capturedAt === "string" ? formatDate(p.capturedAt) : "\u2014"} />
          {typeof p.textPreview === "string" ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {p.textPreview.slice(0, 200)}
              {p.textPreview.length > 200 ? "..." : ""}
            </Text>
          ) : null}
        </div>
      );
    }
  }

  // Customer account info
  if (field === "customer_account_info") {
    const total = typeof content.totalOrders === "number" ? content.totalOrders : null;
    const since = typeof content.customerSince === "string" ? content.customerSince : null;
    const repeat = Boolean(content.isRepeatCustomer);
    return (
      <div className={styles.contentPreview}>
        <Row
          label="Status"
          value={repeat ? "Repeat customer" : total === 1 ? "First-time customer" : "\u2014"}
        />
        {total !== null ? <Row label="Total orders" value={String(total)} /> : null}
        {since ? <Row label="Customer since" value={formatDate(since)} /> : null}
      </div>
    );
  }

  // IP & Location Check — interpreted-signal sentences only.
  // Never renders raw IP, org/ASN, or coordinates. Two lines max:
  // primary verdict + optional reliability note.
  if (field === "ip_location_check") {
    const summary = typeof content.summary === "string" ? content.summary : "";
    const merchantGuidance = typeof content.merchantGuidance === "string" ? content.merchantGuidance : null;
    const lines = summary ? summary.split("\n").filter((l) => l.trim().length > 0) : [];

    return (
      <BlockStack gap="200">
        {lines.map((line, i) => (
          <Text key={i} as="p" variant="bodyMd" fontWeight={i === 0 ? "semibold" : "regular"}>
            {line}
          </Text>
        ))}

        {merchantGuidance ? (
          <Banner tone="info">
            <Text as="p" variant="bodySm">{merchantGuidance}</Text>
          </Banner>
        ) : null}
      </BlockStack>
    );
  }

  return <GenericPreview data={content} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.contentPreviewRow}>
      <span className={styles.contentPreviewLabel}>{label}</span>
      <span className={styles.contentPreviewValue}>{value}</span>
    </div>
  );
}

function GenericPreview({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).slice(0, 6);
  if (entries.length === 0) return null;
  return (
    <div className={styles.contentPreview}>
      {entries.map(([k, v]) => (
        <Row key={k} label={k.replace(/_/g, " ")} value={typeof v === "object" ? JSON.stringify(v) : String(v ?? "\u2014")} />
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Merchant-safe copy for system failure codes. The internal
 * failure_reason is never rendered directly — we map the code to
 * controlled wording here and keep the raw text in audit logs only.
 */
const FAILURE_COPY: Record<string, { title: string; body: string }> = {
  order_fetch_failed: {
    title: "We couldn\u2019t retrieve the Shopify order data",
    body:
      "This pack couldn\u2019t be built because we weren\u2019t able to load the underlying order from Shopify. " +
      "This is a system issue on our end \u2014 not missing evidence on yours. " +
      "Try rebuilding. If it keeps failing, contact support and reference this dispute.",
  },
};

const FAILURE_FALLBACK = {
  title: "We couldn\u2019t finish building this pack",
  body:
    "Something went wrong while assembling the evidence pack. " +
    "This is a system issue, not a missing-evidence issue. " +
    "Try rebuilding. If it keeps failing, contact support.",
};

/* ── Evidence Tab ── */

export default function EvidenceTab({ workspace }: { workspace: Workspace }) {
  const { data, clientState, derived, actions } = workspace;
  const tEvidence = useTranslations("disputes.evidence");
  const [letterOpen, setLetterOpen] = useState(false);

  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Scroll-to-focus
  useEffect(() => {
    if (!clientState.focusField) return;
    const el = itemRefs.current.get(clientState.focusField);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => actions.clearFocus(), 1200);
    return () => clearTimeout(timer);
  }, [clientState.focusField, actions]);

  if (!data) return null;

  // System failure short-circuit. When the build itself failed (e.g.,
  // order fetch from Shopify failed), the rest of this tab — argument
  // map, evidence categories, defense letter — is meaningless. Render
  // a single banner that names the system-level cause and offers a
  // retry. Never tell the merchant they're "missing evidence" when we
  // never finished the build in the first place.
  if (derived.isFailed) {
    const copy = (derived.failureCode && FAILURE_COPY[derived.failureCode]) || FAILURE_FALLBACK;
    return (
      <BlockStack gap="400">
        <Banner tone="critical" title={copy.title}>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">{copy.body}</Text>
            <InlineStack gap="200">
              <Button
                variant="primary"
                loading={clientState.loading || clientState.retrying}
                disabled={clientState.retrying}
                onClick={() => { void actions.generatePack(); }}
              >
                Retry build
              </Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      </BlockStack>
    );
  }

  const { argumentMap, rebuttalDraft } = data;
  const { categories, missingItems, whyWins, effectiveChecklist } = derived;
  const readOnly = derived.isReadOnly;

  const strengthKey = derived.caseStrength.overall;
  const outcome = outcomeFromStrength(strengthKey);

  const topGap = missingItems[0];
  const recommendation: string = (() => {
    if (readOnly) {
      return "No further action — your case has been submitted. Wait for the bank\u2019s response.";
    }
    if (strengthKey === "strong") {
      return "Submit as is — your evidence is ready to defend this charge.";
    }
    if (strengthKey === "moderate") {
      return topGap
        ? `Submit as is, or add ${friendlyLabel(topGap.field, topGap.label).toLowerCase()} to lift the case further.`
        : "Submit as is, or add one more piece of evidence to lift the case further.";
    }
    return topGap
      ? `Add ${friendlyLabel(topGap.field, topGap.label).toLowerCase()} before submitting \u2014 the case is unlikely to win as-is.`
      : "Strengthen the evidence before submitting \u2014 the case is unlikely to win as-is.";
  })();

  const summarySection = rebuttalDraft?.sections.find((s) => s.type === "summary");
  const summaryExcerpt = summarySection?.text?.trim() ?? null;

  // Strongest counterclaim title — used as the "Our defense" headline in the
  // claim-vs-defense card. Falls back to the first counterclaim, then to a
  // safe generic if argumentMap exists but has no counterclaims.
  const defenseTitle: string | null = (() => {
    if (!argumentMap || argumentMap.counterclaims.length === 0) return null;
    const ranked = [...argumentMap.counterclaims].sort((a, b) => {
      const r = (s: string) => (s === "strong" ? 0 : s === "moderate" ? 1 : 2);
      return r(a.strength) - r(b.strength);
    });
    return ranked[0]?.title ?? null;
  })();

  return (
    <BlockStack gap="400">
      {/* Strength legend — quick read of what Strong vs Supporting mean.
          Pure presentation; no data wiring. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          padding: "0 4px",
          fontSize: 12,
          color: "#6D7175",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: "#D1FAE5",
              color: "#065F46",
              lineHeight: 1.4,
            }}
          >
            Strong
          </span>
          <span>Direct proof of authorization or delivery</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: "#FEF3C7",
              color: "#92400E",
              lineHeight: 1.4,
            }}
          >
            Supporting
          </span>
          <span>Reinforces transaction legitimacy</span>
        </div>
      </div>

      {/* Claim vs defense — surfaces argumentMap.issuerClaim.text on the
          left (red) and the strongest counterclaim title on the right
          (green). Renders only when argumentMap is populated. */}
      {argumentMap && defenseTitle && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          <div
            style={{
              background: "#FEF2F2",
              border: "2px solid #FCA5A5",
              borderRadius: 8,
              padding: 20,
            }}
          >
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#991B1B",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: 0,
                marginBottom: 8,
              }}
            >
              Customer claim
            </p>
            <p
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#7F1D1D",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {argumentMap.issuerClaim.text}
            </p>
          </div>
          <div
            style={{
              background: "#F0FDF4",
              border: "2px solid #86EFAC",
              borderRadius: 8,
              padding: 20,
            }}
          >
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#065F46",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: 0,
                marginBottom: 8,
              }}
            >
              Our defense
            </p>
            <p
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#065F46",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {defenseTitle}
            </p>
          </div>
        </div>
      )}

      {/* 1. TOP SUMMARY — outcome + recommendation */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: 20,
          boxShadow: "0 1px 2px 0 rgba(22, 29, 37, 0.05)",
        }}
      >
        <BlockStack gap="400">
          <InlineStack gap="300" blockAlign="center" wrap>
            <BlockStack gap="050">
              <Text as="p" variant="bodySm" tone="subdued">Likely outcome</Text>
              <Badge tone={outcome.tone}>{outcome.label}</Badge>
            </BlockStack>
          </InlineStack>

          <BlockStack gap="100">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {`Recommendation: ${recommendation}`}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {EVIDENCE_EVALUATION_HELPER}
            </Text>
          </BlockStack>

          {whyWins.strengths.length > 0 && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">Key strengths</Text>
              <BlockStack gap="050">
                {whyWins.strengths.slice(0, 3).map((s) => (
                  <InlineStack key={s.counterclaimId + s.text} gap="200" blockAlign="start" wrap={false}>
                    <Text as="span" variant="bodyMd" tone="success">{"\u2713"}</Text>
                    <Text as="p" variant="bodyMd">{s.text}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          )}

          {missingItems.length > 0 && strengthKey !== "strong" && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">Key gaps</Text>
              <BlockStack gap="050">
                {missingItems.slice(0, 3).map((m) => (
                  <InlineStack key={m.field} gap="200" blockAlign="start" wrap={false}>
                    <Text as="span" variant="bodyMd" tone="subdued">{"\u25CB"}</Text>
                    <Text as="p" variant="bodyMd">{impactSentence(m.field)}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          )}
        </BlockStack>
      </div>

      {/* 2. WHAT SUPPORTS THIS CASE — only actual contributing signals.
            Shows strong + moderate counterclaims; insufficient / weak are
            excluded. Never contains missing-item rows or red treatment. */}
      {argumentMap && (() => {
        const supporting = argumentMap.counterclaims
          .filter((c) => c.strength === "strong" || c.strength === "moderate")
          .sort((a, b) => {
            const r = (s: string) => (s === "strong" ? 0 : s === "moderate" ? 1 : 2);
            return r(a.strength) - r(b.strength);
          });
        return (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: 20,
              boxShadow: "0 1px 2px 0 rgba(22, 29, 37, 0.05)",
            }}
          >
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">What supports this case</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {argumentMap.issuerClaim.text}
              </Text>

              {supporting.length === 0 && (
                <Text as="p" variant="bodyMd" tone="subdued">
                  This case is currently evaluated based on available transaction
                  data. Additional supporting signals are not required for a
                  successful outcome.
                </Text>
              )}

              {supporting.map((claim, i) => (
                <ArgumentBlock
                  key={claim.id}
                  claim={claim}
                  defaultOpen={i < 2}
                  onTagClick={(field) => actions.navigateToEvidence(field)}
                />
              ))}

              {/* Missing items intentionally omitted here — this
                  section only names what supports the case. Gaps
                  live in the Evidence inventory card below. */}
            </BlockStack>
          </div>
        );
      })()}

      {/* 3. EVIDENCE INVENTORY — completeness, separated from strength */}
      {effectiveChecklist.length > 0 && (() => {
        // "Included" must match the argument layer's truth: a row is only
        // cited as supporting defense evidence when the field appears in
        // argumentMap.counterclaims[].supporting. Collected-but-not-cited
        // signals (e.g. IP & Location Check with a location mismatch) are
        // filtered out of the inventory so Overview and Evidence agree.
        const citedFields = new Set<string>(
          (argumentMap?.counterclaims ?? []).flatMap((c) =>
            c.supporting.map((s) => s.field),
          ),
        );
        const isCollectedUncited = (c: EvidenceItemWithStrength): boolean =>
          (c.status === "available" || c.status === "waived") &&
          !citedFields.has(c.field);
        const visible = effectiveChecklist.filter(
          (c) => c.status !== "unavailable" && !isCollectedUncited(c),
        );
        const included = visible.filter((c) => c.status === "available" || c.status === "waived");
        const recommended = visible.filter(
          (c) => c.status === "missing" && c.priority !== "optional",
        );
        const optional = visible.filter(
          (c) => c.status === "missing" && c.priority === "optional",
        );

        return (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: 20,
              boxShadow: "0 1px 2px 0 rgba(22, 29, 37, 0.05)",
            }}
          >
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Evidence inventory</Text>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {`Included: ${included.length} of ${visible.length} recommended items`}
              </Text>

              {included.length > 0 && (
                <BlockStack gap="200">
                  {included.map((item) => {
                    const row = evidenceRowStatus(item);
                    return (
                      <InlineStack
                        key={`inv-inc-${item.field}`}
                        align="space-between"
                        blockAlign="start"
                        gap="200"
                        wrap
                      >
                        <BlockStack gap="050">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {friendlyLabel(item.field, item.label)}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {WHY_TEXT[item.field] ?? "Strengthens the overall response."}
                          </Text>
                        </BlockStack>
                        <Badge tone={row.tone}>{row.label}</Badge>
                      </InlineStack>
                    );
                  })}
                </BlockStack>
              )}

              {recommended.length > 0 && (
                <BlockStack gap="200">
                  {recommended.map((item) => {
                    const row = evidenceRowStatus(item);
                    return (
                      <InlineStack
                        key={`inv-rec-${item.field}`}
                        align="space-between"
                        blockAlign="start"
                        gap="200"
                        wrap
                      >
                        <BlockStack gap="050">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {friendlyLabel(item.field, item.label)}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {WHY_TEXT[item.field] ?? "Would strengthen the overall response."}
                          </Text>
                        </BlockStack>
                        <Badge tone={row.tone}>{row.label}</Badge>
                      </InlineStack>
                    );
                  })}
                </BlockStack>
              )}

              {optional.length > 0 && (
                <BlockStack gap="200">
                  {optional.map((item) => {
                    const row = evidenceRowStatus(item);
                    return (
                      <InlineStack
                        key={`inv-opt-${item.field}`}
                        align="space-between"
                        blockAlign="start"
                        gap="200"
                        wrap
                      >
                        <BlockStack gap="050">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {friendlyLabel(item.field, item.label)}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {WHY_TEXT[item.field] ?? "Supportive, not required."}
                          </Text>
                        </BlockStack>
                        <Badge tone={row.tone}>{row.label}</Badge>
                      </InlineStack>
                    );
                  })}
                </BlockStack>
              )}
            </BlockStack>
          </div>
        );
      })()}

      {/* 4. DEFENSE LETTER — collapsed by default */}
      {rebuttalDraft && (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            padding: 20,
            boxShadow: "0 1px 2px 0 rgba(22, 29, 37, 0.05)",
          }}
        >
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Text as="h3" variant="headingMd">{tEvidence("defenseLetterTitle")}</Text>
              <Button
                variant="plain"
                ariaExpanded={letterOpen}
                ariaControls="defense-letter-full"
                disclosure={letterOpen ? "up" : "down"}
                onClick={() => setLetterOpen((v) => !v)}
              >
                {letterOpen ? tEvidence("hideFullDefenseLetter") : tEvidence("viewFullDefenseLetter")}
              </Button>
            </InlineStack>

            {summaryExcerpt && !letterOpen && (
              <Text as="p" variant="bodyMd" tone="subdued">
                {summaryExcerpt.length > 220 ? `${summaryExcerpt.slice(0, 220).trim()}\u2026` : summaryExcerpt}
              </Text>
            )}

            <Collapsible
              open={letterOpen}
              id="defense-letter-full"
              transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
              expandOnPrint
            >
              <BlockStack gap="300">
                {rebuttalDraft.sections.map((section) => (
                  <BlockStack key={section.id} gap="100">
                    <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                      {section.type === "summary" ? tEvidence("defenseSectionSummary") :
                       section.type === "conclusion" ? tEvidence("defenseSectionConclusion") :
                       argumentMap?.counterclaims.find((c) => c.id === section.claimId)?.title ?? tEvidence("defenseSectionArgument")}
                    </Text>
                    <Text as="p" variant="bodyMd">{section.text}</Text>
                    {section.evidenceRefs.length > 0 && (
                      <InlineStack gap="100" wrap>
                        {Array.from(new Set(section.evidenceRefs)).map((ref) => (
                          <span
                            key={ref}
                            className={`${styles.evidenceTag} ${styles.evidenceTagAvailable}`}
                            onClick={() => actions.navigateToEvidence(ref)}
                          >
                            {friendlyLabel(ref, ref.replace(/_/g, " "))}
                          </span>
                        ))}
                      </InlineStack>
                    )}
                  </BlockStack>
                ))}
              </BlockStack>
            </Collapsible>
          </BlockStack>
        </div>
      )}

      {/* 4. EVIDENCE CATEGORIES — proof, unchanged */}
      {categories.map((cat) => (
        <EvidenceCategorySection
          key={cat.category.key}
          category={cat.category}
          items={cat.items}
          expanded={clientState.expandedCategories.has(cat.category.key)}
          onToggle={() => {
            const next = new Set(clientState.expandedCategories);
            if (next.has(cat.category.key)) next.delete(cat.category.key);
            else next.add(cat.category.key);
            actions.navigateToEvidence(cat.items[0]?.field ?? cat.category.fields[0]);
          }}
          focusField={clientState.focusField}
          uploadingField={clientState.uploadingField}
          failedFields={clientState.failedFields}
          onUpload={actions.uploadEvidence}
          onWaive={actions.waiveItem}
          onUnwaive={actions.unwaiveItem}
          readOnly={readOnly}
          itemRefs={itemRefs}
        />
      ))}

    </BlockStack>
  );
}

/* ── Evidence Category Section ── */

function EvidenceCategorySection({
  category,
  items,
  expanded,
  onToggle,
  focusField,
  uploadingField,
  failedFields,
  onUpload,
  onWaive,
  onUnwaive,
  readOnly,
  itemRefs,
}: {
  category: { key: string; label: string };
  items: EvidenceItemWithStrength[];
  expanded: boolean;
  onToggle: () => void;
  focusField: string | null;
  uploadingField: string | null;
  failedFields: Map<string, string>;
  onUpload: (field: string, files: File[]) => Promise<void>;
  onWaive: (field: string, reason: WaiveReason) => void;
  onUnwaive: (field: string) => void;
  readOnly: boolean;
  itemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}) {
  const availableCount = items.filter((i) => i.status === "available" || i.status === "waived").length;
  const HeaderIcon = CATEGORY_ICON[category.key] ?? FileIcon;

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        boxShadow: "0 1px 2px 0 rgba(22, 29, 37, 0.05)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`cat-${category.key}`}
        style={{
          width: "100%",
          background: "transparent",
          border: 0,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            color: "#005BD3",
            flexShrink: 0,
            display: "inline-flex",
          }}
        >
          <Icon source={HeaderIcon} />
        </span>
        <span
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#202223",
              lineHeight: 1.4,
            }}
          >
            {category.label}
          </span>
          <span
            style={{
              padding: "2px 10px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: "#F1F2F4",
              color: "#4B5563",
              whiteSpace: "nowrap",
            }}
          >
            {`${availableCount}/${items.length}`}
          </span>
        </span>
        <span style={{ width: 20, height: 20, color: "#6D7175", display: "inline-flex", flexShrink: 0 }}>
          <Icon source={expanded ? ChevronUpIcon : ChevronDownIcon} />
        </span>
      </button>
      <Collapsible open={expanded} id={`cat-${category.key}`}>
        <div style={{ padding: "0 20px 16px", borderTop: "1px solid #E1E3E5" }}>
          <BlockStack gap="200">
            <div style={{ paddingTop: 12 }} />
            {items.map((item) => (
              <EvidenceItemInline
                key={item.field}
                item={item}
                focusField={focusField}
                uploading={uploadingField === item.field}
                error={failedFields.get(item.field)}
                onUpload={onUpload}
                onWaive={onWaive}
                onUnwaive={onUnwaive}
                readOnly={readOnly}
                refCallback={(el) => {
                  if (el) itemRefs.current.set(item.field, el);
                  else itemRefs.current.delete(item.field);
                }}
              />
            ))}
          </BlockStack>
        </div>
      </Collapsible>
    </div>
  );
}

/* ── Evidence Item Inline ── */

function EvidenceItemInline({
  item,
  focusField,
  uploading,
  error,
  onUpload,
  onWaive,
  onUnwaive,
  readOnly,
  refCallback,
}: {
  item: EvidenceItemWithStrength;
  focusField: string | null;
  uploading: boolean;
  error?: string;
  onUpload: (field: string, files: File[]) => Promise<void>;
  onWaive: (field: string, reason: WaiveReason) => void;
  onUnwaive: (field: string) => void;
  readOnly: boolean;
  refCallback: (el: HTMLDivElement | null) => void;
}) {
  const [showUpload, setShowUpload] = useState(focusField === item.field);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [showContent, setShowContent] = useState(false);

  const highlighted = focusField === item.field;

  const isSystemDerived = item.collectionType === "auto" || item.collectionType === "conditional_auto";
  const rowClass =
    item.status === "available" ? styles.evidenceRowAvailable :
    item.status === "waived" ? styles.evidenceRowAvailable :
    item.status === "unavailable" ? styles.evidenceRowAvailable :
    isSystemDerived ? styles.evidenceRowAvailable :
    item.priority === "critical" ? styles.evidenceRowMissing :
    styles.evidenceRowMissingRecommended;

  const handleDrop = useCallback(
    async (_files: File[], accepted: File[]) => {
      if (accepted.length === 0) return;
      setShowUpload(false);
      await onUpload(item.field, accepted);
    },
    [item.field, onUpload],
  );

  const waiveActions = Object.entries(WAIVE_REASON_LABELS).map(([reason, label]) => ({
    content: label,
    onAction: () => { setWaiveOpen(false); onWaive(item.field, reason as WaiveReason); },
  }));

  return (
    <div ref={refCallback} className={`${rowClass} ${highlighted ? styles.highlighted : ""}`}>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="start" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            <Icon
              source={
                item.status === "available" ? CheckCircleIcon :
                item.status === "waived" ? MinusCircleIcon :
                (item.collectionType === "auto" || item.collectionType === "conditional_auto")
                  ? MinusCircleIcon :
                item.priority === "critical" ? AlertTriangleIcon :
                AlertTriangleIcon
              }
              tone={
                item.status === "available" ? "success" :
                item.status === "waived" ? "subdued" :
                (item.collectionType === "auto" || item.collectionType === "conditional_auto")
                  ? "subdued" :
                "caution"
              }
            />
            <Text as="span" variant="bodyMd" fontWeight="semibold">{item.label}</Text>
            {(() => {
              const row = evidenceRowStatus(item);
              return <Badge tone={row.tone}>{row.label}</Badge>;
            })()}
            {(item.status === "available" || item.status === "waived") && (() => {
              const cat = categoryFor({ fieldKey: item.field, payload: item.payload });
              const badge = categoryBadge(cat);
              return <Badge tone={badge.tone}>{badge.label}</Badge>;
            })()}
          </InlineStack>

          <InlineStack gap="200">
            {item.content && (
              <Button size="slim" variant="plain" onClick={() => setShowContent((v) => !v)}>
                {showContent ? "Hide" : "Preview"}
              </Button>
            )}
            {item.status === "missing" && !readOnly && !uploading && item.collectionType !== "auto" && (
              <>
                <Button size="slim" onClick={() => setShowUpload((v) => !v)}>
                  {error ? "Retry" : "Upload"}
                </Button>
                <Popover
                  active={waiveOpen}
                  activator={
                    <Button size="slim" variant="plain" onClick={() => setWaiveOpen((v) => !v)}>
                      Skip
                    </Button>
                  }
                  onClose={() => setWaiveOpen(false)}
                >
                  <ActionList items={waiveActions} />
                </Popover>
              </>
            )}
            {item.status === "waived" && !readOnly && (
              <Button size="slim" variant="plain" onClick={() => onUnwaive(item.field)}>
                Undo
              </Button>
            )}
            {uploading && <Spinner size="small" />}
          </InlineStack>
        </InlineStack>

        <Text as="p" variant="bodySm" tone="subdued">
          {WHY_TEXT[item.field] ?? "Strengthens your dispute response"}
        </Text>

        {error && (
          <Banner tone="critical" hideIcon>
            <Text as="p" variant="bodySm">{error}</Text>
          </Banner>
        )}

        {/* Content preview */}
        {showContent && item.content && (
          <Collapsible open={showContent} id={`content-${item.field}`}>
            {renderContent(item.field, item.content)}
          </Collapsible>
        )}

        {/* Upload zone */}
        {showUpload && !readOnly && item.status === "missing" && (
          <Collapsible open={showUpload} id={`upload-${item.field}`}>
            <DropZone
              onDrop={handleDrop}
              allowMultiple={false}
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
              variableHeight
            >
              <DropZone.FileUpload actionHint="Drop a file or click to upload" />
            </DropZone>
          </Collapsible>
        )}
      </BlockStack>
    </div>
  );
}

/* ── Argument Block (Figma `shopify-dispute-detail` lines 302-415) ── *
 *
 * One block per counterclaim. Header carries the leading icon + bold
 * title + flat strength pill + chevron. Body lists the supporting
 * evidence as bullet rows, click-through to the field via
 * `actions.navigateToEvidence`. State is local — collapsed by default
 * past the second block (top 2 open, rest collapsed) so the merchant
 * can scan strong claims first without an explosion of vertical space.
 *
 * No new logic: same source data (`CounterclaimNode.supporting[]`),
 * same navigation. Replaces the prior flat tag list with a Figma-style
 * collapsible card.
 */
function ArgumentBlock({
  claim,
  defaultOpen,
  onTagClick,
}: {
  claim: CounterclaimNode;
  defaultOpen: boolean;
  onTagClick: (field: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const supportingFields = claim.supporting.map((s) => s.field);
  const IconSrc = counterclaimIcon(supportingFields);
  const pill = strengthPillStyle(claim.strength);

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`arg-block-${claim.id}`}
        style={{
          width: "100%",
          background: "transparent",
          border: 0,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            color: "#005BD3",
            flexShrink: 0,
            display: "inline-flex",
          }}
        >
          <Icon source={IconSrc} />
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 14,
            fontWeight: 700,
            color: "#202223",
            lineHeight: 1.4,
          }}
        >
          {claim.title}
        </span>
        <span
          style={{
            padding: "2px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            background: pill.bg,
            color: pill.color,
            whiteSpace: "nowrap",
          }}
        >
          {pill.label}
        </span>
        <span style={{ width: 20, height: 20, color: "#6D7175", display: "inline-flex", flexShrink: 0 }}>
          <Icon source={open ? ChevronUpIcon : ChevronDownIcon} />
        </span>
      </button>
      <Collapsible open={open} id={`arg-block-${claim.id}`}>
        <div style={{ padding: "0 20px 16px", borderTop: "1px solid #E1E3E5" }}>
          {claim.supporting.length === 0 ? (
            <p style={{ fontSize: 13, color: "#6D7175", margin: "12px 0 0" }}>
              No supporting evidence cited yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12 }}>
              {claim.supporting.map((s) => (
                <button
                  key={s.field}
                  type="button"
                  onClick={() => onTagClick(s.field)}
                  style={{
                    appearance: "none",
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      color: s.status === "available" ? "#059669" : "#8C9196",
                      flexShrink: 0,
                      marginTop: 2,
                      display: "inline-flex",
                    }}
                  >
                    <Icon source={s.status === "available" ? CheckCircleIcon : MinusCircleIcon} />
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      color: "#202223",
                      lineHeight: 1.4,
                      textDecoration: "underline",
                      textDecorationColor: "transparent",
                      transition: "text-decoration-color 100ms",
                    }}
                  >
                    {friendlyLabel(s.field, s.label)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  );
}
