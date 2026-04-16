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
  const [previewOpen, setPreviewOpen] = useState(false);
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

  const { caseStrength, improvement, whyWins, missingItems, nextAction } = derived;

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

  // Readiness label
  const readinessLabel = isReadOnly ? "Submitted"
    : readiness === "blocked" ? "Blocked"
    : isWeak ? "Risky"
    : "Ready to submit";
  const readinessTone = isReadOnly ? "info" as const
    : readiness === "blocked" ? "critical" as const
    : isWeak ? "warning" as const
    : "success" as const;

  return (
    <BlockStack gap="400">
      {/* 1. DECISION BLOCK — primary */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={readinessTone}>{readinessLabel}</Badge>
              <Badge tone={
                isStrong ? "success" : caseStrength.overall === "moderate" ? "warning" : "critical"
              }>
                {`Case strength: ${strengthLabel(caseStrength.overall)}`}
              </Badge>
            </InlineStack>
          </InlineStack>

          {caseStrength.strengthReason && (
            <Text as="p" variant="bodySm" tone="subdued">
              {caseStrength.strengthReason}
            </Text>
          )}

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

          {/* Missing — actionable only */}
          {!isStrong && missingItems.length > 0 && !isReadOnly && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                To strengthen your case:
              </Text>
              {missingItems.slice(0, 3).map((item) => (
                <InlineStack key={item.field} gap="200" blockAlign="center">
                  <Text as="p" variant="bodySm">{`\u2022 Add ${item.label}`}</Text>
                  <Badge tone={item.priority === "critical" ? "attention" : undefined}>
                    {item.priority === "critical" ? "critical" : "recommended"}
                  </Badge>
                </InlineStack>
              ))}
            </BlockStack>
          )}

          {/* Next best action */}
          {!isStrong && !isReadOnly && improvement && (
            <>
              <Divider />
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    Next best action
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {improvement.action.replace("Add ", "Add ") + " to improve your case."}
                  </Text>
                </BlockStack>
                <Button size="slim" onClick={() => actions.navigateToEvidence(improvement.field)}>
                  {improvement.action}
                </Button>
              </InlineStack>
            </>
          )}
        </BlockStack>
      </Card>

      {/* 2. SUBMIT / IMPROVE BUTTONS */}
      <Card>
        <BlockStack gap="200">
          {isReadOnly ? (
            <>
              <Banner tone="success" hideIcon>
                <Text as="p" variant="bodySm">
                  {`Evidence submitted to Shopify on ${pack.savedToShopifyAt ? new Date(pack.savedToShopifyAt).toLocaleDateString() : "\u2014"}`}
                </Text>
              </Banner>
              {data.dispute.disputeGid && data.dispute.shopDomain && (
                <Button
                  fullWidth
                  url={`https://${data.dispute.shopDomain}/admin/shopify_payments/disputes/${data.dispute.disputeGid.split("/").pop()}`}
                  target="_blank"
                >
                  Open in Shopify Admin
                </Button>
              )}
            </>
          ) : (
            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={!canSubmit || isSaving}
                loading={isSaving}
              >
                Submit to Shopify
              </Button>
              {!isStrong && (
                <Button
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
              )}
            </InlineStack>
          )}
        </BlockStack>
      </Card>

      {/* 3. SUBMISSION CONTENT — collapsed by default */}
      {!isReadOnly && (
        <Card>
          <BlockStack gap="200">
            <Button
              variant="plain"
              onClick={() => setPreviewOpen(v => !v)}
              disclosure={previewOpen ? "up" : "down"}
            >
              {previewOpen ? "Hide submission details" : "View what will be submitted to Shopify"}
            </Button>
            <Collapsible open={previewOpen} id="submission-preview">
              <BlockStack gap="300">
                {previewLoading ? (
                  <Text as="p" variant="bodySm" tone="subdued">Loading...</Text>
                ) : fields.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">No evidence to submit.</Text>
                ) : (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Automatically included based on your evidence.
                    </Text>
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
              </BlockStack>
            </Collapsible>
          </BlockStack>
        </Card>
      )}

      {/* 4. ACTIVITY LOG — secondary */}
      {pack.auditEvents.length > 0 && (
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd" tone="subdued">Activity log</Text>
            <BlockStack gap="100">
              {pack.auditEvents
                .filter((e) =>
                  ["evidence_waived", "evidence_unwaived", "submitted_with_warnings", "evidence_saved_to_shopify", "admin_override"].includes(e.event_type),
                )
                .slice(0, 10)
                .map((evt) => (
                  <InlineStack key={evt.id} gap="300" wrap>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {new Date(evt.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </Text>
                    <Text as="span" variant="bodySm">
                      {evt.event_type.replace(/_/g, " ")}
                    </Text>
                  </InlineStack>
                ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}

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
                  : "Some recommended evidence is missing. Submitting is possible but adding it could improve your outcome."}
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
