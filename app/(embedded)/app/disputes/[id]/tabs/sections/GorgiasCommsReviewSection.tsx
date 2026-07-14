/**
 * GorgiasCommsReviewSection — merchant review surface for Gorgias
 * communication evidence (evidence core, PR6).
 *
 * Data source: `workspace.data.gorgiasComms` (summaries only, riding the
 * existing ~4s poll). Full transcripts are lazily fetched from
 * GET /api/disputes/:id/gorgias/tickets/:matchedTicketId only when the
 * merchant opens a conversation — message bodies never ride the poll.
 *
 * Tiers (PRD §11):
 *   confirmed (high auto-confirmed + merchant-confirmed medium/low) —
 *     reviewable messages with Approve / Exclude, inline-editable AI
 *     explanation, "view conversation" transcript with manual add.
 *   medium proposed_match — "Possible matches": Confirm / Not related
 *     FIRST; messages stay hidden until the ticket is confirmed.
 *   low proposed_match — collapsed "Other possible conversations".
 *   rejected — hidden (audit retains them server-side).
 *
 * Approval requires selecting the excerpt: the approve dialog fetches
 * the transcript, pre-fills the full message text, and the merchant can
 * shorten it to the relevant passage. The server rejects non-verbatim
 * excerpts.
 *
 * After a content-affecting action the pack's `gorgiasEvidenceStale`
 * flag (set atomically by the review RPC) drives the "package out of
 * date" banner with a Regenerate CTA (same POST /api/packs/:id/
 * regenerate the upload flow uses). Approved evidence only enters a
 * pack through regeneration — never automatically.
 */

"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Collapsible,
  Icon,
  InlineStack,
  Modal,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertTriangleIcon } from "@shopify/polaris-icons";
import type { useDisputeWorkspace } from "../../hooks/useDisputeWorkspace";
import type {
  GorgiasCommsMessageSummary,
  GorgiasCommsTicketSummary,
} from "../../workspace-components/types";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

interface TranscriptMessage {
  id: string;
  senderType: "customer" | "merchant";
  senderName: string | null;
  sentAt: string | null;
  text: string;
  contentTruncated: boolean;
  evidenceCategory: string | null;
  relevanceExplanation: string | null;
  reviewStatus: string;
  needsReapproval: boolean;
}

interface Props {
  workspace: Workspace;
  disputeId: string;
}

