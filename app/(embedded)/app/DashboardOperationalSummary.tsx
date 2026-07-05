"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BlockStack,
  Icon,
  InlineStack,
  Spinner,
  Text,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  ChevronRightIcon,
} from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import type { CbInqSplit, DashboardStats } from "./dashboardHelpers";
import { CbInqBreakdown } from "./CbInqBreakdown";

interface CardSpec {
  key: string;
  label: string;
  desc: string;
  count: number;
  icon: typeof AlertCircleIcon;
  iconBg: string;
  iconColor: string;
  borderColor: string | null;
  cta: { label: string; color: string } | null;
  url: string | null;
  split: CbInqSplit;
}

function OperationalCard({ card }: { card: CardSpec }) {
  const inner = (
    <div
      style={{
        background: "#fff",
        border: card.borderColor ? `2px solid ${card.borderColor}` : "1px solid #E1E3E5",
        borderRadius: "8px",
        padding: "20px",
        height: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        cursor: card.url ? "pointer" : "default",
        textDecoration: "none",
        color: "inherit",
        // Flex column so the cb·inq footer divider pins to the card floor
        // and aligns across all four operational cards.
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "8px",
            background: card.iconBg,
            color: card.iconColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon source={card.icon} />
        </div>
        <span style={{ fontSize: "30px", fontWeight: 700, color: "#202223", lineHeight: 1 }}>
          {card.count}
        </span>
      </div>
      <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#202223", margin: "0 0 4px" }}>
        {card.label}
      </h3>
      <p style={{ fontSize: "12px", color: "#6D7175", margin: "0 0 12px" }}>{card.desc}</p>
      {card.cta ? (
        <span
          style={{
            fontSize: "14px",
            fontWeight: 500,
            color: card.cta.color,
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          {card.cta.label}
          <span style={{ width: 16, height: 16, display: "inline-flex", color: card.cta.color }}>
            <Icon source={ChevronRightIcon} />
          </span>
        </span>
      ) : null}
      {/* Footer divider drawn unconditionally (design .Ops-foot) and
          pinned to the card floor so all four cards share one baseline,
          whether or not the card has a CTA above it. */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: "11px",
          borderTop: "1px solid #EEEFF1",
          minHeight: "17px",
        }}
      >
        <CbInqBreakdown split={card.split} hideWhenZero={false} />
      </div>
    </div>
  );

  return card.url ? (
    <Link href={card.url} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

interface Props {
  stats: DashboardStats;
  loading: boolean;
}

export function DashboardOperationalSummary({ stats, loading }: Props) {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  const s = stats;

  const actionNeeded =
    (s.operationalBreakdown["new"] ?? 0) +
    (s.operationalBreakdown["action_needed"] ?? 0) +
    (s.operationalBreakdown["needs_review"] ?? 0);
  const readyToSubmit = s.operationalBreakdown["ready_to_submit"] ?? 0;
  const waitingOnIssuer =
    (s.operationalBreakdown["waiting_on_issuer"] ?? 0) +
    (s.operationalBreakdown["submitted_to_bank"] ?? 0);

  // Sum the per-status cb·inq splits into the same buckets the counts use,
  // so each card's breakdown reconciles with its headline number.
  const sumSplit = (...keys: string[]): CbInqSplit =>
    keys.reduce(
      (acc, k) => {
        const sp = s.operationalSplit[k];
        if (sp) {
          acc.cb += sp.cb;
          acc.inq += sp.inq;
        }
        return acc;
      },
      { cb: 0, inq: 0 },
    );

  const cards: CardSpec[] = [
    {
      key: "action_needed",
      label: t("actionNeeded"),
      desc: t("actionNeededDesc"),
      count: actionNeeded,
      icon: AlertCircleIcon,
      iconBg: "#FEE2E2",
      iconColor: "#DC2626",
      borderColor: actionNeeded > 0 ? "#FCA5A5" : null,
      cta: actionNeeded > 0 ? { label: t("reviewCases"), color: "#DC2626" } : null,
      split: sumSplit("new", "action_needed", "needs_review"),
      url:
        actionNeeded === 1 && s.actionNeededDisputeId
          ? withShopParams(`/app/disputes/${s.actionNeededDisputeId}`, searchParams ?? new URLSearchParams())
          : withShopParams(
              "/app/disputes?normalized_status=new,action_needed,needs_review",
              searchParams ?? new URLSearchParams(),
            ),
    },
    {
      key: "ready_to_submit",
      label: t("readyToSubmit"),
      desc: t("readyToSubmitDesc"),
      count: readyToSubmit,
      icon: CheckCircleIcon,
      iconBg: "#FEF3C7",
      iconColor: "#D97706",
      borderColor: readyToSubmit > 0 ? "#FDE68A" : null,
      cta: readyToSubmit > 0 ? { label: t("submitNow"), color: "#D97706" } : null,
      split: sumSplit("ready_to_submit"),
      url: withShopParams(
        "/app/disputes?normalized_status=ready_to_submit",
        searchParams ?? new URLSearchParams(),
      ),
    },
    {
      key: "waiting_on_issuer",
      label: t("waitingOnIssuer"),
      desc: t("waitingOnIssuerDesc"),
      count: waitingOnIssuer,
      icon: ClockIcon,
      iconBg: "#DBEAFE",
      iconColor: "#005BD3",
      borderColor: null,
      cta: null,
      split: sumSplit("waiting_on_issuer", "submitted_to_bank"),
      url: withShopParams(
        "/app/disputes?normalized_status=waiting_on_issuer,submitted_to_bank",
        searchParams ?? new URLSearchParams(),
      ),
    },
    {
      key: "closed",
      label: t("closedInPeriod"),
      desc: t("closedInPeriodDesc"),
      count: s.totalClosed,
      icon: CheckCircleIcon,
      iconBg: "#F1F2F4",
      iconColor: "#6D7175",
      borderColor: null,
      cta: null,
      // Window-scoped split (closedSplit) so the footer sums to
      // totalClosed. NOT operationalClosedSplit, which is all-time and
      // would show 61 under a headline of 2.
      split: s.closedSplit,
      url: null,
    },
  ];

  if (loading) {
    return (
      <BlockStack gap="200">
        <InlineStack align="center"><Spinner size="small" /></InlineStack>
      </BlockStack>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "16px",
      }}
    >
      {cards.map((card) => (
        <OperationalCard key={card.key} card={card} />
      ))}
      {/* Visual fallback for screen readers — keeps the operational header in the DOM tree */}
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        <Text as="h2" variant="headingMd">{t("operationalSummary")}</Text>
      </span>
    </div>
  );
}
