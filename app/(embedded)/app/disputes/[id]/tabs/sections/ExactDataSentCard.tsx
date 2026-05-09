/**
 * ExactDataSentCard — Section 2 of ReviewSubmitTab.
 *
 * THE CRITICAL SECTION. Renders the bank-visible payload bucketed
 * into six fixed groups for readability:
 *   Order details · Customer details · Payment verification ·
 *   Customer activity · Policies · Additional evidence
 *
 * Each group shows structured text fields AND files (merchant
 * uploads, native Shopify file slots, the auto-generated pack PDF).
 * Field content is NEVER transformed — values pass through
 * byte-for-byte from useReviewView, which mirrors the GraphQL
 * mutation produced by composeShopifyMutationPayload.
 *
 * Forbidden in this section: skeleton bars, "loading…" text,
 * spinners, null flickers. When the payload is absent (pre-build
 * or empty pack), render the explicit empty-state copy and stop.
 */

"use client";

import {
  Card,
  BlockStack,
  InlineStack,
  Box,
  Text,
  Badge,
  Icon,
} from "@shopify/polaris";
import { FileIcon } from "@shopify/polaris-icons";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import type {
  ReviewState,
  DataSentGroup,
  DataSentField,
  DataSentAttachment,
} from "../useReviewView";

const PAYLOAD_TEXT_STYLE: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "13px",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  color: "#1a1a1a",
  margin: 0,
};

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "—";
  const KB = 1024;
  const MB = KB * 1024;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}

function FieldBlock({ field }: { field: DataSentField }) {
  return (
    <BlockStack gap="100">
      <Text as="h4" variant="headingSm">
        {field.label}
      </Text>
      <pre style={PAYLOAD_TEXT_STYLE}>{field.content}</pre>
    </BlockStack>
  );
}

function AttachmentRow({ attachment }: { attachment: DataSentAttachment }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap>
      <Icon source={FileIcon} />
      <Text as="span" variant="bodyMd">
        {attachment.fileName ?? "Attachment"}
      </Text>
      {attachment.sizeBytes != null && attachment.sizeBytes > 0 ? (
        <Text as="span" variant="bodySm" tone="subdued">
          {formatBytes(attachment.sizeBytes)}
        </Text>
      ) : null}
      {attachment.kind === "pack_pdf" ? (
        <Badge tone="info">Pack PDF</Badge>
      ) : null}
      {attachment.kind === "native_slot" && attachment.slotLabel ? (
        <Badge tone="success">
          {`Attached to ${attachment.slotLabel}`}
        </Badge>
      ) : null}
    </InlineStack>
  );
}

function GroupBlock({
  group,
  groupTitle,
}: {
  group: DataSentGroup;
  groupTitle: string;
}) {
  const hasFields = group.fields.length > 0;
  const hasAttachments = group.attachments.length > 0;
  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingSm">
        {groupTitle}
      </Text>
      {hasFields ? (
        <BlockStack gap="300">
          {group.fields.map((f) => (
            <FieldBlock key={f.shopifyFieldName} field={f} />
          ))}
        </BlockStack>
      ) : null}
      {hasAttachments ? (
        <BlockStack gap="200">
          {group.attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} />
          ))}
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}

interface Props {
  state: ReviewState;
  payload: DataSentGroup[] | null;
  loading?: boolean;
}

export function ExactDataSentCard({ state, payload, loading = false }: Props) {
  const t = useTranslations("disputes.reviewTab.sections.dataSent");
  const tGroups = useTranslations("disputes.reviewTab.sections.dataSent.groups");

  const titleKey = state === "submitted" ? "title.submitted" : "title.unsubmitted";

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t(titleKey)}
          </Text>
          {loading ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {t("loading")}
            </Text>
          ) : null}
        </BlockStack>

        {payload === null ? (
          // Explicit empty state. NEVER a skeleton, NEVER "loading…".
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("empty")}
          </Text>
        ) : (
          <BlockStack gap="500">
            {payload.map((group, index) => (
              <Fragment key={group.key}>
                {index > 0 ? (
                  <Box
                    borderBlockStartWidth="025"
                    borderColor="border"
                    paddingBlockStart="400"
                  >
                    <GroupBlock
                      group={group}
                      groupTitle={tGroups(group.key)}
                    />
                  </Box>
                ) : (
                  <GroupBlock
                    group={group}
                    groupTitle={tGroups(group.key)}
                  />
                )}
              </Fragment>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
