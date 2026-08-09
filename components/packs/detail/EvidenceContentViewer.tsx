"use client";

import {
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Icon,
  Divider,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ClockIcon,
  DeliveryIcon,
  NoteIcon,
} from "@shopify/polaris-icons";
import {
  readPaymentVerification,
  type VerificationOutcome,
} from "@/lib/argument/paymentVerification";
import type { AvsNormalizedResult } from "@/lib/argument/avsCodeMap";

/* ── Types ── */

interface EvidencePayload {
  // Order
  orderName?: string;
  createdAt?: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  lineItems?: Array<{
    title: string;
    variant?: string;
    quantity: number;
    total?: string;
    currency?: string;
    sku?: string;
  }>;
  totals?: {
    subtotal?: string;
    shipping?: string;
    tax?: string;
    discounts?: string;
    total?: string;
    refunded?: string;
    currency?: string;
  };
  billingAddress?: {
    city?: string;
    provinceCode?: string;
    countryCode?: string;
    zipPrefix?: string;
  };
  shippingAddress?: {
    city?: string;
    provinceCode?: string;
    countryCode?: string;
    zipPrefix?: string;
  };
  customerTenure?: {
    totalOrders?: number;
    customerSince?: string;
  };

  // Shipping / Fulfillment
  fulfillmentCount?: number;
  overallStatus?: string;
  fulfillments?: Array<{
    status?: string;
    displayStatus?: string;
    createdAt?: string;
    deliveredAt?: string;
    estimatedDeliveryAt?: string;
    tracking?: Array<{
      number?: string;
      url?: string;
      carrier?: string;
    }>;
    items?: Array<{
      title: string;
      quantity: number;
    }>;
  }>;

  // Policy
  policies?: Array<{
    policyType?: string;
    url?: string;
    capturedAt?: string;
    textPreview?: string;
    textLength?: number;
  }>;

  // Comms
  orderNote?: string;
  customerNote?: string;
  buyerAttributes?: Array<{ key: string; value: string }>;
  timelineEvents?: Array<{
    message?: string;
    createdAt?: string;
    source?: string;
  }>;
  summary?: {
    staffNotePresent?: boolean;
    customerNotePresent?: boolean;
    confirmationEventCount?: number;
    merchantCommentCount?: number;
    timelineEventCount?: number;
  };

  // Payment (AVS/CVV)
  avsResultCode?: string;
  cvvResultCode?: string;
  gateway?: string;
  cardCompany?: string;
  lastFour?: string;

  // Refunds
  refunds?: Array<{
    createdAt?: string;
    note?: string;
    amount?: string;
    currency?: string;
  }>;

  // Manual upload
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  storagePath?: string;

  // Catch-all
  [key: string]: unknown;
}

export interface EvidenceItemFull {
  id: string;
  type: string;
  label: string;
  source: string;
  payload: EvidencePayload;
  created_at: string;
}

/* ── Helpers ── */

function formatDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(amount: string | undefined, currency: string | undefined): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(num);
  } catch {
    return `${currency || "$"}${amount}`;
  }
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAddress(addr: { city?: string; provinceCode?: string; countryCode?: string; zipPrefix?: string } | undefined): string {
  if (!addr) return "—";
  const parts = [addr.city, addr.provinceCode, addr.countryCode].filter(Boolean);
  return parts.join(", ") || "—";
}

/** Badge tone from the owner's descriptive bucket — never from a raw code. */
function toneFor(bucket: "match" | "no_match" | "unchecked" | null): "success" | "critical" | undefined {
  if (bucket === "match") return "success";
  if (bucket === "no_match") return "critical";
  return undefined;
}

/**
 * Merchant label from the CANONICAL normalized result (PR-C3).
 *
 * This component used to keep its own AVS code map — `Y: "Full match"`,
 * `A: "Address match only"`, `Z: "ZIP match only"` — a second definition of
 * what the letters mean, living in a viewer. It disagreed with the canonical
 * layer on `Z` (which the grader treats as a non-match) and it knew nothing
 * about the network. The raw code is still SHOWN, for audit; it no longer
 * decides meaning, tone or classification.
 */
function avsLabel(normalized: AvsNormalizedResult, code: string | null): string {
  const words: Record<AvsNormalizedResult, string> = {
    full_match: "Full match",
    street_match: "Street address matched",
    postal_match: "Postal code matched",
    no_match: "No match",
    not_checked: "Not checked by the issuer",
    unavailable: "Result unavailable",
    unknown: "Unrecognised result",
  };
  return code ? `${words[normalized]} (${code})` : words[normalized];
}

