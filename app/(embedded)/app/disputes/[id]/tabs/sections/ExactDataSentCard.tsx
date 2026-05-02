/**
 * ExactDataSentCard — Section 2 of ReviewSubmitTab.
 *
 * THE CRITICAL SECTION. Renders the bank-visible payload bucketed
 * into five fixed groups for readability. Field content is NEVER
 * transformed — values pass through byte-for-byte from
 * lib/shopify/formatEvidenceForShopify.ts.
 *
 * Forbidden in this section: skeleton bars, "loading…" text,
 * spinners, null flickers. When the payload is absent (pre-build
 * or empty pack), render the explicit empty-state copy and stop.
 *
 * Verification step #2 in the plan asserts that the union of
 * fields across all five rendered groups equals the Shopify
 * mutation snapshot.
 */

"use client";

import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Icon,
} from "@shopify/polaris";
import { FileIcon } from "@shopify/polaris-icons";
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

function AttachmentBlock({ attachment }: { attachment: DataSentAttachment }) {
  return (
    <InlineStack gap="200" blockAlign="center">
      <Icon source={FileIcon} />
      <Text as="span" variant="bodySm">
        {attachment.fileName ?? "Attachment"}
      </Text>
      <Text as="span" variant="bodySm" tone="subdued">
        {formatBytes(attachment.sizeBytes)}
      </Text>
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
  return (
    <BlockStack gap="200">
      <Text as="h3" variant="headingSm">
        {groupTitle}
      </Text>
      {group.fields.map((f) => (
        <FieldBlock key={f.shopifyFieldName} field={f} />
      ))}
      {group.attachments.length > 0 ? (
        <BlockStack gap="100">
          {group.attachments.map((a) => (
            <AttachmentBlock key={a.id} attachment={a} />
          ))}
        </BlockStack>
      ) : null}
    </BlockStack>
  );
}

interface Props {
  state: ReviewState;
  payload: DataSentGroup[] | null;
}

export function ExactDataSentCard({ state, payload }: Props) {
  const t = useTranslations("disputes.reviewTab.sections.dataSent");
  const tGroups = useTranslations("disputes.reviewTab.sections.dataSent.groups");

  const titleKey = state === "submitted" ? "title.submitted" : "title.unsubmitted";

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t(titleKey)}
        </Text>

        {payload === null ? (
          // Explicit empty state. NEVER a skeleton, NEVER "loading…".
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("empty")}
          </Text>
        ) : (
          <BlockStack gap="500">
            {payload.map((group) => (
              <GroupBlock
                key={group.key}
                group={group}
                groupTitle={tGroups(group.key)}
              />
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