const RUN_PROCESSING_STATUSES = new Set([
  "queued",
  "resolving_customer",
  "searching_tickets",
  "fetching_messages",
  "analyzing",
]);

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function GorgiasCommsReviewSection({ workspace, disputeId }: Props) {
  const t = useTranslations("disputes.gorgiasComms");
  const { data, actions } = workspace;
  const comms = data?.gorgiasComms ?? null;

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<
    Record<string, TranscriptMessage[] | "loading" | "error">
  >({});
  const [lowTierOpen, setLowTierOpen] = useState(false);
  const [editingExplanation, setEditingExplanation] = useState<{
    messageId: string;
    text: string;
  } | null>(null);
  const [approveTarget, setApproveTarget] = useState<{
    ticketId: string;
    messageId: string;
    action: "approve" | "manual_add";
    excerpt: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    ticketId: string;
    reason: string;
  } | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const loadTranscript = useCallback(
    async (matchedTicketId: string): Promise<TranscriptMessage[] | null> => {
      const cached = transcripts[matchedTicketId];
      if (Array.isArray(cached)) return cached;
      setTranscripts((s) => ({ ...s, [matchedTicketId]: "loading" }));
      try {
        const res = await fetch(
          `/api/disputes/${disputeId}/gorgias/tickets/${matchedTicketId}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { messages: TranscriptMessage[] };
        setTranscripts((s) => ({ ...s, [matchedTicketId]: body.messages }));
        return body.messages;
      } catch {
        setTranscripts((s) => ({ ...s, [matchedTicketId]: "error" }));
        return null;
      }
    },
    [disputeId, transcripts],
  );

  const messageAction = useCallback(
    async (
      body: Record<string, unknown>,
      busyKey: string,
    ): Promise<boolean> => {
      setBusy(busyKey);
      setActionError(null);
      try {
        const res = await fetch(
          `/api/disputes/${disputeId}/gorgias/message-review`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setActionError(err?.error ?? t("actionFailed"));
          return false;
        }
        // Fresh transcript + summaries on the next paint.
        setTranscripts({});
        await actions.fetchAll();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [disputeId, actions, t],
  );

  const ticketAction = useCallback(
    async (
      matchedTicketId: string,
      action: "confirm" | "reject" | "report_bad_match",
      reason?: string,
    ): Promise<boolean> => {
      setBusy(`ticket:${matchedTicketId}:${action}`);
      setActionError(null);
      try {
        const res = await fetch(
          `/api/disputes/${disputeId}/gorgias/ticket-review`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ matchedTicketId, action, reason }),
          },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setActionError(err?.error ?? t("actionFailed"));
          return false;
        }
        setTranscripts({});
        await actions.fetchAll();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [disputeId, actions, t],
  );

  const refreshEnrichment = useCallback(async () => {
    setBusy("enrich");
    setActionError(null);
    try {
      await fetch(`/api/disputes/${disputeId}/gorgias/enrich`, {
        method: "POST",
      });
      await actions.fetchAll();
    } finally {
      setBusy(null);
    }
  }, [disputeId, actions]);

  const regenerate = useCallback(async () => {
    if (!data?.pack) return;
    setRegenerating(true);
    try {
      await fetch(`/api/packs/${data.pack.id}/regenerate`, { method: "POST" });
      await actions.fetchAll();
    } finally {
      setRegenerating(false);
    }
  }, [data?.pack, actions]);

  const openApproveDialog = useCallback(
    async (
      ticketId: string,
      message: { id: string },
      action: "approve" | "manual_add",
    ) => {
      setApproveTarget({
        ticketId,
        messageId: message.id,
        action,
        excerpt: "",
        loading: true,
        error: null,
      });
      const msgs = await loadTranscript(ticketId);
      const full = msgs?.find((m) => m.id === message.id);
      setApproveTarget((s) =>
        s && s.messageId === message.id
          ? { ...s, excerpt: full?.text ?? "", loading: false }
          : s,
      );
    },
    [loadTranscript],
  );

  // Self-hide: no integration row, or nothing to show at all.
  if (!comms) return null;
  const visibleTickets = comms.tickets.filter(
    (tk) => tk.matchStatus !== "rejected_match",
  );
  const run = comms.latestRun;
  if (!run && visibleTickets.length === 0) return null;

  const confirmed = visibleTickets.filter(
    (tk) => tk.matchStatus === "confirmed_match",
  );
  const mediumProposed = visibleTickets.filter(
    (tk) => tk.matchStatus === "proposed_match" && tk.confidence === "medium",
  );
  const lowProposed = visibleTickets.filter(
    (tk) => tk.matchStatus === "proposed_match" && tk.confidence === "low",
  );

  const reconnectRequired = comms.errorCode === "reconnect_required";
  const processing = run ? RUN_PROCESSING_STATUSES.has(run.status) : false;

  // ── Status line ──
  let statusLine: React.ReactNode = null;
  if (reconnectRequired) {
    statusLine = (
      <Banner tone="warning" title={t("status.reconnectRequiredTitle")}>
        <p>{t("status.reconnectRequiredBody")}</p>
      </Banner>
    );
  } else if (processing) {
    statusLine = (
      <InlineStack gap="200" blockAlign="center">
        <Spinner size="small" accessibilityLabel={t("status.processing")} />
        <Text as="span" tone="subdued">
          {t("status.processing")}
        </Text>
      </InlineStack>
    );
  } else if (run?.status === "analysis_deferred") {
    statusLine = (
      <Banner tone="info" title={t("status.analysisDeferredTitle")}>
        <p>{t("status.analysisDeferredBody")}</p>
      </Banner>
    );
  } else if (
    run &&
    (run.status === "failed_retryable" || run.status === "failed_terminal")
  ) {
    statusLine = (
      <Banner tone="critical" title={t("status.failedTitle")}>
        <InlineStack gap="200" blockAlign="center">
          <p>{t("status.failedBody")}</p>
          <Button
            onClick={() => void refreshEnrichment()}
            loading={busy === "enrich"}
          >
            {t("status.retry")}
          </Button>
        </InlineStack>
      </Banner>
    );
  } else if (run?.status === "no_matches" && visibleTickets.length === 0) {
    statusLine = (
      <Text as="p" tone="subdued">
        {t("status.noMatches")}
      </Text>
    );
  }

  const staleBanner = data?.pack?.gorgiasEvidenceStale ? (
    <Banner tone="warning" title={t("staleBanner.title")}>
      <BlockStack gap="200">
        <p>{t("staleBanner.body")}</p>
        <InlineStack>
          <Button onClick={() => void regenerate()} loading={regenerating}>
            {t("staleBanner.cta")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  ) : null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("title")}
          </Text>
          {!processing && !reconnectRequired && (
            <Button
              variant="tertiary"
              onClick={() => void refreshEnrichment()}
              loading={busy === "enrich"}
            >
              {t("status.refresh")}
            </Button>
          )}
        </InlineStack>

        {statusLine}
        {staleBanner}
        {actionError && (
          <Banner tone="critical" onDismiss={() => setActionError(null)}>
            <p>{actionError}</p>
          </Banner>
        )}

        {/* ── Confirmed matches ── */}
        {confirmed.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            busy={busy}
            expanded={expandedTicket === ticket.id}
            transcript={transcripts[ticket.id]}
            onToggleExpand={() => {
              const next = expandedTicket === ticket.id ? null : ticket.id;
              setExpandedTicket(next);
              if (next) void loadTranscript(ticket.id);
            }}
            onApprove={(m) => void openApproveDialog(ticket.id, m, "approve")}
            onManualAdd={(m) =>
              void openApproveDialog(ticket.id, m, "manual_add")
            }
            onExclude={(m) =>
              void messageAction(
                { messageId: m.id, action: "exclude" },
                `msg:${m.id}`,
              )
            }
            onEditExplanation={(m) =>
              setEditingExplanation({
                messageId: m.id,
                text: m.relevanceExplanation ?? "",
              })
            }
            onReport={() => setReportTarget({ ticketId: ticket.id, reason: "" })}
          />
        ))}

        {/* ── Medium tier: confirm the match first ── */}
        {mediumProposed.length > 0 && (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("tier.possible")}
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {t("tier.possibleHint")}
            </Text>
            {mediumProposed.map((ticket) => (
              <Card key={ticket.id} background="bg-surface-secondary">
                <InlineStack align="space-between" blockAlign="center" gap="200">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {ticket.subject ?? `#${ticket.gorgiasTicketId}`}
                      </Text>
                      <Badge tone={confidenceTone(ticket.confidence)}>
                        {t(`confidence.${ticket.confidence}`)}
                      </Badge>
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {formatDate(ticket.ticketCreatedAt)}
                    </Text>
                    <MatchReasons ticket={ticket} t={t} />
                  </BlockStack>
                  <InlineStack gap="200">
                    <Button
                      onClick={() => void ticketAction(ticket.id, "confirm")}
                      loading={busy === `ticket:${ticket.id}:confirm`}
                    >
                      {t("ticket.confirm")}
                    </Button>
                    <Button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => void ticketAction(ticket.id, "reject")}
                      loading={busy === `ticket:${ticket.id}:reject`}
                    >
                      {t("ticket.notRelated")}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Card>
            ))}
          </BlockStack>
        )}

        {/* ── Low tier: collapsed ── */}
        {lowProposed.length > 0 && (
          <BlockStack gap="200">
            <Button
              variant="plain"
              disclosure={lowTierOpen ? "up" : "down"}
              onClick={() => setLowTierOpen((v) => !v)}
            >
              {t("tier.other", { count: lowProposed.length })}
            </Button>
            <Collapsible open={lowTierOpen} id="gorgias-low-tier">
              <BlockStack gap="100">
                {lowProposed.map((ticket) => (
                  <InlineStack
                    key={ticket.id}
                    align="space-between"
                    blockAlign="center"
                  >
                    <Text as="span" tone="subdued" variant="bodySm">
                      {ticket.subject ?? `#${ticket.gorgiasTicketId}`}
                    </Text>
                    <Button
                      variant="plain"
                      onClick={() => void ticketAction(ticket.id, "confirm")}
                      loading={busy === `ticket:${ticket.id}:confirm`}
                    >
                      {t("ticket.confirm")}
                    </Button>
                  </InlineStack>
                ))}
              </BlockStack>
            </Collapsible>
          </BlockStack>
        )}
      </BlockStack>

      {/* ── Approve / manual-add dialog with excerpt selection ── */}
      <Modal
        open={approveTarget !== null}
        onClose={() => setApproveTarget(null)}
        title={t("approveModal.title")}
        primaryAction={{
          content: t("approveModal.confirm"),
          loading: busy?.startsWith("msg:") ?? false,
          disabled:
            approveTarget?.loading ||
            !approveTarget?.excerpt.trim(),
          onAction: () => {
            if (!approveTarget) return;
            void (async () => {
              const ok = await messageAction(
                {
                  messageId: approveTarget.messageId,
                  action: approveTarget.action,
                  excerpt: approveTarget.excerpt,
                },
                `msg:${approveTarget.messageId}`,
              );
              if (ok) setApproveTarget(null);
            })();
          },
        }}
        secondaryActions={[
          {
            content: t("approveModal.cancel"),
            onAction: () => setApproveTarget(null),
          },
        ]}
      >
        <Modal.Section>
          {approveTarget?.loading ? (
            <Spinner accessibilityLabel={t("conversationLoading")} />
          ) : (
            <TextField
              label={t("approveModal.excerptLabel")}
              helpText={t("approveModal.excerptHelp")}
              value={approveTarget?.excerpt ?? ""}
              onChange={(v) =>
                setApproveTarget((s) => (s ? { ...s, excerpt: v } : s))
              }
              multiline={6}
              autoComplete="off"
            />
          )}
        </Modal.Section>
      </Modal>

      {/* ── Edit explanation dialog ── */}
      <Modal
        open={editingExplanation !== null}
        onClose={() => setEditingExplanation(null)}
        title={t("message.editExplanation")}
        primaryAction={{
          content: t("message.saveExplanation"),
          disabled: !editingExplanation?.text.trim(),
          loading: busy?.startsWith("msg:") ?? false,
          onAction: () => {
            if (!editingExplanation) return;
            void (async () => {
              const ok = await messageAction(
                {
                  messageId: editingExplanation.messageId,
                  action: "edit_explanation",
                  explanation: editingExplanation.text,
                },
                `msg:${editingExplanation.messageId}`,
              );
              if (ok) setEditingExplanation(null);
            })();
          },
        }}
        secondaryActions={[
          {
            content: t("message.cancel"),
            onAction: () => setEditingExplanation(null),
          },
        ]}
      >
        <Modal.Section>
          <TextField
            label={t("message.editExplanation")}
            value={editingExplanation?.text ?? ""}
            onChange={(v) =>
              setEditingExplanation((s) => (s ? { ...s, text: v } : s))
            }
            multiline={3}
            autoComplete="off"
          />
        </Modal.Section>
      </Modal>

      {/* ── Report bad match dialog ── */}
      <Modal
        open={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        title={t("reportModal.title")}
        primaryAction={{
          content: t("reportModal.submit"),
          loading: busy?.includes(":report_bad_match") ?? false,
          onAction: () => {
            if (!reportTarget) return;
            void (async () => {
              const ok = await ticketAction(
                reportTarget.ticketId,
                "report_bad_match",
                reportTarget.reason,
              );
              if (ok) setReportTarget(null);
            })();
          },
        }}
        secondaryActions={[
          {
            content: t("reportModal.cancel"),
            onAction: () => setReportTarget(null),
          },
        ]}
      >
        <Modal.Section>
          <TextField
            label={t("reportModal.reasonLabel")}
            value={reportTarget?.reason ?? ""}
            onChange={(v) =>
              setReportTarget((s) => (s ? { ...s, reason: v } : s))
            }
            multiline={2}
            autoComplete="off"
          />
        </Modal.Section>
      </Modal>
    </Card>
  );
}