function cvvLabel(outcome: VerificationOutcome | null, code: string | null): string {
  if (!outcome || !code) return "—";
  const words: Record<VerificationOutcome, string> = {
    match: "Match",
    no_match: "No match",
    unchecked: "Not checked by the issuer",
  };
  return `${words[outcome]} (${code})`;
}

/* ── Row helper ── */

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <InlineStack gap="200" wrap>
      <div style={{ minWidth: 140 }}>
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
      </div>
      <Text as="span" variant="bodySm">
        {typeof value === "string" ? value : value}
      </Text>
    </InlineStack>
  );
}

/* ── Content renderers ── */

function OrderContent({ payload }: { payload: EvidencePayload }) {
  return (
    <BlockStack gap="300">
      {/* Order header */}
      <BlockStack gap="150">
        {payload.orderName && <DataRow label="Order" value={payload.orderName} />}
        {payload.createdAt && <DataRow label="Placed" value={formatDateTime(payload.createdAt)} />}
        {payload.financialStatus && (
          <DataRow
            label="Payment"
            value={<Badge tone={payload.financialStatus === "PAID" ? "success" : undefined}>{payload.financialStatus}</Badge>}
          />
        )}
        {payload.fulfillmentStatus && (
          <DataRow
            label="Fulfillment"
            value={<Badge>{payload.fulfillmentStatus}</Badge>}
          />
        )}
      </BlockStack>

      {/* Line items */}
      {payload.lineItems && payload.lineItems.length > 0 && (
        <>
          <Divider />
          <BlockStack gap="200">
            <Text as="h4" variant="headingSm">
              Items ordered
            </Text>
            {payload.lineItems.map((li, idx) => (
              <InlineStack key={idx} align="space-between" blockAlign="start" wrap>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {li.title}
                  </Text>
                  {li.variant && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {li.variant}
                    </Text>
                  )}
                </BlockStack>
                <Text as="span" variant="bodySm">
                  {li.quantity} × {formatCurrency(li.total, li.currency)}
                </Text>
              </InlineStack>
            ))}
          </BlockStack>
        </>
      )}

      {/* Totals */}
      {payload.totals && (
        <>
          <Divider />
          <BlockStack gap="100">
            {payload.totals.subtotal && <DataRow label="Subtotal" value={formatCurrency(payload.totals.subtotal, payload.totals.currency)} />}
            {payload.totals.shipping && <DataRow label="Shipping" value={formatCurrency(payload.totals.shipping, payload.totals.currency)} />}
            {payload.totals.tax && <DataRow label="Tax" value={formatCurrency(payload.totals.tax, payload.totals.currency)} />}
            {payload.totals.discounts && payload.totals.discounts !== "0.00" && (
              <DataRow label="Discounts" value={`-${formatCurrency(payload.totals.discounts, payload.totals.currency)}`} />
            )}
            <DataRow
              label="Total"
              value={
                <Text as="span" variant="bodySm" fontWeight="bold">
                  {formatCurrency(payload.totals.total, payload.totals.currency)}
                </Text>
              }
            />
            {payload.totals.refunded && payload.totals.refunded !== "0.00" && (
              <DataRow label="Refunded" value={formatCurrency(payload.totals.refunded, payload.totals.currency)} />
            )}
          </BlockStack>
        </>
      )}

      {/* Addresses */}
      {(payload.billingAddress || payload.shippingAddress) && (
        <>
          <Divider />
          <BlockStack gap="100">
            {payload.billingAddress && <DataRow label="Billing" value={formatAddress(payload.billingAddress)} />}
            {payload.shippingAddress && <DataRow label="Shipping" value={formatAddress(payload.shippingAddress)} />}
          </BlockStack>
        </>
      )}

      {/* Customer tenure */}
      {payload.customerTenure && (
        <>
          <Divider />
          <BlockStack gap="100">
            {payload.customerTenure.totalOrders != null && (
              <DataRow label="Total orders" value={String(payload.customerTenure.totalOrders)} />
            )}
            {payload.customerTenure.customerSince && (
              <DataRow label="Customer since" value={formatDate(payload.customerTenure.customerSince)} />
            )}
          </BlockStack>
        </>
      )}
    </BlockStack>
  );
}

