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
  ProgressBar,
  Divider,
  Modal,
  Checkbox,
  Select,
  TextField,
} from "@shopify/polaris";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import type { SubmissionField } from "../workspace-components/types";
import styles from "../workspace.module.css";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

export default function ReviewSubmitTab({ workspace }: { workspace: Workspace }) {
  const { data, clientState, derived, actions } = workspace;

  // Load submission preview
  const [fields, setFields] = useState<SubmissionField[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
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
    if (readiness === "ready_with_warnings" || warningCount > 0) {
      actions.setShowOverrideModal(true);
    } else {
      actions.submitToShopify();
    }
  }, [readiness, warningCount, actions]);

  const handleConfirmOverride = useCallback(() => {
    actions.submitToShopify(overrideReason, overrideNote || undefined);
    setOverrideReason("");
    setOverrideNote("");
  }, [actions, overrideReason, overrideNote]);

  if (!data) return null;

  const { caseStrength, risk, improvement } = derived;

  if (!pack) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" tone="subdued">
            Generate an evidence pack first to review and submit.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const isReadOnly = derived.isReadOnly;
  const isSaving = clientState.saving;
  const canSubmit = readiness !== "blocked" && !isReadOnly;

  return (
    <BlockStack gap="400">
      {/* A. Submission Preview */}
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Submission preview</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            This is exactly what will be sent to Shopify.
          </Text>

          {previewLoading ? (
            <Text as="p" variant="bodySm" tone="subdued">Loading preview...</Text>
          ) : fields.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">No evidence fields to submit.</Text>
          ) : (
            <BlockStack gap="0">
              <div className={styles.submissionRow} style={{ fontWeight: 600 }}>
                <span>Shopify field</span>
                <span>Content</span>
                <span>Source</span>
                <span>Include</span>
              </div>
              {fields.map((field) => {
                const excluded = clientState.excludedFields.has(field.shopifyFieldName);
                return (
                  <div key={field.shopifyFieldName} className={styles.submissionRow} style={{ opacity: excluded ? 0.5 : 1 }}>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {field.shopifyFieldLabel}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {field.contentPreview || "\u2014"}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {field.source}
                    </Text>
                    <Checkbox
                      label=""
                      checked={!excluded && field.included}
                      onChange={() => actions.toggleSubmissionField(field.shopifyFieldName)}
                      disabled={isReadOnly || !field.content}
                    />
                  </div>
                );
              })}
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      {/* B. Readiness */}
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">Readiness</Text>
            <Badge
              tone={
                readiness === "ready" ? "success" :
                readiness === "ready_with_warnings" ? "warning" :
                readiness === "blocked" ? "critical" :
                "info"
              }
            >
              {readiness === "ready" ? "Ready to submit" :
               readiness === "ready_with_warnings" ? "Ready with warnings" :
               readiness === "blocked" ? "Blocked" :
               "Submitted"}
            </Badge>
          </InlineStack>
          <ProgressBar
            progress={pack.completenessScore}
            tone={pack.completenessScore >= 80 ? "success" : "critical"}
            size="small"
          />
          {caseStrength.overall !== "insufficient" && (
            <Text as="p" variant="bodySm" tone="subdued">
              Case strength: {caseStrength.overall}
            </Text>
          )}
        </BlockStack>
      </Card>

      {/* C. Risk Explanation */}
      {risk.risks.length > 0 && !isReadOnly && (
        <div className={styles.riskCard}>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">What happens if you submit now</Text>
            <InlineStack gap="200" blockAlign="center">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Expected outcome:
              </Text>
              <Badge
                tone={risk.expectedOutcome === "strong" ? "success" : risk.expectedOutcome === "moderate" ? "warning" : "critical"}
              >
                {risk.expectedOutcome.charAt(0).toUpperCase() + risk.expectedOutcome.slice(1)}
              </Badge>
            </InlineStack>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">Risks:</Text>
              {risk.risks.map((r, i) => (
                <Text key={i} as="p" variant="bodySm">{`\u2022 ${r}`}</Text>
              ))}
            </BlockStack>
          </BlockStack>
        </div>
      )}

      {/* D. Case Improvement Signal */}
      {improvement && !isReadOnly && (
        <div className={styles.improvementCard}>
          <InlineStack align="space-between" blockAlign="center" wrap>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {`Case strength: ${improvement.currentStrength} \u2192 ${improvement.potentialStrength}`}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {`after adding: ${improvement.action.replace("Add ", "")}`}
              </Text>
            </BlockStack>
            <Button
              size="slim"
              onClick={() => actions.navigateToEvidence(improvement.field)}
            >
              Add now
            </Button>
          </InlineStack>
        </div>
      )}

      {/* E. Submit Action */}
      <Card>
        <BlockStack gap="200">
          {isReadOnly ? (
            <>
              <Banner tone="success" hideIcon>
                <Text as="p" variant="bodySm">
                  Evidence submitted to Shopify on {pack.savedToShopifyAt ? new Date(pack.savedToShopifyAt).toLocaleDateString() : "\u2014"}
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
            <Button
              fullWidth
              variant="primary"
              onClick={handleSubmit}
              disabled={!canSubmit || isSaving}
              loading={isSaving}
            >
              {readiness === "blocked" ? "Resolve blockers to submit" :
               readiness === "ready_with_warnings" ? "Review & submit" :
               "Submit to Shopify"}
            </Button>
          )}
        </BlockStack>
      </Card>

      {/* F. Decision Log */}
      {pack.auditEvents.length > 0 && (
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Decision log</Text>
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
                    {evt.actor_type && (
                      <Badge>{evt.actor_type}</Badge>
                    )}
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
        title="Submit with warnings?"
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
                {`${warningCount} high-impact ${warningCount === 1 ? "item is" : "items are"} missing. Submitting now may reduce your chances.`}
              </Text>
            </Banner>

            <Select
              label="Reason for proceeding"
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
              This decision will be logged in the audit trail.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
