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
  ChartVerticalIcon,
  CheckCircleIcon,
  ClockIcon,
  ChevronRightIcon,
} from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import type { CbInqSplit, DashboardStats } from "./dashboardHelpers";
import { UNDER_REVIEW_NORMALIZED_STATUSES } from "./disputes/disputeListHelpers";
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
  cardBg: string | null;
  cta: { label: string; color: string } | null;
  url: string | null;
  split: CbInqSplit;
}

function OperationalCard({ card }: { card: CardSpec }) {
  const inner = (
    <div
      style={{
        background: card.cardBg ?? "#fff",
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

/**
 * Four operational cards — the mutually-exclusive partition from the
 * shared presentation model (design-alignment plan §4):
 *
 *   Building & monitoring — DisputeDesk is working (calm blue)
 *   Action required       — needs merchant input (amber; highlighted
 *                           ONLY when count > 0)
 *   Under review          — response sent, awaiting an outcome
 *   Closed                — outcome received (windowed by period)
 *
 * "Ready to Submit" and "Waiting on Issuer" are gone — DisputeDesk's
 * own work is never presented as a merchant queue.
 */
export function DashboardOperationalSummary({ stats, loading }: Props) {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  const s = stats;

  // Buckets from the stats route resolver. Legacy fallback keeps the
  // cards rendering against an older cached response shape.
  const buckets = s.operationalBuckets ?? null;
  const legacyAction =
    (s.operationalBreakdown["new"] ?? 0) +
    (s.operationalBreakdown["action_needed"] ?? 0) +
    (s.operationalBreakdown["needs_review"] ?? 0);
  const legacyUnderReview = UNDER_REVIEW_NORMALIZED_STATUSES.reduce(
    (sum, k) => sum + (s.operationalBreakdown[k] ?? 0),
    0,
  );
  const building =
    buckets?.building_monitoring ??
    {
      count: Math.max(0, s.activeDisputes - legacyAction - legacyUnderReview),
      cb: 0,
      inq: 0,
    };
  const action =
    buckets?.action_required ?? { count: legacyAction, cb: 0, inq: 0 };
  const underReview =
    buckets?.under_review ?? { count: legacyUnderReview, cb: 0, inq: 0 };
  const closed =
    buckets?.closed ??
    { count: s.totalClosed, cb: s.closedSplit.cb, inq: s.closedSplit.inq };

  const cards: CardSpec[] = [
    {
      key: "building_monitoring",
      label: t("buildingMonitoring"),
      desc: t("buildingMonitoringDesc"),
      count: building.count,
      icon: ChartVerticalIcon,
      iconBg: "#E0F2FE",
      iconColor: "#0369A1",
      borderColor: null,
      cardBg: null,
      cta: null,
      split: { cb: building.cb, inq: building.inq },
      url: withShopParams(
        "/app/disputes?normalized_status=new,in_progress,needs_review,ready_to_submit,action_needed",
        searchParams ?? new URLSearchParams(),
      ),
    },
    {
      key: "action_required",
      label: t("actionNeeded"),
      desc: t("actionNeededDesc"),
      count: action.count,
      icon: AlertCircleIcon,
      iconBg: "#FEF3C7",
      iconColor: "#B45309",
      // Highlighted ONLY when a genuine task exists (mockup behavior).
      borderColor: action.count > 0 ? "#F2C879" : null,
      cardBg: action.count > 0 ? "#FFFDF6" : null,
      cta: action.count > 0 ? { label: t("reviewCases"), color: "#B45309" } : null,
      split: { cb: action.cb, inq: action.inq },
      url: withShopParams(
        "/app/disputes?attention=tasks",
        searchParams ?? new URLSearchParams(),
      ),
    },
    {
      key: "under_review",
      label: t("underReviewCard"),
      desc: t("underReviewCardDesc"),
      count: underReview.count,
      icon: ClockIcon,
      iconBg: "#EDE9FE",
      iconColor: "#6D28D9",
      borderColor: null,
      cardBg: null,
      cta: null,
      split: { cb: underReview.cb, inq: underReview.inq },
      url: withShopParams(
        `/app/disputes?normalized_status=${UNDER_REVIEW_NORMALIZED_STATUSES.join(",")}`,
        searchParams ?? new URLSearchParams(),
      ),
    },
    {
      key: "closed",
      label: t("closedInPeriod"),
      desc: t("closedInPeriodDesc"),
      count: closed.count,
      icon: CheckCircleIcon,
      iconBg: "#F1F2F4",
      iconColor: "#4B5563",
      borderColor: null,
      cardBg: null,
      cta: null,
      split: { cb: closed.cb, inq: closed.inq },
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