function ShippingContent({ payload }: { payload: EvidencePayload }) {
  const fulfillments = payload.fulfillments ?? [];
  return (
    <BlockStack gap="300">
      {payload.overallStatus && (
        <DataRow
          label="Status"
          value={<Badge tone={payload.overallStatus === "FULFILLED" ? "success" : undefined}>{payload.overallStatus}</Badge>}
        />
      )}
      {fulfillments.map((f, idx) => (
        <BlockStack key={idx} gap="200">
          {fulfillments.length > 1 && <Divider />}
          <BlockStack gap="100">
            {f.displayStatus && (
              <InlineStack gap="200" blockAlign="center">
                <Icon source={f.displayStatus === "DELIVERED" ? CheckCircleIcon : DeliveryIcon} tone={f.displayStatus === "DELIVERED" ? "success" : "info"} />
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {f.displayStatus}
                </Text>
              </InlineStack>
            )}
            {f.createdAt && <DataRow label="Shipped" value={formatDateTime(f.createdAt)} />}
            {f.deliveredAt && <DataRow label="Delivered" value={formatDateTime(f.deliveredAt)} />}
            {f.estimatedDeliveryAt && !f.deliveredAt && <DataRow label="Est. delivery" value={formatDate(f.estimatedDeliveryAt)} />}
          </BlockStack>

          {/* Tracking */}
          {f.tracking && f.tracking.length > 0 && (
            <BlockStack gap="100">
              {f.tracking.map((tr, trIdx) => (
                <BlockStack key={trIdx} gap="050">
                  {tr.carrier && <DataRow label="Carrier" value={tr.carrier} />}
                  {tr.number && <DataRow label="Tracking #" value={tr.number} />}
                </BlockStack>
              ))}
            </BlockStack>
          )}

          {/* Fulfilled items */}
          {f.items && f.items.length > 0 && (
            <BlockStack gap="050">
              <Text as="span" variant="bodySm" tone="subdued">
                Items:
              </Text>
              {f.items.map((it, itIdx) => (
                <Text key={itIdx} as="span" variant="bodySm">
                  {it.quantity}× {it.title}
                </Text>
              ))}
            </BlockStack>
          )}
        </BlockStack>
      ))}
    </BlockStack>
  );
}

function PolicyContent({ payload }: { payload: EvidencePayload }) {
  const policies = payload.policies ?? [];
  if (policies.length === 0) {
    return <Text as="p" variant="bodySm" tone="subdued">No policy data available.</Text>;
  }
  return (
    <BlockStack gap="300">
      {policies.map((p, idx) => (
        <BlockStack key={idx} gap="150">
          {idx > 0 && <Divider />}
          <InlineStack gap="200" blockAlign="center">
            <Icon source={NoteIcon} tone="info" />
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {p.policyType ? p.policyType.charAt(0).toUpperCase() + p.policyType.slice(1) : "Policy"}
            </Text>
          </InlineStack>
          {p.capturedAt && <DataRow label="Captured" value={formatDate(p.capturedAt)} />}
          {p.textPreview && (
            <div style={{ background: "#f9fafb", borderRadius: 6, padding: "8px 12px" }}>
              <Text as="p" variant="bodySm" tone="subdued">
                {p.textPreview}
              </Text>
            </div>
          )}
          {p.textLength != null && (
            <Text as="span" variant="bodySm" tone="subdued">
              Full text: {p.textLength.toLocaleString()} characters
            </Text>
          )}
        </BlockStack>
      ))}
    </BlockStack>
  );
}

function CommsContent({ payload }: { payload: EvidencePayload }) {
  return (
    <BlockStack gap="300">
      {payload.orderNote && (
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" fontWeight="semibold">Order note</Text>
          <div style={{ background: "#f9fafb", borderRadius: 6, padding: "8px 12px" }}>
            <Text as="p" variant="bodySm">{payload.orderNote}</Text>
          </div>
        </BlockStack>
      )}
      {payload.customerNote && (
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" fontWeight="semibold">Customer note</Text>
          <div style={{ background: "#f9fafb", borderRadius: 6, padding: "8px 12px" }}>
            <Text as="p" variant="bodySm">{payload.customerNote}</Text>
          </div>
        </BlockStack>
      )}

      {payload.buyerAttributes && payload.buyerAttributes.length > 0 && (
        <>
          <Divider />
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" fontWeight="semibold">Customer attributes</Text>
            {payload.buyerAttributes.map((attr, idx) => (
              <DataRow key={idx} label={attr.key} value={attr.value} />
            ))}
          </BlockStack>
        </>
      )}

      {payload.timelineEvents && payload.timelineEvents.length > 0 && (
        <>
          <Divider />
          <BlockStack gap="200">
            <Text as="span" variant="bodySm" fontWeight="semibold">
              Timeline ({payload.timelineEvents.length} events)
            </Text>
            {payload.timelineEvents.map((evt, idx) => (
              <InlineStack key={idx} gap="200" blockAlign="start" wrap>
                <div style={{ minWidth: 16 }}>
                  <Icon source={ClockIcon} tone="subdued" />
                </div>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm">{evt.message || "Event"}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {formatDateTime(evt.createdAt)}
                  </Text>
                </BlockStack>
              </InlineStack>
            ))}
          </BlockStack>
        </>
      )}

      {/* Summary stats */}
      {payload.summary && (
        <>
          <Divider />
          <InlineStack gap="300" wrap>
            {payload.summary.confirmationEventCount != null && payload.summary.confirmationEventCount > 0 && (
              <Badge>{`${payload.summary.confirmationEventCount} confirmations sent`}</Badge>
            )}
            {payload.summary.merchantCommentCount != null && payload.summary.merchantCommentCount > 0 && (
              <Badge>{`${payload.summary.merchantCommentCount} staff comments`}</Badge>
            )}
          </InlineStack>
        </>
      )}
    </BlockStack>
  );
}

