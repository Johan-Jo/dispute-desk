"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  Icon,
} from "@shopify/polaris";
import { AlertTriangleIcon } from "@shopify/polaris-icons";
import {
  phaseBadgeTone,
  phaseLabel as phaseLabelFn,
  deriveFamily,
} from "@/lib/disputes/phaseUtils";
import type { DisputePhase } from "@/lib/rules/disputeReasons";
import type { Dispute, Pack, MatchedRule, DeadlineInfo } from "./utils";
import { formatCurrency, formatDate } from "./utils";

interface StatusHeroProps {
  dispute: Dispute;
  latestPack: Pack | null;
  deadline: DeadlineInfo;
  isAutomated: boolean;
  matchedRule: MatchedRule | null;
  disputeUrl: string | null;
  onPrimaryAction: () => void;
  primaryActionLoading: boolean;
}

type HeroState =
  | "terminal_won"
  | "terminal_lost"
  | "saved"
  | "ready"
  | "blocked"
  | "building"
  | "no_pack";

function deriveHeroState(dispute: Dispute, latestPack: Pack | null): HeroState {
  const s = dispute.status;
  if (s === "won") return "terminal_won";
  if (s === "lost" || s === "accepted" || s === "charge_refunded")
    return "terminal_lost";
  if (!latestPack) return "no_pack";
  const ps = latestPack.status;
  if (ps === "saved_to_shopify") return "saved";
  if (ps === "building" || ps === "queued") return "building";
  if (ps === "blocked" || (ps === "ready" && (latestPack.blockers?.length ?? 0) > 0))
    return "blocked";
  return "ready";
}

export default function StatusHero({
  dispute,
  latestPack,
  deadline,
  isAutomated,
  disputeUrl,
  onPrimaryAction,
  primaryActionLoading,
}: StatusHeroProps) {
  const t = useTranslations();
  const state = deriveHeroState(dispute, latestPack);
  const phase = dispute.phase as DisputePhase | null;

  const headline: Record<HeroState, string> = {
    no_pack: t("disputes.hero.noPackHeadline"),
    building: t("disputes.hero.buildingHeadline"),
    blocked: t("disputes.hero.blockedHeadline"),
    ready: t("disputes.hero.readyHeadline"),
    saved: t("disputes.hero.savedHeadline"),
    terminal_won: t("disputes.hero.wonHeadline"),
    terminal_lost: t("disputes.hero.lostHeadline"),
  };

  const explain: Record<HeroState, string> = {
    no_pack:
      phase === "inquiry"
        ? t("disputes.hero.noPackInquiryExplain")
        : t("disputes.hero.noPackChargebackExplain"),
    building: t("disputes.hero.buildingExplain"),
    blocked: t("disputes.hero.blockedExplain"),
    ready: t("disputes.hero.readyExplain"),
    saved: t("disputes.hero.savedExplain"),
    terminal_won: t("disputes.hero.wonExplain"),
    terminal_lost: t("disputes.hero.lostExplain"),
  };

  const ctaLabel: Record<HeroState, string> = {
    no_pack: t("disputes.hero.buildEvidencePack"),
    building: t("disputes.generating"),
    blocked: t("disputes.hero.completeEvidencePack"),
    ready: t("disputes.hero.reviewAndSaveToShopify"),
    saved: t("disputes.hero.openInShopify"),
    terminal_won: disputeUrl ? t("disputes.hero.openInShopify") : "",
    terminal_lost: disputeUrl ? t("disputes.hero.openInShopify") : "",
  };

  const isTerminal = state === "terminal_won" || state === "terminal_lost";
  const ctaDisabled = state === "building";
  const showCta = !(isTerminal && !disputeUrl);

  return (
    <Card>
      <BlockStack gap="400">
        {/* Badges row */}
        <InlineStack gap="200" blockAlign="center" wrap>
          <Badge tone={phaseBadgeTone(phase)}>
            {phaseLabelFn(phase, t)}
          </Badge>
          <Text as="span" variant="bodySm" tone="subdued">
            {deriveFamily(dispute.reason)}
          </Text>
          {isAutomated && (
            <Badge tone="info">{t("disputes.handlingAutomated")}</Badge>
          )}
        </InlineStack>

        {/* Headline */}
        <Text as="h2" variant="headingLg">
          {headline[state]}
        </Text>

        {/* Explanation */}
        <Text as="p" variant="bodyMd">
          {explain[state]}
        </Text>

        {/* Amount + deadline row */}
        <InlineStack gap="600" blockAlign="center" wrap>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("disputes.amount")}
            </Text>
            <Text as="span" variant="headingMd" fontWeight="bold">
              {formatCurrency(dispute.amount, dispute.currency_code)}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("disputes.dueDate")}
            </Text>
            <Text
              as="span"
              variant="headingMd"
              fontWeight="bold"
              tone={deadline.urgent ? "critical" : undefined}
            >
              {formatDate(dispute.due_at)}
            </Text>
          </BlockStack>
          {deadline.urgent && (
            <InlineStack gap="100" blockAlign="center">
              <Icon source={AlertTriangleIcon} tone="critical" />
              <Text as="span" variant="bodySm" tone="critical" fontWeight="semibold">
                {deadline.text}
              </Text>
            </InlineStack>
          )}
        </InlineStack>

        {/* Deadline banner when urgent */}
        {deadline.urgent && !isTerminal && (
          <Banner tone="warning">
            <Text as="p" variant="bodySm">
              {t("disputes.hero.deadlineWarning", {
                date: formatDate(dispute.due_at),
                daysText: deadline.text,
              })}
            </Text>
          </Banner>
        )}

        {/* Primary CTA */}
        {showCta && (
          <Button
            variant="primary"
            size="large"
            onClick={onPrimaryAction}
            loading={primaryActionLoading}
            disabled={ctaDisabled}
            fullWidth
          >
            {ctaLabel[state]}
          </Button>
        )}
      </BlockStack>
    </Card>
  );
}