/**
 * Confidence tier → Polaris Badge tone. The merchant never sees the raw
 * additive match score (that lives in the internal admin view); the tier
 * is surfaced as a plain "Strong / Possible match" label instead.
 */
function confidenceTone(
  confidence: GorgiasCommsTicketSummary["confidence"],
): "success" | "attention" | "info" {
  if (confidence === "high") return "success";
  if (confidence === "medium") return "attention";
  return "info";
}

/**
 * MatchReasons — the "why we matched this" fact list. Each stored reason
 * becomes a plain-English line a human can verify at a glance (with the
 * real order #, tracking #, etc. interpolated from `detail`). Positive
 * signals get a green check; negative signals (conflicting email, a
 * different order referenced) are shown as red warnings rather than
 * hidden, so a reviewing merchant sees the red flags too.
 */
function MatchReasons({
  ticket,
  t,
}: {
  ticket: GorgiasCommsTicketSummary;
  t: ReturnType<typeof useTranslations<"disputes.gorgiasComms">>;
}) {
  if (ticket.matchReasons.length === 0) return null;
  const positives = ticket.matchReasons.filter((r) => r.points > 0);
  const negatives = ticket.matchReasons.filter((r) => r.points < 0);
  // The reason key is dynamic and some messages interpolate {detail}
  // while others don't; cast to a permissive signature so passing the
  // detail value for every reason doesn't fight next-intl's per-key
  // value typing.
  const tr = t as unknown as (k: string, v?: Record<string, string>) => string;
  return (
    <BlockStack gap="050">
      <Text as="span" tone="subdued" variant="bodySm">
        {t("reasonsHeading")}
      </Text>
      {[...positives, ...negatives].map((r, i) => {
        const negative = r.points < 0;
        return (
          <InlineStack key={`${r.signal}-${i}`} gap="100" blockAlign="center" wrap={false}>
            <span style={{ flexShrink: 0, width: 16, height: 16 }}>
              <Icon
                source={negative ? AlertTriangleIcon : CheckCircleIcon}
                tone={negative ? "critical" : "success"}
              />
            </span>
            <Text as="span" tone={negative ? "critical" : "subdued"} variant="bodySm">
              {tr(`reason.${r.signal}`, { detail: r.detail ?? "" })}
            </Text>
          </InlineStack>
        );
      })}
    </BlockStack>
  );
}

