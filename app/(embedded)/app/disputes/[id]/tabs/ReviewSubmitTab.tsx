"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Collapsible,
  Divider,
  Modal,
  Select,
  TextField,
} from "@shopify/polaris";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import type { SubmissionField } from "../workspace-components/types";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

function strengthLabel(s: string): string {
  if (s === "strong") return "Strong";
  if (s === "moderate") return "Medium";
  return "Weak";
}

export default function ReviewSubmitTab({ workspace }: { workspace: Workspace }) {
  const { data, clientState, derived, actions } = workspace;

  const [fields, setFields] = useState<SubmissionField[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  const pack = data?.pack ?? null;
  const readiness = derived.readiness;
  const warningCount = derived.warningCount;

  useEffect(() => {
    if (!pack) return;
    setPreviewLoading(true);
    fetch(`/api/packs/${pack.id}/submission-preview`)
      .then((r) => r.json())
      .then((d) => setFields(d.fields ?? []))
      .finally(() => setPreviewLoading(false));
  }, [pack]);

  const handleSubmit = useCallback(() => {
    if (derived.caseStrength.overall === "weak" || readiness === "ready_with_warnings" || warningCount > 0) {
      actions.setShowOverrideModal(true);
    } else {
      actions.submitToShopify();
    }
  }, [derived.caseStrength.overall, readiness, warningCount, actions]);

  const handleConfirmOverride = useCallback(() => {
    actions.submitToShopify(overrideReason, overrideNote || undefined);
    setOverrideReason("");
    setOverrideNote("");
  }, [actions, overrideReason, overrideNote]);

  if (!data) return null;

  const { caseStrength, improvement, whyWins, missingItems } = derived;

  if (!pack) {
    return (
      <Card>
        <Text as="p" variant="bodyMd" tone="subdued">
          Generate an evidence pack first to review and submit.
        </Text>
      </Card>
    );
  }

  const isReadOnly = derived.isReadOnly;
  const isSaving = clientState.saving;
  const canSubmit = readiness !== "blocked" && !isReadOnly;
  const isStrong = caseStrength.overall === "strong";
  const isWeak = caseStrength.overall === "weak";

  const readinessTone = isReadOnly ? "info" as const
    : readiness === "blocked" ? "critical" as const
    : isWeak ? "warning" as const
    : "success" as const;

  // Headline
  const headline = isReadOnly
    ? "\u2713 Evidence has been submitted to Shopify"
    : isStrong
      ? "Your case is ready to submit"
      : caseStrength.overall === "moderate"
        ? "Your case is ready, but can be strengthened"
        : "Your case needs more evidence before submitting";

  return (
    <BlockStack gap="500">

      {/* ═══════════════════════════════════════════════════════════
          SECTION 1 — DECISION BLOCK (dominant, 60% of attention)
          ═══════════════════════════════════════════════════════════ */}
      <Card>
        <BlockStack gap="400">
          {/* Status row */}
          <InlineStack gap="200" blockAlign="center" wrap>
            <Badge tone={readinessTone}>
              {isReadOnly ? "Submitted" : readiness === "blocked" ? "Blocked" : isWeak ? "Risky" : "Ready to submit"}
            </Badge>
            <Badge tone={isStrong ? "success" : caseStrength.overall === "moderate" ? "warning" : "critical"}>
              {`Case strength: ${strengthLabel(caseStrength.overall)}`}
            </Badge>
          </InlineStack>

          {/* Headline */}
          <Text as="h2" variant="headingLg">
            {headline}
          </Text>

          {/* Supporting evidence */}
          {whyWins.strengths.length > 0 && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Your defense is supported by:
              </Text>
              {whyWins.strengths.map((s, i) => (
                <Text key={i} as="p" variant="bodySm">{`\u2022 ${s}`}</Text>
              ))}
            </BlockStack>
          )}

          {/* Missing / improvement */}
          {!isStrong && missingItems.length > 0 && !isReadOnly && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold" tone="caution">
                Not included in this submission:
              </Text>
              {missingItems.slice(0, 3).map((item) => (
                <Text key={item.field} as="p" variant="bodySm" tone="subdued">
                  {`\u2022 ${item.label}`}
                </Text>
              ))}
            </BlockStack>
          )}

          {/* Next best action */}
          {!isStrong && !isReadOnly && improvement && (
            <>
              <Divider />
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {`${improvement.action} to improve your chances of winning`}
                </Text>
              </BlockStack>
            </>
          )}
        </BlockStack>
      </Card>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 2 — PRIMARY ACTION (25% of attention)
          ═══════════════════════════════════════════════════════════ */}
      {isReadOnly ? (
        <Card>
          <BlockStack gap="300">
            <Banner tone="success">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {"\u2713 Your dispute response has been saved to Shopify"}
              </Text>
            </Banner>

            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold">What was sent:</Text>
                <Text as="p" variant="bodySm">{"\u2022 Dispute response letter \u2192 Annat / Other text field"}</Text>
                <Text as="p" variant="bodySm">{"\u2022 Order details and customer activity \u2192 Activity log"}</Text>
                <Text as="p" variant="bodySm">{"\u2022 Policy disclosures \u2192 Refund policy field"}</Text>
              </BlockStack>

              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Submit to the bank now?
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {"Open Shopify Admin to review and submit your response. Shopify will auto-submit on the deadline if you don\u2019t act sooner."}
                </Text>
              </BlockStack>
            </BlockStack>

            {(() => {
              const url =
                data.dispute.shopDomain && data.dispute.disputeEvidenceGid
                  ? getShopifyDisputeUrl(
                      data.dispute.shopDomain,
                      data.dispute.disputeEvidenceGid,
                    )
                  : null;
              if (!url) return null;
              return (
                <Button variant="primary" fullWidth url={url} target="_blank">
                  Open in Shopify Admin
                </Button>
              );
            })()}
          </BlockStack>
        </Card>
      ) : (
        <div style={{ display: "flex", gap: "12px" }}>
          <div style={{ flex: 1 }}>
            <Button
              variant="primary"
              fullWidth
              onClick={handleSubmit}
              disabled={!canSubmit || isSaving}
              loading={isSaving}
              size="large"
            >
              Submit evidence to Shopify
            </Button>
          </div>
          {!isStrong && (
            <div style={{ flex: 1 }}>
              <Button
                fullWidth
                size="large"
                onClick={() => {
                  if (improvement) {
                    actions.navigateToEvidence(improvement.field);
                  } else {
                    actions.setActiveTab(1);
                  }
                }}
              >
                Improve case first
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 3 — WHAT WILL BE SUBMITTED (collapsed)
          Renders evidence the same way as the bank-facing email.
          ═══════════════════════════════════════════════════════════ */}
      {!isReadOnly && (
        <Card>
          <BlockStack gap="200">
            <Button
              variant="plain"
              onClick={() => setDetailsOpen(v => !v)}
              disclosure={detailsOpen ? "up" : "down"}
            >
              {detailsOpen ? "Hide submission details" : "What will be submitted"}
            </Button>

            <Collapsible open={detailsOpen} id="submission-details">
              <div style={{
                background: "#f8fafc",
                borderRadius: "8px",
                padding: "20px 24px",
                border: "1px solid #e2e8f0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "13px",
                lineHeight: "1.6",
                whiteSpace: "pre-wrap",
                color: "#1a1a1a",
              }}>
                {/* Rebuttal */}
                {data.rebuttalDraft?.sections && data.rebuttalDraft.sections.length > 0 && (
                  <>
                    {data.rebuttalDraft.sections.map((sec) => (
                      <div key={sec.id} style={{ marginBottom: "12px" }}>
                        {sec.text}
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid #d1d5db", margin: "16px 0" }} />
                    <div style={{ fontWeight: 600, marginBottom: "12px" }}>SUPPORTING EVIDENCE</div>
                  </>
                )}

                {/* Evidence items — rendered like the email */}
                {pack.evidenceItems.map((item) => {
                  const p = item.payload as Record<string, unknown>;

                  if (item.type === "order") {
                    const totals = typeof p.totals === "object" ? p.totals as Record<string, unknown> : null;
                    const billing = typeof p.billingAddress === "object" ? p.billingAddress as Record<string, unknown> : null;
                    const shipping = typeof p.shippingAddress === "object" ? p.shippingAddress as Record<string, unknown> : null;
                    const items = Array.isArray(p.lineItems) ? p.lineItems as Array<Record<string, unknown>> : [];
                    const addrMatch = billing && shipping && billing.city === shipping.city;
                    return (
                      <div key={item.id} style={{ marginBottom: "16px" }}>
                        <div style={{ fontWeight: 600, marginBottom: "4px" }}>ORDER DETAILS</div>
                        {typeof p.orderName === "string" ? <div>{`  Order: ${p.orderName}`}</div> : null}
                        {typeof p.createdAt === "string" ? <div>{`  Date: ${fmtDate(p.createdAt)}`}</div> : null}
                        {typeof p.financialStatus === "string" ? <div>{`  Status: ${p.financialStatus}`}</div> : null}
                        {totals ? <div>{`  Amount: ${String(totals.currency ?? "")} ${String(totals.total ?? "")}`}</div> : null}
                        {billing ? <div>{`  Billing address: ${fmtAddr(billing)}`}</div> : null}
                        {shipping ? <div>{`  Shipping address: ${fmtAddr(shipping)}`}</div> : null}
                        {addrMatch ? <div>{"  Address verification: Billing and shipping addresses match"}</div> : null}
                        {items.length > 0 ? (
                          <>
                            <div style={{ marginTop: "8px" }}>{"  Items ordered:"}</div>
                            {items.map((li, idx) => (
                              <div key={idx}>{`    \u2022 ${String(li.title ?? "")}${li.variantTitle ? ` (${String(li.variantTitle)})` : ""} \u00d7 ${String(li.quantity ?? 1)}`}</div>
                            ))}
                          </>
                        ) : null}
                      </div>
                    );
                  }

                  if (item.type === "other" && p.avsResultCode !== undefined) {
                    const avsDesc = p.avsResultCode === "Y" ? "Full match" : String(p.avsResultCode ?? "N/A");
                    const cvvDesc = p.cvvResultCode === "M" ? "Match" : String(p.cvvResultCode ?? "N/A");
                    return (
                      <div key={item.id} style={{ marginBottom: "16px" }}>
                        <div style={{ fontWeight: 600, marginBottom: "4px" }}>PAYMENT VERIFICATION</div>
                        <div>{`  AVS (Address Verification): ${avsDesc}`}</div>
                        <div>{`  CVV (Card Verification): ${cvvDesc}`}</div>
                        {typeof p.cardCompany === "string" ? <div>{`  Card: ${p.cardCompany}${typeof p.lastFour === "string" ? ` ending ${p.lastFour.replace(/[^0-9]/g, "")}` : ""}`}</div> : null}
                        {typeof p.gateway === "string" ? <div>{`  Payment processor: ${p.gateway.replace(/_/g, " ")}`}</div> : null}
                      </div>
                    );
                  }

                  if (item.type === "comms") {
                    const events = Array.isArray(p.timelineEvents)
                      ? (p.timelineEvents as Array<Record<string, unknown>>).filter((e) => {
                          const msg = String(e.message ?? "").toLowerCase();
                          return msg.includes("confirmation") || msg.includes("email was sent") ||
                                 msg.includes("placed this order") || msg.includes("authorized") ||
                                 msg.includes("captured");
                        })
                      : [];
                    if (events.length === 0) return null;
                    return (
                      <div key={item.id} style={{ marginBottom: "16px" }}>
                        <div style={{ fontWeight: 600, marginBottom: "4px" }}>CUSTOMER NOTIFICATIONS</div>
                        {events.map((e, idx) => (
                          <div key={idx}>{`  [${fmtDateTime(String(e.createdAt ?? ""))}] ${String(e.message ?? "").replace(/<[^>]+>/g, "")}`}</div>
                        ))}
                      </div>
                    );
                  }

                  if (item.type === "access_log" && p.customerTenure && typeof p.customerTenure === "object") {
                    const tenure = p.customerTenure as Record<string, unknown>;
                    return (
                      <div key={item.id} style={{ marginBottom: "16px" }}>
                        <div style={{ fontWeight: 600, marginBottom: "4px" }}>CUSTOMER ACCOUNT</div>
                        {typeof tenure.customerSince === "string" ? <div>{`  Account created: ${fmtDate(tenure.customerSince)}`}</div> : null}
                        {parseInt(String(tenure.totalOrders ?? "0")) > 0 ? <div>{`  Prior orders: ${String(tenure.totalOrders)}`}</div> : null}
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </Collapsible>
          </BlockStack>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 4 — ACTIVITY LOG (minimal)
          ═══════════════════════════════════════════════════════════ */}
      {(() => {
        const relevantEvents = pack.auditEvents.filter((e) =>
          ["evidence_waived", "evidence_unwaived", "submitted_with_warnings", "evidence_saved_to_shopify", "admin_override"].includes(e.event_type),
        );
        if (relevantEvents.length === 0) return null;
        return (
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">Activity</Text>
              {relevantEvents.slice(0, 5).map((evt) => (
                <Text key={evt.id} as="p" variant="bodySm" tone="subdued">
                  {`${new Date(evt.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} \u2014 ${evt.event_type.replace(/_/g, " ")}`}
                </Text>
              ))}
            </BlockStack>
          </Card>
        );
      })()}

      {/* Override Modal */}
      <Modal
        open={clientState.showOverrideModal}
        onClose={() => actions.setShowOverrideModal(false)}
        title="Submit with current evidence?"
        primaryAction={{
          content: "Submit anyway",
          onAction: handleConfirmOverride,
          destructive: true,
          disabled: !overrideReason,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => actions.setShowOverrideModal(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                {isWeak
                  ? "This case is weak. Submitting now may significantly reduce your chances of winning."
                  : "Some recommended evidence is missing. Adding it could improve your outcome."}
              </Text>
            </Banner>

            <Select
              label="Why are you submitting now?"
              options={[
                { label: "Select a reason", value: "" },
                { label: "I've provided all available evidence", value: "all_available" },
                { label: "Missing evidence doesn't apply", value: "not_applicable" },
                { label: "Deadline is approaching", value: "deadline" },
                { label: "Other", value: "other" },
              ]}
              value={overrideReason}
              onChange={setOverrideReason}
            />

            {overrideReason === "other" && (
              <TextField
                label="Note"
                value={overrideNote}
                onChange={setOverrideNote}
                autoComplete="off"
                multiline={2}
              />
            )}

            <Text as="p" variant="bodySm" tone="subdued">
              This decision will be logged.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function fmtDateTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtAddr(a: Record<string, unknown>): string {
  return [a.city, a.provinceCode, a.countryCode].filter(Boolean).join(", ");
}
