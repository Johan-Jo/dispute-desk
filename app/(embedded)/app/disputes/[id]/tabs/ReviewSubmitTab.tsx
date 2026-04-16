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
    ? "Evidence has been submitted"
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
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  Evidence saved to Shopify
                </Text>
                <Text as="p" variant="bodySm">
                  {`Saved on ${pack.savedToShopifyAt ? new Date(pack.savedToShopifyAt).toLocaleDateString() : "\u2014"}. Submit your response in Shopify Admin, or it will be auto-submitted on the dispute deadline.`}
                </Text>
              </BlockStack>
            </Banner>
            {data.dispute.disputeGid && data.dispute.shopDomain && (
              <Button
                variant="primary"
                fullWidth
                url={`https://${data.dispute.shopDomain}/admin/shopify_payments/disputes/${data.dispute.disputeGid.split("/").pop()}`}
                target="_blank"
              >
                Submit now in Shopify Admin
              </Button>
            )}
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
              Save evidence to Shopify
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
          SECTION 3 — SUBMISSION DETAILS (collapsed, 15% of attention)
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
              <BlockStack gap="400">

                {/* Rebuttal letter */}
                {data.rebuttalDraft?.sections && data.rebuttalDraft.sections.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="p" variant="headingSm">Dispute response letter</Text>
                    <div style={{
                      background: "#f8fafc",
                      borderRadius: "8px",
                      padding: "16px 20px",
                      border: "1px solid #e2e8f0",
                    }}>
                      <BlockStack gap="300">
                        {data.rebuttalDraft.sections.map((sec) => (
                          <Text key={sec.id} as="p" variant="bodySm">
                            {sec.text}
                          </Text>
                        ))}
                      </BlockStack>
                    </div>
                  </BlockStack>
                )}

                {/* Evidence summary */}
                {fields.filter(f => f.included && f.content).length > 0 && (
                  <BlockStack gap="200">
                    <Text as="p" variant="headingSm">Supporting evidence</Text>
                    {fields.filter(f => f.included && f.content).map((field) => (
                      <BlockStack key={field.shopifyFieldName} gap="050">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {field.shopifyFieldLabel}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {field.contentPreview || "\u2014"}
                        </Text>
                      </BlockStack>
                    ))}
                  </BlockStack>
                )}

                {previewLoading && (
                  <Text as="p" variant="bodySm" tone="subdued">Loading details...</Text>
                )}
              </BlockStack>
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