function TicketCard({
  ticket,
  busy,
  expanded,
  transcript,
  onToggleExpand,
  onApprove,
  onManualAdd,
  onExclude,
  onEditExplanation,
  onReport,
}: {
  ticket: GorgiasCommsTicketSummary;
  busy: string | null;
  expanded: boolean;
  transcript: TranscriptMessage[] | "loading" | "error" | undefined;
  onToggleExpand: () => void;
  onApprove: (m: GorgiasCommsMessageSummary) => void;
  onManualAdd: (m: { id: string }) => void;
  onExclude: (m: GorgiasCommsMessageSummary) => void;
  onEditExplanation: (m: GorgiasCommsMessageSummary) => void;
  onReport: () => void;
}) {
  const t = useTranslations("disputes.gorgiasComms");

  return (
    <Card background="bg-surface-secondary">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="200">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" fontWeight="semibold">
                {ticket.subject ?? `#${ticket.gorgiasTicketId}`}
              </Text>
              <Badge tone={confidenceTone(ticket.confidence)}>
                {t(`confidence.${ticket.confidence}`)}
              </Badge>
            </InlineStack>
            <Text as="span" tone="subdued" variant="bodySm">
              {formatDate(ticket.ticketCreatedAt)}
              {ticket.channel ? ` · ${ticket.channel}` : ""}
            </Text>
            <MatchReasons ticket={ticket} t={t} />
          </BlockStack>
          <Button variant="plain" tone="critical" onClick={onReport}>
            {t("ticket.reportBadMatch")}
          </Button>
        </InlineStack>

        {/* Proposed + approved messages (summaries; bodies via transcript) */}
        {ticket.reviewableMessages.map((m) => (
          <div
            key={m.id}
            style={{
              borderLeft: "3px solid var(--p-color-border)",
              paddingLeft: 12,
            }}
          >
            <BlockStack gap="150">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="medium" variant="bodySm">
                  {m.senderType === "customer"
                    ? t("message.customer")
                    : t("message.merchant")}
                </Text>
                <Text as="span" tone="subdued" variant="bodySm">
                  {formatDate(m.sentAt)}
                </Text>
                {m.evidenceCategory && (
                  <Badge size="small">
                    {t(
                      `category.${m.evidenceCategory}` as Parameters<
                        ReturnType<typeof useTranslations>
                      >[0],
                    )}
                  </Badge>
                )}
                {m.reviewStatus === "approved" || m.reviewStatus === "manual" ? (
                  <Badge tone="success" size="small">
                    {t("message.approvedBadge")}
                  </Badge>
                ) : (
                  <Badge tone="attention" size="small">
                    {t("message.proposedBadge")}
                  </Badge>
                )}
                {m.needsReapproval && (
                  <Badge tone="warning" size="small">
                    {t("message.needsReapprovalBadge")}
                  </Badge>
                )}
              </InlineStack>

              {/* Verbatim proof from the actual conversation. Approved
                  messages show the merchant-approved excerpt; proposed
                  messages show a preview of the customer's own words so
                  the merchant can see the evidence really came from the
                  support thread, not just the AI's one-line summary. */}
              {(m.approvedExcerptPreview ?? m.messagePreview) && (
                <BlockStack gap="050">
                  <Text as="span" tone="subdued" variant="bodyXs">
                    {t("message.fromConversation")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    “{m.approvedExcerptPreview ?? m.messagePreview}”
                  </Text>
                </BlockStack>
              )}
              {m.relevanceExplanation && (
                <Text as="p" tone="subdued" variant="bodySm">
                  {m.relevanceExplanation}
                </Text>
              )}

              <InlineStack gap="200">
                {(m.reviewStatus === "proposed" || m.needsReapproval) && (
                  <Button
                    size="slim"
                    onClick={() => onApprove(m)}
                    loading={busy === `msg:${m.id}`}
                  >
                    {t("message.approve")}
                  </Button>
                )}
                {m.reviewStatus !== "excluded" && (
                  <Button
                    size="slim"
                    variant="tertiary"
                    onClick={() => onExclude(m)}
                    loading={busy === `msg:${m.id}`}
                  >
                    {t("message.exclude")}
                  </Button>
                )}
                <Button
                  size="slim"
                  variant="plain"
                  onClick={() => onEditExplanation(m)}
                >
                  {t("message.editExplanation")}
                </Button>
              </InlineStack>
            </BlockStack>
          </div>
        ))}

        <Button
          variant="plain"
          disclosure={expanded ? "up" : "down"}
          onClick={onToggleExpand}
        >
          {expanded ? t("ticket.hideConversation") : t("ticket.viewConversation")}
        </Button>
        <Collapsible open={expanded} id={`gorgias-transcript-${ticket.id}`}>
          {transcript === "loading" && (
            <Spinner size="small" accessibilityLabel={t("conversationLoading")} />
          )}
          {transcript === "error" && (
            <Text as="p" tone="critical" variant="bodySm">
              {t("conversationError")}
            </Text>
          )}
          {Array.isArray(transcript) && (
            <BlockStack gap="200">
              {transcript.map((m) => (
                <div key={m.id}>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="medium" variant="bodySm">
                      {m.senderType === "customer"
                        ? t("message.customer")
                        : t("message.merchant")}
                      {m.senderName ? ` (${m.senderName})` : ""}
                    </Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {formatDate(m.sentAt)}
                    </Text>
                    {m.reviewStatus === "candidate" && (
                      <Button
                        size="micro"
                        variant="plain"
                        onClick={() => onManualAdd(m)}
                      >
                        {t("message.addAsEvidence")}
                      </Button>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm">
                    {m.text}
                    {m.contentTruncated ? ` ${t("message.truncatedNote")}` : ""}
                  </Text>
                </div>
              ))}
            </BlockStack>
          )}
        </Collapsible>
      </BlockStack>
    </Card>
  );
}
