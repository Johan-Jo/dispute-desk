/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/disputes/[id]/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-dispute-detail.tsx
 * Reference: dispute detail layout, evidence section, actions.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import {
  Page,
  Layout,
  Banner,
  Spinner,
  Badge,
  Modal,
  Text,
} from "@shopify/polaris";
import { NoteIcon, RefreshIcon } from "@shopify/polaris-icons";

import styles from "./dispute-detail.module.css";
import StatusHero from "./components/StatusHero";
import EvidencePackModule from "./components/EvidencePackModule";
import KeyDisputeFacts from "./components/KeyDisputeFacts";
import DetailsAndHistory from "./components/DetailsAndHistory";
import {
  casePrimaryCta,
  disputeTitle,
} from "@/lib/disputes/phaseUtils";
import type { DisputePhase } from "@/lib/rules/disputeReasons";
import type {
  Dispute,
  DisputeProfile,
  Pack,
  MatchedRule,
} from "./components/utils";
import { daysUntilInfo } from "./components/utils";

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [profile, setProfile] = useState<DisputeProfile | null>(null);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [matchedRule, setMatchedRule] = useState<MatchedRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateCheckLoading, setTemplateCheckLoading] = useState(false);
  const [matchedTemplate, setMatchedTemplate] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const locale = searchParams.get("locale") ?? "";
    const profileUrl = locale
      ? `/api/disputes/${id}/profile?locale=${encodeURIComponent(locale)}`
      : `/api/disputes/${id}/profile`;
    const [res, profileRes] = await Promise.all([
      fetch(`/api/disputes/${id}`),
      fetch(profileUrl),
    ]);
    const json = await res.json();
    const profileJson = await profileRes.json();
    setDispute(json.dispute ?? null);
    setPacks(json.packs ?? []);
    setShopDomain(json.shop_domain ?? null);
    setMatchedRule(json.matchedRule ?? null);
    setProfile(profileJson.profile ?? null);
    setLoading(false);
  }, [id, searchParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch(`/api/disputes/${id}/sync`, { method: "POST" });
    await fetchData();
    setSyncing(false);
  };

  const doGenerate = async () => {
    setShowTemplateModal(false);
    setGenerating(true);
    setQuotaError(null);
    const res = await fetch(`/api/disputes/${id}/packs`, { method: "POST" });
    if (res.status === 403) {
      const data = await res.json();
      setQuotaError(data.error ?? t("disputes.planLimitMessage"));
    } else {
      const data = await res.json();
      if (data.packId) {
        router.push(withShopParams(`/app/packs/${data.packId}`, searchParams));
        return;
      }
      await fetchData();
    }
    setGenerating(false);
  };

  const doGenerateFromTemplate = async (templateId: string) => {
    setShowTemplateModal(false);
    setGenerating(true);
    setQuotaError(null);
    const res = await fetch(`/api/disputes/${id}/packs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId }),
    });
    if (res.status === 403) {
      const data = await res.json();
      setQuotaError(data.error ?? t("disputes.planLimitMessage"));
      setGenerating(false);
    } else {
      const data = await res.json();
      if (data.packId) {
        router.push(withShopParams(`/app/packs/${data.packId}`, searchParams));
      } else {
        await fetchData();
        setGenerating(false);
      }
    }
  };

  const handleGenerate = async () => {
    setTemplateCheckLoading(true);
    const locale = searchParams.get("locale") ?? "";
    const reason = dispute?.reason ?? "";
    try {
      const phase = dispute?.phase ?? "";
      const res = await fetch(
        `/api/templates?reason=${encodeURIComponent(reason)}&phase=${encodeURIComponent(phase)}&locale=${encodeURIComponent(locale)}`,
      );
      const { templates } = await res.json();
      const best =
        (
          templates as Array<{
            id: string;
            name: string;
            is_recommended?: boolean;
          }>
        )?.find((t) => t.is_recommended) ??
        templates?.[0] ??
        null;
      setMatchedTemplate(best ?? null);
    } catch {
      setMatchedTemplate(null);
    }
    setTemplateCheckLoading(false);
    setShowTemplateModal(true);
  };

  /* ── Loading / error states ── */

  if (loading) {
    return (
      <Page title={t("disputes.detailPageTitle")}>
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (!dispute) {
    return (
      <Page
        title={t("disputes.detailPageTitle")}
        backAction={{
          content: t("disputes.title"),
          url: withShopParams("/app/disputes", searchParams),
        }}
      >
        <Banner tone="critical">{t("disputes.disputeNotFound")}</Banner>
      </Page>
    );
  }

  /* ── Derived state ── */

  const isSynthetic = dispute.dispute_gid?.includes("/seed-") ?? false;
  const disputeNumericId =
    dispute.dispute_gid?.split("/").pop() ?? dispute.id;
  const disputeUrl =
    shopDomain && dispute.dispute_gid
      ? getShopifyDisputeUrl(shopDomain, dispute.dispute_gid)
      : null;
  const deadline = daysUntilInfo(dispute.due_at, t);
  const isAutomated = matchedRule?.mode === "auto_pack";
  const latestPack = packs.length > 0 ? packs[0] : null;
  const latestPackStatus = latestPack?.status ?? null;
  const cta = casePrimaryCta(
    dispute.phase as DisputePhase | null,
    latestPackStatus,
  );

  /* Hero CTA action — same logic as the Page-level primary action */
  const handleHeroCta = (() => {
    if (latestPackStatus === "saved_to_shopify" && disputeUrl) {
      return () => window.open(disputeUrl, "_top");
    }
    if (latestPack) {
      return () =>
        router.push(
          withShopParams(`/app/packs/${latestPack.id}`, searchParams),
        );
    }
    return handleGenerate;
  })();

  return (
    <Page
      title={disputeTitle(
        dispute.phase as DisputePhase | null,
        disputeNumericId,
        t,
      )}
      subtitle={t("disputes.orderDateSubtitle", {
        date: new Date(
          profile?.createdAt ?? dispute.initiated_at ?? "",
        ).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })}
      backAction={{
        content: t("disputes.title"),
        url: withShopParams("/app/disputes", searchParams),
      }}
      titleMetadata={
        isAutomated ? (
          <span className={styles.automatedBadge}>
            {"\u26A1"} {t("disputes.automatedBadge")}
          </span>
        ) : isSynthetic ? (
          <Badge tone="info">Synthetic</Badge>
        ) : undefined
      }
      primaryAction={{
        content:
          generating || templateCheckLoading
            ? t("disputes.generating")
            : t(cta.key),
        onAction: (() => {
          if (latestPackStatus === "saved_to_shopify" && disputeUrl) {
            return () => window.open(disputeUrl, "_top");
          }
          if (latestPack) {
            return () =>
              router.push(
                withShopParams(`/app/packs/${latestPack.id}`, searchParams),
              );
          }
          return handleGenerate;
        })(),
        loading: generating || templateCheckLoading || syncing,
        disabled: cta.disabled,
        icon: NoteIcon,
      }}
      secondaryActions={[
        {
          content: syncing
            ? t("disputes.reSyncing")
            : t("disputes.reSync"),
          onAction: handleSync,
          loading: syncing,
          icon: RefreshIcon,
        },
        ...(disputeUrl
          ? [
              {
                content: t("disputes.openDisputeInShopify"),
                url: disputeUrl,
                external: true,
              },
            ]
          : []),
      ]}
    >
      <Layout>
        {/* Tier 1: Status Hero */}
        <Layout.Section>
          <StatusHero
            dispute={dispute}
            latestPack={latestPack}
            deadline={deadline}
            isAutomated={isAutomated}
            matchedRule={matchedRule}
            disputeUrl={disputeUrl}
            onPrimaryAction={handleHeroCta}
            primaryActionLoading={
              generating || templateCheckLoading || syncing
            }
          />
        </Layout.Section>

        {/* Quota error banner */}
        {quotaError && (
          <Layout.Section>
            <Banner
              tone="warning"
              title={t("disputes.packLimitReached")}
              action={{
                content: t("disputes.upgradePlan"),
                url: "/app/billing",
              }}
              onDismiss={() => setQuotaError(null)}
            >
              <p>{quotaError}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Tier 2: Evidence Pack Module */}
        <Layout.Section>
          <EvidencePackModule
            packs={packs}
            latestPack={latestPack}
            onGenerate={handleGenerate}
            generating={generating}
            templateCheckLoading={templateCheckLoading}
          />
        </Layout.Section>

        {/* Tier 3: Key Dispute Facts */}
        <Layout.Section>
          <KeyDisputeFacts dispute={dispute} deadline={deadline} />
        </Layout.Section>

        {/* Tier 4: Details & History */}
        <Layout.Section>
          <DetailsAndHistory
            dispute={dispute}
            profile={profile}
            matchedRule={matchedRule}
            isAutomated={isAutomated}
            shopDomain={shopDomain}
            disputeId={id as string}
          />
        </Layout.Section>
      </Layout>

      {/* Template picker modal */}
      <Modal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        title={
          matchedTemplate
            ? t("disputes.templateFound")
            : t("disputes.noTemplate")
        }
        primaryAction={
          matchedTemplate
            ? {
                content: t("disputes.useTemplate"),
                onAction: () =>
                  doGenerateFromTemplate(matchedTemplate.id),
                loading: generating,
              }
            : {
                content: t("disputes.goToTemplateLibrary"),
                onAction: () => {
                  setShowTemplateModal(false);
                  router.push(
                    withShopParams("/app/packs", searchParams),
                  );
                },
              }
        }
        secondaryActions={[
          {
            content: t("disputes.generateBasic"),
            onAction: doGenerate,
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            {matchedTemplate
              ? t("disputes.templateFoundBody", {
                  name: matchedTemplate.name,
                })
              : t("disputes.noTemplateBody")}
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
