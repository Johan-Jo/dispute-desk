"use client";

import {
  Card,
  BlockStack,
  Text,
  Button,
  Divider,
  ProgressBar,
} from "@shopify/polaris";

interface SubmissionSidebarProps {
  requiredTotal: number;
  requiredComplete: number;
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
  requiredTotal,
  requiredComplete,
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
  const allRequiredDone = requiredTotal > 0 && requiredComplete >= requiredTotal;
  const progress =
    requiredTotal > 0 ? Math.round((requiredComplete / requiredTotal) * 100) : 100;

  return (
    <BlockStack gap="400">
      {/* Summary card */}
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            Required: {requiredComplete}/{requiredTotal}
          </Text>

          <ProgressBar
            progress={progress}
            tone={allRequiredDone ? "success" : "critical"}
            size="small"
          />

          <Divider />

          {readOnly ? (
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
              disabled={!allRequiredDone || saving}
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
