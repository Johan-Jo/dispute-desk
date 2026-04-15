"use client";

import {
  Card,
  BlockStack,
  Text,
  Button,
  Divider,
  ProgressBar,
  Banner,
} from "@shopify/polaris";
import type { SubmissionReadiness } from "@/lib/types/evidenceItem";

interface SubmissionSidebarProps {
  readiness: SubmissionReadiness;
  completenessScore: number;
  warningCount: number;
  onSave: () => void;
  onExportPdf: () => void;
  onDownload: () => void;
  saving: boolean;
  rendering: boolean;
  hasPdf: boolean;
  hasPdfJob: boolean;
  readOnly: boolean;
  disputeUrl: string | null;
}

export function SubmissionSidebar({
  readiness,
  completenessScore,
  warningCount,
  onSave,
  onExportPdf,
  onDownload,
  saving,
  rendering,
  hasPdf,
  hasPdfJob,
  readOnly,
  disputeUrl,
}: SubmissionSidebarProps) {
  const canSubmit = readiness !== "blocked";
  const isSubmitted = readiness === "submitted" || readOnly;

  return (
    <BlockStack gap="400">
      {/* Summary card */}
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            {`Evidence: ${completenessScore}%`}
          </Text>

          <ProgressBar
            progress={completenessScore}
            tone={completenessScore >= 80 ? "success" : completenessScore >= 40 ? "highlight" : "critical"}
            size="small"
          />

          {readiness === "ready_with_warnings" && warningCount > 0 && (
            <Banner tone="warning" hideIcon>
              <Text as="p" variant="bodySm">
                {`${warningCount} high-impact ${warningCount === 1 ? "item" : "items"} missing. You may still proceed.`}
              </Text>
            </Banner>
          )}

          <Divider />

          {isSubmitted ? (
            disputeUrl ? (
              <Button fullWidth url={disputeUrl} target="_blank">
                Open in Shopify Admin
              </Button>
            ) : (
              <Button fullWidth disabled>
                Submitted
              </Button>
            )
          ) : (
            <Button
              fullWidth
              variant="primary"
              onClick={onSave}
              disabled={!canSubmit || saving}
              loading={saving}
            >
              Submit to Shopify
            </Button>
          )}
        </BlockStack>
      </Card>

      {/* Export PDF */}
      <Card>
        <BlockStack gap="200">
          {hasPdfJob ? (
            <Button fullWidth disabled>
              Generating PDF...
            </Button>
          ) : hasPdf ? (
            <Button fullWidth onClick={onDownload}>
              Download PDF
            </Button>
          ) : (
            <Button fullWidth onClick={onExportPdf} loading={rendering}>
              Export PDF
            </Button>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