function PaymentContent({ payload }: { payload: EvidencePayload }) {
  // Normalized ONCE, from the WHOLE payload — so the card brand on this very
  // record keys the map (PR-C3). Reading a bare letter would have normalized
  // it as an unknown-network result.
  const verification = readPaymentVerification(payload);
  return (
    <BlockStack gap="150">
      {payload.gateway && <DataRow label="Gateway" value={payload.gateway} />}
      {payload.cardCompany && <DataRow label="Card" value={`${payload.cardCompany.toUpperCase()} •••• ${payload.lastFour || "?"}`} />}
      {/* Tone comes from the ONE owner of AVS/CVV semantics
          (`lib/argument/paymentVerification.ts`, PR-C2). This component used
          to branch on the raw letters, which is how a viewer ends up calling
          a code a success that scoring credits with nothing. */}
      {verification.avs.present && (
        <DataRow
          label="AVS check"
          value={
            <Badge tone={toneFor(verification.avs.outcome)}>
              {avsLabel(verification.avs.normalized, verification.avs.code)}
            </Badge>
          }
        />
      )}
      {verification.cvv.present && (
        <DataRow
          label="CVV check"
          value={
            <Badge tone={toneFor(verification.cvv.outcome)}>
              {cvvLabel(verification.cvv.outcome, verification.cvv.code)}
            </Badge>
          }
        />
      )}
    </BlockStack>
  );
}

function RefundContent({ payload }: { payload: EvidencePayload }) {
  const refunds = payload.refunds ?? [];
  if (refunds.length === 0) {
    return <Text as="p" variant="bodySm" tone="subdued">No refund history.</Text>;
  }
  return (
    <BlockStack gap="200">
      {refunds.map((r, idx) => (
        <BlockStack key={idx} gap="100">
          {idx > 0 && <Divider />}
          <DataRow label="Amount" value={formatCurrency(r.amount, r.currency)} />
          <DataRow label="Date" value={formatDateTime(r.createdAt)} />
          {r.note && <DataRow label="Note" value={r.note} />}
        </BlockStack>
      ))}
    </BlockStack>
  );
}

function ManualUploadContent({ payload }: { payload: EvidencePayload }) {
  return (
    <BlockStack gap="150">
      {payload.fileName && <DataRow label="File" value={payload.fileName} />}
      {payload.fileType && <DataRow label="Type" value={payload.fileType} />}
      {payload.fileSize != null && <DataRow label="Size" value={formatFileSize(payload.fileSize)} />}
    </BlockStack>
  );
}

function FallbackContent({ payload }: { payload: EvidencePayload }) {
  const entries = Object.entries(payload).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) {
    return <Text as="p" variant="bodySm" tone="subdued">No data available.</Text>;
  }
  return (
    <BlockStack gap="100">
      {entries.slice(0, 12).map(([key, value]) => (
        <DataRow
          key={key}
          label={key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
          value={typeof value === "object" ? JSON.stringify(value) : String(value)}
        />
      ))}
    </BlockStack>
  );
}

/* ── Main component ── */

export function EvidenceContentViewer({ item }: { item: EvidenceItemFull }) {
  const p = item.payload ?? {};
  const source = item.source;
  const type = item.type;

  // Detect content type
  if (source === "manual_upload" || p.storagePath) {
    return <ManualUploadContent payload={p} />;
  }
  if (p.avsResultCode || p.cvvResultCode || source === "shopify_transactions") {
    return <PaymentContent payload={p} />;
  }
  if (p.refunds) {
    return <RefundContent payload={p} />;
  }
  if (type === "order" || p.orderName || p.lineItems) {
    return <OrderContent payload={p} />;
  }
  if (type === "shipping" || p.fulfillments) {
    return <ShippingContent payload={p} />;
  }
  if (type === "policy" || p.policies) {
    return <PolicyContent payload={p} />;
  }
  if (type === "comms" || p.timelineEvents || p.orderNote) {
    return <CommsContent payload={p} />;
  }

  return <FallbackContent payload={p} />;
}
