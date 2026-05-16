/**
 * DefencePackageHtmlView — Polaris-rendered, web-native version of the
 * Defence Package PDF.
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

import {
  BlockStack,
  Box,
  Card,
  Divider,
  InlineStack,
  Text,
} from "@shopify/polaris";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  EvidenceFactCategory,
  NarrativeSection,
  NarrativeSectionKey,
  PackageMode,
} from "@/lib/defence/types";

// ─── Section thesis library (mirrors PDF) ─────────────────────────────
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

const VISA_10_4_FRAUD_THESIS: Record<NarrativeSectionKey, string> = {
  executiveSummary:
    "This representment addresses a Visa 10.4 (Other Fraud — Card Absent) chargeback. The approved evidence — payment authentication, billing alignment, and the customer's documented engagement — supports that the transaction was authorised by the cardholder.",
  transactionOverviewArgument:
    "The transaction was successfully authorised and captured using authentication factors specific to the cardholder. The payment record is internally consistent and aligned with cardholder-supplied data.",
  chronologyArgument:
    "The timeline of events records a deliberate purchase sequence — site engagement, order placement, successful authorisation, and order confirmation — each step traceable to the cardholder's session.",
  paymentAuthenticationArgument:
    "Authentication metrics align with a cardholder-initiated transaction. The verification results reflect data accessible to the legitimate cardholder.",
  fulfillmentArgument:
    "Fulfilment and access evidence corroborates that the order was processed and the customer received the agreed delivery or access path.",
  communicationArgument:
    "The documented communication record evidences direct cardholder engagement with the merchant before and around the disputed transaction.",
  policyArgument:
    "The merchant's published policies and the customer's acceptance record are documented and were available at the point of purchase.",
  manualEvidenceArgument:
    "Supplementary documentation provided by the merchant supports the foregoing argument.",
  conclusion:
    "Based on the approved evidence above, the merchant respectfully requests that the chargeback be reversed and the funds returned.",
};

function thesisFor(
  sectionKey: NarrativeSectionKey,
  moduleKey: string | null | undefined,
  mode: PackageMode,
): string | null {
  // In full mode, the LLM body stands on its own. The thesis box only
  // renders in narrow mode (mirrors the PDF refinement).
  if (mode === "full") return null;
  if (moduleKey === "visa_10_4_fraud") return VISA_10_4_FRAUD_THESIS[sectionKey];
  return GENERIC_THESIS[sectionKey];
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
  merchantName?: string | null;
  shopName?: string | null;
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

const SECTION_TITLES: Record<NarrativeSectionKey, string> = {
  executiveSummary: "Executive Summary",
  transactionOverviewArgument: "Transaction Overview",
  chronologyArgument: "Chronology of Events",
  paymentAuthenticationArgument: "Payment Authentication",
  fulfillmentArgument: "Fulfillment, Delivery & Access",
  communicationArgument: "Customer Communication",
  policyArgument: "Policy Disclosure",
  manualEvidenceArgument: "Supplementary Merchant Evidence",
  conclusion: "Conclusion",
};

const SECTION_ORDER: NarrativeSectionKey[] = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
];

const CATEGORY_ORDER: EvidenceFactCategory[] = [
  "payment_authentication",
  "payment_auth",
  "billing_match",
  "delivery_proof",
  "shipping_tracking",
  "digital_access_log",
  "service_access",
  "customer_communication",
  "communication",
  "prior_customer_history",
  "account_history",
  "order_record",
  "policy_acceptance",
  "policy_refund",
  "policy_shipping",
  "policy_cancellation",
  "refund_record",
  "subscription_terms",
  "duplicate_explanation",
  "manual_evidence",
] as EvidenceFactCategory[];

function buildEvidenceBasis(facts: EvidenceFact[]): Array<{ label: string; value: string }> {
  return facts
    .filter((f) => f.bankEligible && f.includeInBankNarrative && !f.submissionRisk)
    .sort((a, b) => {
      const ra = CATEGORY_ORDER.indexOf(a.category as EvidenceFactCategory);
      const rb = CATEGORY_ORDER.indexOf(b.category as EvidenceFactCategory);
      const ra2 = ra === -1 ? 999 : ra;
      const rb2 = rb === -1 ? 999 : rb;
      if (ra2 !== rb2) return ra2 - rb2;
      return a.label.localeCompare(b.label);
    })
    .map((f) => ({ label: f.label, value: renderFactValue(f) }));
}

function renderFactValue(fact: EvidenceFact): string {
  const v = fact.value as Record<string, unknown>;
  switch (fact.category) {
    case "payment_authentication":
    case "payment_auth": {
      const parts: string[] = [];
      if (typeof v.avsResult === "string") parts.push(`AVS ${v.avsResult}`);
      if (typeof v.cvvResult === "string") parts.push(`CVV ${v.cvvResult}`);
      if (v.threeDS === true) parts.push("3DS authenticated");
      return parts.length ? parts.join(" • ") : "Authenticated";
    }
    case "billing_match":
      return v.match === true ? "MATCH" : "Confirmed";
    case "delivery_proof":
    case "shipping_tracking": {
      const proof = typeof v.proofType === "string" ? v.proofType : null;
      const at = typeof v.deliveredAt === "string" ? v.deliveredAt : null;
      if (proof === "signature_confirmed") return at ? `Signature on delivery, ${at}` : "Signature on delivery";
      if (proof === "delivered_confirmed") return at ? `Delivered ${at}` : "Delivered";
      if (proof === "delivered_unverified") return "In transit / handed to carrier";
      return "Confirmed";
    }
    case "customer_communication":
    case "communication": {
      const at = typeof v.lastMessageAt === "string" ? v.lastMessageAt : null;
      return v.customerConfirmsOrder === true
        ? at
          ? `Customer confirmed order, ${at}`
          : "Customer confirmed order"
        : at
          ? `Communication on file, last ${at}`
          : "Communication on file";
    }
    case "prior_customer_history":
    case "account_history": {
      const count = typeof v.priorOrderCount === "number" ? (v.priorOrderCount as number) : 0;
      return count > 0 ? `${count} prior order${count === 1 ? "" : "s"}` : "Confirmed";
    }
    case "policy_refund":
    case "policy_shipping":
    case "policy_cancellation":
    case "policy_acceptance":
      return v.acceptedAtCheckout === true ? "Accepted at checkout" : "On record";
    case "order_record":
      return typeof v.fulfillmentStatus === "string"
        ? `Order on record (${v.fulfillmentStatus})`
        : "Order on record";
    case "refund_record":
      return v.refundStatus === "processed" ? "Refund processed" : "On record";
    case "duplicate_explanation":
      return "Distinct transaction";
    case "manual_evidence":
      return typeof v.fileType === "string" ? `Uploaded (${v.fileType})` : "Uploaded";
    default:
      return "Confirmed";
  }
}

interface ChronologyEvent {
  at: string;
  text: string;
}

function chronologyEvents(
  dispute: DisputeContextLike | undefined,
  facts: EvidenceFact[],
): ChronologyEvent[] {
  const events: ChronologyEvent[] = [];
  if (dispute?.transactionDate) {
    events.push({
      at: dispute.transactionDate,
      text: `Order placed on the merchant's storefront${dispute.orderName ? ` (${dispute.orderName})` : ""}.`,
    });
    events.push({
      at: dispute.transactionDate,
      text: `Authorisation captured against the cardholder's ${dispute.cardNetwork ?? "card"}${dispute.cardLast4 ? ` ending in ${dispute.cardLast4}` : ""}.`,
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

// ─── Component ───────────────────────────────────────────────────────

export function DefencePackageHtmlView({ row, dispute }: Props) {
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
  const moduleKey = row.reason_code_module;

  const evidenceBasis = buildEvidenceBasis(facts);
  const chrono = chronologyEvents(dispute, facts);
  const orderRecord = facts.find((f) => f.category === "order_record");
  const lineItems =
    Array.isArray((orderRecord?.value as Record<string, unknown> | undefined)?.lineItems)
      ? ((orderRecord!.value as Record<string, unknown>).lineItems as Array<{
          description: string;
          quantity: number;
          price: string;
        }>)
      : [];

  const fulfillmentFallbackVisible =
    omitted.has("fulfillmentArgument") &&
    (typeof dispute?.fulfillmentStatus === "string" && dispute.fulfillmentStatus.toUpperCase() === "FULFILLED");

  const caseRows: Array<[string, string]> = [
    ["Dispute ID", disputeIdShort(dispute?.disputeGid)],
    ["Merchant", dispute?.merchantName ?? dispute?.shopName ?? "—"],
    ["Card network", dispute?.cardNetwork ?? "—"],
    ["Transaction date", fmtIso(dispute?.transactionDate)],
    ["Disputed amount", fmtAmount(dispute?.amount, dispute?.currencyCode)],
    ["Reason code", dispute?.reasonCodeDisplay ?? dispute?.reason ?? "—"],
    ["Order ID", dispute?.orderName ?? "—"],
    ["Cardholder name", dispute?.cardholderName ?? "—"],
    ["Card (last 4)", dispute?.cardLast4 ?? "—"],
    ["Payment gateway", dispute?.paymentGateway ?? "—"],
    ["Financial status", dispute?.financialStatus ?? "—"],
    ["Fulfillment status", dispute?.fulfillmentStatus ?? "—"],
  ];

  return (
    <Card padding="500">
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="subdued">
            CHARGEBACK REPRESENTMENT
          </Text>
          <Text as="h2" variant="headingLg">
            Complete Defence Package
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            v{row.version} • {mode === "narrow" ? "Narrow" : "Full"} package • Prepared for{" "}
            {dispute?.merchantName ?? dispute?.shopName ?? "the merchant"}
          </Text>
        </BlockStack>

        <Divider />

        {/* Case Details */}
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">Case Details</Text>
          <Box
            background="bg-surface-secondary"
            borderRadius="200"
            padding="300"
          >
            <BlockStack gap="100">
              {caseRows.map(([k, v]) => (
                <InlineStack key={k} gap="400" align="space-between" wrap={false}>
                  <Text as="span" variant="bodySm" tone="subdued">{k}</Text>
                  <Text as="span" variant="bodySm">{v}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Box>
        </BlockStack>

        {/* LLM-authored sections */}
        {SECTION_ORDER.map((key) => {
          if (key === "chronologyArgument") {
            // Chronology has its own bullet list below the paragraph.
            const section = narrative[key];
            if (omitted.has(key) || !section.text.trim()) return null;
            const thesis = thesisFor(key, moduleKey, mode);
            return (
              <BlockStack key={key} gap="200">
                <Text as="h3" variant="headingMd">{SECTION_TITLES[key]}</Text>
                {thesis && <ThesisBox text={thesis} />}
                <Text as="p" variant="bodyMd">{section.text}</Text>
                {chrono.length > 0 && (
                  <BlockStack gap="100">
                    {chrono.map((e, i) => (
                      <InlineStack key={`${e.at}-${i}`} gap="200" wrap={false}>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {e.at}
                        </Text>
                        <Text as="span" variant="bodySm">{e.text}</Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            );
          }

          if (key === "fulfillmentArgument") {
            // Either the LLM-authored body, or the minimal deterministic
            // fallback when only fulfillmentStatus=FULFILLED is on file.
            const section = narrative[key];
            const hasBody = !omitted.has(key) && section.text.trim();
            if (hasBody) {
              const thesis = thesisFor(key, moduleKey, mode);
              return (
                <BlockStack key={key} gap="200">
                  <Text as="h3" variant="headingMd">{SECTION_TITLES[key]}</Text>
                  {thesis && <ThesisBox text={thesis} />}
                  <Text as="p" variant="bodyMd">{section.text}</Text>
                </BlockStack>
              );
            }
            if (fulfillmentFallbackVisible) {
              return (
                <BlockStack key={key} gap="200">
                  <Text as="h3" variant="headingMd">{SECTION_TITLES[key]}</Text>
                  <Text as="p" variant="bodyMd">
                    The merchant&apos;s order record marks the order as fulfilled. No
                    separate delivery, access-use, or service-completion claim is made
                    in this section unless supported by approved evidence.
                  </Text>
                </BlockStack>
              );
            }
            return null;
          }

          if (key === "conclusion") {
            // Render the conclusion with a framed call-out.
            const section = narrative[key];
            if (omitted.has(key) || !section.text.trim()) return null;
            const thesis = thesisFor(key, moduleKey, mode);
            return (
              <BlockStack key={key} gap="200">
                <Text as="h3" variant="headingMd">{SECTION_TITLES[key]}</Text>
                {thesis && <ThesisBox text={thesis} />}
                <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                  <Text as="p" variant="bodyMd">{section.text}</Text>
                </Box>
              </BlockStack>
            );
          }

          return (
            <SectionBlock
              key={key}
              title={SECTION_TITLES[key]}
              thesis={thesisFor(key, moduleKey, mode)}
              section={narrative[key]}
              omitted={omitted.has(key)}
            />
          );
        })}

        {/* Order Line Items (deterministic) */}
        {lineItems.length > 0 && (
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Order Line Items</Text>
            <BlockStack gap="100">
              {lineItems.map((it, i) => (
                <InlineStack key={i} gap="400" align="space-between" wrap={false}>
                  <Text as="span" variant="bodySm">
                    {it.description} (×{it.quantity})
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold">{it.price}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        )}

        {/* Evidence Basis (deterministic, from approved facts) */}
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">Evidence Basis</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Approved bank-facing facts used to ground this package.
          </Text>
          {evidenceBasis.length === 0 ? (
            <Text as="p" variant="bodyMd">(No bank-eligible facts available.)</Text>
          ) : (
            <Box background="bg-surface-secondary" borderRadius="200" padding="300">
              <BlockStack gap="100">
                {evidenceBasis.map((r, i) => (
                  <InlineStack key={i} gap="400" align="space-between" wrap={false}>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{r.label}</Text>
                    <Text as="span" variant="bodySm">{r.value}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </Box>
          )}
        </BlockStack>

        {/* Package Metadata block intentionally NOT rendered here.
            That section (Package ID / Evidence hash / Prompt family /
            Prompt version / Reason-code module / LLM model / Generated)
            is admin/operator audit data and must not appear on the
            merchant-facing embedded review page — same content surfaces
            in /admin/defence-package/runs/[id] for ops. Removed
            2026-05-16 after operator review caught it leaking. */}
      </BlockStack>
    </Card>
  );
}

function SectionBlock({
  title,
  thesis,
  section,
  omitted,
}: {
  title: string;
  thesis: string | null;
  section: NarrativeSection;
  omitted: boolean;
}) {
  if (omitted || !section.text.trim()) return null;
  return (
    <BlockStack gap="200">
      <Text as="h3" variant="headingMd">{title}</Text>
      {thesis && <ThesisBox text={thesis} />}
      <Text as="p" variant="bodyMd">{section.text}</Text>
    </BlockStack>
  );
}

function ThesisBox({ text }: { text: string }) {
  return (
    <Box
      background="bg-surface-secondary"
      borderInlineStartWidth="050"
      borderColor="border-emphasis"
      padding="300"
    >
      <Text as="p" variant="bodySm" tone="subdued">
        {text}
      </Text>
    </Box>
  );
}

// MetaRow helper removed alongside the Package Metadata block — it had
// no other callers.
