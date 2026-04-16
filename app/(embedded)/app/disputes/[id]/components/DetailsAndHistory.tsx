"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Collapsible,
  Icon,
} from "@shopify/polaris";
import {
  OrderIcon,
  PersonIcon,
  CheckCircleIcon,
  ChevronDownIcon,
} from "@shopify/polaris-icons";
import DisputeTimeline from "../DisputeTimeline";
import type {
  Dispute,
  DisputeProfile,
  MatchedRule,
} from "./utils";
import { formatDate, formatCurrency, formatAddress } from "./utils";
import styles from "../dispute-detail.module.css";

interface DetailsAndHistoryProps {
  dispute: Dispute;
  profile: DisputeProfile | null;
  matchedRule: MatchedRule | null;
  isAutomated: boolean;
  shopDomain: string | null;
  disputeId: string;
}

function ProfileRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className={styles.profileRow}>
      <span className={styles.profileRowLabel}>{label}</span>
      <span className={styles.profileRowValue}>{value || "\u2014"}</span>
    </div>
  );
}

export default function DetailsAndHistory({
  dispute,
  profile,
  matchedRule,
  isAutomated,
  shopDomain,
  disputeId,
}: DetailsAndHistoryProps) {
  const t = useTranslations();
  const [orderDataOpen, setOrderDataOpen] = useState(false);

  const orderNum = dispute.order_gid?.split("/").pop();

  return (
    <BlockStack gap="400">
      {/* Handling mode (only if automated or review) */}
      {(isAutomated || dispute.handling_mode === "review") && (
        <Card>
          <InlineStack gap="300" blockAlign="start">
            <Icon
              source={CheckCircleIcon}
              tone={isAutomated ? "success" : "warning"}
            />
            <BlockStack gap="100">
              <Text as="h3" variant="headingSm">
                {isAutomated
                  ? t("disputes.managedAutomatedTitle")
                  : t("disputes.managedReviewTitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {isAutomated
                  ? t("disputes.managedAutomatedDesc")
                  : t("disputes.managedReviewDesc")}
              </Text>
              {matchedRule && isAutomated && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("disputes.autoPackTriggered", {
                    name: matchedRule.name ?? "Default",
                  })}
                </Text>
              )}
            </BlockStack>
          </InlineStack>
        </Card>
      )}

      {/* Order Data (collapsible, default closed) */}
      <Card padding="0">
        <div
          className={styles.collapsibleHeader}
          onClick={() => setOrderDataOpen((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ")
              setOrderDataOpen((v) => !v);
          }}
        >
          <Text as="h2" variant="headingSm">
            {t("disputes.orderData")}
          </Text>
          <span
            className={`${styles.collapsibleHeaderIcon} ${orderDataOpen ? styles.collapsibleHeaderIconOpen : ""}`}
          >
            <Icon source={ChevronDownIcon} tone="subdued" />
          </span>
        </div>
        <Collapsible
          open={orderDataOpen}
          id="order-data"
          transition={{
            duration: "200ms",
            timingFunction: "ease-in-out",
          }}
        >
          <Box padding="400">
            <div className={styles.profileGrid}>
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "16px",
                  }}
                >
                  <Icon source={PersonIcon} tone="subdued" />
                  <Text as="h3" variant="headingSm">
                    {t("disputes.customerInfo")}
                  </Text>
                </div>
                <BlockStack gap="200">
                  <ProfileRow
                    label={t("disputes.name")}
                    value={profile?.customerName ?? "\u2014"}
                  />
                  <ProfileRow
                    label={t("disputes.email")}
                    value={profile?.email ?? "\u2014"}
                  />
                  <ProfileRow
                    label={t("disputes.phone")}
                    value={profile?.phone ?? "\u2014"}
                  />
                  <ProfileRow
                    label={t("disputes.address")}
                    value={formatAddress(
                      profile?.displayAddress ?? profile?.shippingAddress,
                    )}
                  />
                </BlockStack>
              </div>

              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "16px",
                  }}
                >
                  <Icon source={OrderIcon} tone="subdued" />
                  <Text as="h3" variant="headingSm">
                    {t("disputes.orderDetails")}
                  </Text>
                </div>
                <BlockStack gap="200">
                  <ProfileRow
                    label={t("disputes.orderId")}
                    value={
                      profile?.orderName ? (
                        shopDomain && orderNum ? (
                          <a
                            href={`https://${shopDomain}/admin/orders/${orderNum}`}
                            target="_top"
                            style={{
                              color: "#1D4ED8",
                              textDecoration: "none",
                            }}
                          >
                            {profile.orderName}
                          </a>
                        ) : (
                          profile.orderName
                        )
                      ) : orderNum ? (
                        `#${orderNum}`
                      ) : (
                        "\u2014"
                      )
                    }
                  />
                  <ProfileRow
                    label={t("disputes.date")}
                    value={formatDate(profile?.createdAt ?? null)}
                  />
                  {profile?.total && (
                    <ProfileRow
                      label="Total"
                      value={formatCurrency(
                        parseFloat(profile.total.amount),
                        profile.total.currencyCode,
                      )}
                    />
                  )}
                  {profile?.fulfillments &&
                    profile.fulfillments.flatMap((f) => f.trackingInfo).length >
                      0 &&
                    profile.fulfillments
                      .flatMap((f) => f.trackingInfo)
                      .slice(0, 2)
                      .map((trk, i) => (
                        <ProfileRow
                          key={i}
                          label={t("disputes.tracking")}
                          value={
                            trk.url ? (
                              <a
                                href={trk.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: "#1D4ED8",
                                  fontFamily: "monospace",
                                  fontSize: "12px",
                                }}
                              >
                                {trk.number}
                              </a>
                            ) : (
                              <span
                                style={{
                                  fontFamily: "monospace",
                                  fontSize: "12px",
                                }}
                              >
                                {trk.number}
                              </span>
                            )
                          }
                        />
                      ))}
                </BlockStack>
              </div>
            </div>
          </Box>
        </Collapsible>
      </Card>

      {/* Timeline */}
      <DisputeTimeline
        disputeId={disputeId}
        orderEvents={profile?.orderEvents ?? []}
      />
    </BlockStack>
  );
}
