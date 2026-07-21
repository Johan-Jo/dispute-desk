/**
 * GorgiasCommsReviewSection — merchant review surface for Gorgias
 * communication evidence (evidence core, PR6).
 *
 * Data source: `workspace.data.gorgiasComms` (summaries only, riding the
 * existing ~4s poll). Full transcripts are lazily fetched from
 * GET /api/disputes/:id/gorgias/tickets/:matchedTicketId only when the
 * merchant opens a conversation — message bodies never ride the poll.
 *
 * Visual language matches the "Evidence in your defence package" card
 * (`EvidenceUsedSection` / `EvidenceRow`) per the `Dispute Evidence.html`
 * design: one `.icard`, disposition groups marked by a coloured dot chip
 * + count + helper, `.evrow` ticket rows, per-message boxes with a
 * category tag + review-status spill + inline "View full conversation".
 * The two cards read as one system.
 *
 * Tiers (PRD §11):
 *   Matched conversation (high auto-confirmed + merchant-confirmed) —
 *     reviewable messages with Approve / Exclude, inline-editable AI
 *     explanation, inline transcript with manual add.
 *   Possible matches (medium proposed_match) — Confirm / Not related
 *     FIRST; messages stay hidden until the ticket is confirmed.
 *   Other possible conversations (low proposed_match) — collapsed.
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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Banner,
  BlockStack,
  Button,
  InlineStack,
  Modal,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
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

// Matches EvidenceUsedSection's DISPOSITION_COLORS + the design's chip
// palette so the Gorgias card reads as the same green/grey family as the
// evidence card directly above it.
const MATCHED_COLORS = { dot: "#059669", chipBg: "#DCFCE7", chipText: "#065F46" };
const POSSIBLE_COLORS = { dot: "#9CA3AF", chipBg: "#F3F4F6", chipText: "#374151" };

const CARD_STYLE: CSSProperties = {
  background: "#fff",
  border: "1px solid #E1E3E5",
  borderRadius: 12,
  padding: 20,
};

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

  // Deep-link spotlight: when the evidence-ready email lands the merchant
  // here (`?section=gorgias-comms`), scroll this card into view and pulse a
  // temporary highlight ring around the messages awaiting approval, then
  // fade it. Runs once, after the card has mounted with content. Hooks must
  // precede the early returns below (rules-of-hooks), so they live here.
  const searchParams = useSearchParams();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const spotlightApplied = useRef(false);
  const [spotlight, setSpotlight] = useState(false);
  const isSpotlightTarget =
    searchParams.get("section") === "gorgias-comms" && comms !== null;
  useEffect(() => {
    if (spotlightApplied.current || !isSpotlightTarget || !cardRef.current) return;
    spotlightApplied.current = true;
    const el = cardRef.current;
    // Wait a tick so the Evidence tab panel is painted before scrolling.
    const scrollTimer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setSpotlight(true);
    }, 250);
    // Fade the ring after it has done its job.
    const fadeTimer = window.setTimeout(() => setSpotlight(false), 4200);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(fadeTimer);
    };
  }, [isSpotlightTarget]);

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
    setActionError(null);
    try {
      const res = await fetch(`/api/packs/${data.pack.id}/regenerate`, {
        method: "POST",
      });
      if (!res.ok) {
        // Surface the failure instead of silently reverting — e.g. a
        // 409 WINDOW_CLOSED / INVALID_REGENERATE_WINDOW when the dispute
        // was already forwarded to the bank. The route returns a human
        // `message`; fall back to `error` then the generic copy.
        const err = (await res.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        setActionError(err?.message ?? err?.error ?? t("actionFailed"));
        return;
      }
      await actions.fetchAll();
    } finally {
      setRegenerating(false);
    }
  }, [data?.pack, actions, t]);

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
  let statusLine: ReactNode = null;
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

  // Once Shopify has forwarded the dispute to the bank the package can
  // no longer change, so `POST /regenerate` hard-returns 409. Offering a
  // Regenerate button there is a dead end (the bug the merchant hit:
  // "clicked Regenerate, nothing happened"). Show an honest note instead.
  const windowClosed = data?.dispute?.submissionState === "submitted_confirmed";

  // The "package is out of date → Regenerate" prompt is only meaningful
  // once there is APPROVED communication evidence not yet in the pack.
  // The stale flag alone can be set by any content-affecting review action
  // (approve/exclude/reset) — showing Regenerate while every message is
  // still "Proposed" invites a no-op rebuild and reads as broken pedagogy.
  // Gate on both: the flag AND at least one approved/manual message.
  const approvedMessageCount = visibleTickets.reduce(
    (sum, tk) => sum + (tk.counts?.approved ?? 0),
    0,
  );
  const staleBanner = data?.pack?.gorgiasEvidenceStale && approvedMessageCount > 0 ? (
    windowClosed ? (
      <Banner tone="info" title={t("staleBanner.windowClosedTitle")}>
        <p>{t("staleBanner.windowClosedBody")}</p>
      </Banner>
    ) : (
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
    )
  ) : null;

  const hasPossibleGroup = mediumProposed.length > 0;

  return (
    <div
      id="gorgias-comms"
      ref={cardRef}
      data-spotlight={spotlight ? "true" : "false"}
      style={{
        ...CARD_STYLE,
        transition: "box-shadow 400ms ease, border-color 400ms ease",
        ...(spotlight
          ? {
              borderColor: "#F59E0B",
              boxShadow:
                "0 0 0 3px rgba(245, 158, 11, 0.45), 0 8px 24px rgba(245, 158, 11, 0.18)",
            }
          : {}),
      }}
    >
      {/* Deep-link spotlight: ring the messages awaiting approval so the
          merchant sees exactly what to act on. Fades with the card ring. */}
      <style>{`
        #gorgias-comms[data-spotlight="true"] .gorgias-msg-box[data-awaiting-approval="true"] {
          border-color: #F59E0B;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.35);
          animation: gorgiasApprovePulse 1.1s ease-in-out 3;
        }
        .gorgias-msg-box {
          transition: box-shadow 400ms ease, border-color 400ms ease;
        }
        @keyframes gorgiasApprovePulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.30); }
          50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.55); }
        }
        @media (prefers-reduced-motion: reduce) {
          #gorgias-comms[data-spotlight="true"] .gorgias-msg-box[data-awaiting-approval="true"] {
            animation: none;
          }
        }
      `}</style>
      {/* Header — title + subtitle + Refresh, matching the evidence card */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#202223",
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {t("title")}
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "#6D7175",
              lineHeight: 1.5,
              margin: "4px 0 0",
              maxWidth: 640,
            }}
          >
            {t("subtitle")}
          </p>
        </div>
        {!processing && !reconnectRequired && (
          <div style={{ flex: "none" }}>
            <Button
              onClick={() => void refreshEnrichment()}
              loading={busy === "enrich"}
            >
              {t("status.refresh")}
            </Button>
          </div>
        )}
      </div>

      {(statusLine || staleBanner || actionError) && (
        <div style={{ marginBottom: 16 }}>
          <BlockStack gap="300">
            {statusLine}
            {staleBanner}
            {actionError && (
              <Banner tone="critical" onDismiss={() => setActionError(null)}>
                <p>{actionError}</p>
              </Banner>
            )}
          </BlockStack>
        </div>
      )}

      {/* ── Matched conversation (confirmed) ── */}
      {confirmed.length > 0 && (
        <DispositionGroup
          colors={MATCHED_COLORS}
          title={t("tier.matched")}
          count={confirmed.length}
          helper={t("tier.matchedHint")}
          isFirst
        >
          {confirmed.map((ticket, i) => (
            <MatchedTicket
              key={ticket.id}
              ticket={ticket}
              isFirst={i === 0}
              busy={busy}
              transcript={transcripts[ticket.id]}
              t={t}
              onOpenTranscript={() => void loadTranscript(ticket.id)}
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
              onReport={() =>
                setReportTarget({ ticketId: ticket.id, reason: "" })
              }
            />
          ))}
        </DispositionGroup>
      )}

      {/* ── Possible matches (medium) + low-tier collapsed link ── */}
      {(hasPossibleGroup || lowProposed.length > 0) && (
        <DispositionGroup
          colors={POSSIBLE_COLORS}
          title={t("tier.possible")}
          count={mediumProposed.length}
          helper={t("tier.possibleHint")}
          isFirst={confirmed.length === 0}
        >
          {mediumProposed.map((ticket) => (
            <PossibleTicket
              key={ticket.id}
              ticket={ticket}
              busy={busy}
              transcript={transcripts[ticket.id]}
              t={t}
              onOpenTranscript={() => void loadTranscript(ticket.id)}
              onManualAdd={(m) =>
                void openApproveDialog(ticket.id, m, "manual_add")
              }
              onConfirm={() => void ticketAction(ticket.id, "confirm")}
              onReject={() => void ticketAction(ticket.id, "reject")}
            />
          ))}

          {lowProposed.length > 0 && (
            <div style={{ marginTop: mediumProposed.length > 0 ? 12 : 0 }}>
              <Button
                variant="plain"
                disclosure={lowTierOpen ? "up" : "down"}
                onClick={() => setLowTierOpen((v) => !v)}
              >
                {t("tier.other", { count: lowProposed.length })}
              </Button>
              {lowTierOpen && (
                <div style={{ marginTop: 8 }}>
                  <BlockStack gap="100">
                    {lowProposed.map((ticket) => (
                      <div
                        key={ticket.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
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
                      </div>
                    ))}
                  </BlockStack>
                </div>
              )}
            </div>
          )}
        </DispositionGroup>
      )}

      {/* ── Approve / manual-add dialog with excerpt selection ── */}
      <Modal
        open={approveTarget !== null}
        onClose={() => setApproveTarget(null)}
        title={t("approveModal.title")}
        primaryAction={{
          content: t("approveModal.confirm"),
          loading: busy?.startsWith("msg:") ?? false,
          disabled: approveTarget?.loading || !approveTarget?.excerpt.trim(),
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
    </div>
  );
}

type GorgiasT = ReturnType<typeof useTranslations<"disputes.gorgiasComms">>;

/**
 * DispositionGroup — coloured dot chip + count + helper, wrapping the
 * rows. Mirrors EvidenceUsedSection's DispositionSection so the Gorgias
 * groups line up visually with the evidence card's buckets.
 */
function DispositionGroup({
  colors,
  title,
  count,
  helper,
  isFirst,
  children,
}: {
  colors: { dot: string; chipBg: string; chipText: string };
  title: string;
  count: number;
  helper: string;
  isFirst: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        paddingTop: isFirst ? 0 : 12,
        marginTop: isFirst ? 0 : 16,
        borderTop: isFirst ? "0" : "1px solid #E1E3E5",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 4,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: colors.chipBg,
            color: colors.chipText,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: colors.dot,
            }}
          />
          {title}{" "}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{count}</span>
        </span>
      </div>
      <p
        style={{
          fontSize: 12.5,
          color: "#6D7175",
          lineHeight: 1.4,
          margin: "0 0 12px",
        }}
      >
        {helper}
      </p>
      {children}
    </div>
  );
}

/** Confidence tier → plain-language chip (Strong / Possible / Unlikely). */
function ConfidenceChip({
  confidence,
  t,
}: {
  confidence: GorgiasCommsTicketSummary["confidence"];
  t: GorgiasT;
}) {
  const c =
    confidence === "high"
      ? MATCHED_COLORS
      : confidence === "medium"
        ? { dot: "#D97706", chipBg: "#FEF3C7", chipText: "#92400E" }
        : POSSIBLE_COLORS;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        flex: "none",
        background: c.chipBg,
        color: c.chipText,
      }}
    >
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot }}
      />
      {t(`confidence.${confidence}`)}
    </span>
  );
}

/** Review-status spill for a message box (Proposed / Approved / re-approval). */
function ReviewSpill({
  message,
  t,
}: {
  message: GorgiasCommsMessageSummary;
  t: GorgiasT;
}) {
  const approved =
    message.reviewStatus === "approved" || message.reviewStatus === "manual";
  const style: { bg: string; color: string; label: string } = message.needsReapproval
    ? { bg: "#FEF3C7", color: "#78350F", label: t("message.needsReapprovalBadge") }
    : approved
      ? { bg: "#D1FAE5", color: "#065F46", label: t("message.approvedBadge") }
      : { bg: "#FEF3C7", color: "#92400E", label: t("message.proposedBadge") };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        alignSelf: "start",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: style.bg,
        color: style.color,
      }}
    >
      {style.label}
    </span>
  );
}

/** Category tag (grey), matching the design's `.tag`. */
function CategoryTag({ category, t }: { category: string; t: GorgiasT }) {
  const tc = t as unknown as (k: string) => string;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 12,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: 6,
        background: "#F1F2F3",
        color: "#4B5563",
      }}
    >
      {tc(`category.${category}`)}
    </span>
  );
}

/** Compact comma-joined reason line (positive signals only), per design. */
function reasonText(ticket: GorgiasCommsTicketSummary, t: GorgiasT): string {
  const tr = t as unknown as (k: string) => string;
  return ticket.matchReasons
    .filter((r) => r.points > 0)
    .map((r) => tr(`reason.${r.signal}`))
    .join(", ");
}

function ticketMetaLine(ticket: GorgiasCommsTicketSummary, t: GorgiasT): string {
  const parts = [formatDate(ticket.ticketCreatedAt)];
  if (ticket.channel) parts.push(ticket.channel);
  const reasons = reasonText(ticket, t);
  if (reasons) parts.push(reasons);
  return parts.join(" · ");
}

/**
 * Inline "View full conversation" disclosure — native <details> matching
 * the design's `.conv`, lazily loading the ticket transcript on open.
 */
function ConversationDetails({
  transcript,
  onOpen,
  onManualAdd,
  t,
}: {
  transcript: TranscriptMessage[] | "loading" | "error" | undefined;
  onOpen: () => void;
  onManualAdd: (m: { id: string }) => void;
  t: GorgiasT;
}) {
  return (
    <details
      style={{ marginTop: 12 }}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) onOpen();
      }}
    >
      <summary
        style={{
          listStyle: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 13,
          fontWeight: 600,
          color: "#005BD3",
        }}
      >
        {t("ticket.viewConversation")}
      </summary>
      <div
        style={{
          marginTop: 10,
          border: "1px solid #E1E3E5",
          borderRadius: 10,
          padding: "12px 14px",
          background: "#FAFBFB",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {transcript === "loading" && (
          <Spinner size="small" accessibilityLabel={t("conversationLoading")} />
        )}
        {transcript === "error" && (
          <Text as="p" tone="critical" variant="bodySm">
            {t("conversationError")}
          </Text>
        )}
        {Array.isArray(transcript) &&
          transcript.map((m) => (
            <div key={m.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "#202223" }}>
                  {m.senderType === "customer"
                    ? t("message.customer")
                    : t("message.merchant")}
                  {m.senderName ? ` (${m.senderName})` : ""}
                </span>
                <span style={{ fontSize: 11, color: "#6D7175" }}>
                  {formatDate(m.sentAt)}
                </span>
                {m.reviewStatus === "candidate" && (
                  <Button
                    size="micro"
                    variant="plain"
                    onClick={() => onManualAdd(m)}
                  >
                    {t("message.addAsEvidence")}
                  </Button>
                )}
              </div>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "#4B5563",
                }}
              >
                {m.text}
                {m.contentTruncated ? ` ${t("message.truncatedNote")}` : ""}
              </p>
            </div>
          ))}
      </div>
    </details>
  );
}

/** A single reviewable message box inside a confirmed ticket. */
function MessageBox({
  message,
  busy,
  transcript,
  t,
  onOpenTranscript,
  onApprove,
  onManualAdd,
  onExclude,
  onEditExplanation,
}: {
  message: GorgiasCommsMessageSummary;
  busy: string | null;
  transcript: TranscriptMessage[] | "loading" | "error" | undefined;
  t: GorgiasT;
  onOpenTranscript: () => void;
  onApprove: (m: GorgiasCommsMessageSummary) => void;
  onManualAdd: (m: { id: string }) => void;
  onExclude: (m: GorgiasCommsMessageSummary) => void;
  onEditExplanation: (m: GorgiasCommsMessageSummary) => void;
}) {
  const awaitingApproval =
    message.reviewStatus === "proposed" || message.needsReapproval;
  return (
    <div
      className="gorgias-msg-box"
      data-awaiting-approval={awaitingApproval ? "true" : "false"}
      style={{ border: "1px solid #E1E3E5", borderRadius: 12, padding: 16 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>
              {message.senderType === "customer"
                ? t("message.customer")
                : t("message.merchant")}
            </span>
            <span style={{ fontSize: 12, color: "#6D7175" }}>
              {formatDate(message.sentAt)}
            </span>
            {message.evidenceCategory && (
              <CategoryTag category={message.evidenceCategory} t={t} />
            )}
          </div>
          {message.approvedExcerptPreview && (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "#202223",
              }}
            >
              “{message.approvedExcerptPreview}”
            </p>
          )}
          {message.relevanceExplanation && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "#4B5563",
              }}
            >
              {message.relevanceExplanation}
            </p>
          )}
        </div>
        <ReviewSpill message={message} t={t} />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 14,
          flexWrap: "wrap",
        }}
      >
        {(message.reviewStatus === "proposed" || message.needsReapproval) && (
          <Button
            size="slim"
            onClick={() => onApprove(message)}
            loading={busy === `msg:${message.id}`}
          >
            {t("message.approve")}
          </Button>
        )}
        {message.reviewStatus !== "excluded" && (
          <Button
            size="slim"
            variant="tertiary"
            onClick={() => onExclude(message)}
            loading={busy === `msg:${message.id}`}
          >
            {t("message.exclude")}
          </Button>
        )}
        <Button
          size="slim"
          variant="plain"
          onClick={() => onEditExplanation(message)}
        >
          {t("message.editExplanation")}
        </Button>
      </div>
      <ConversationDetails
        transcript={transcript}
        onOpen={onOpenTranscript}
        onManualAdd={onManualAdd}
        t={t}
      />
    </div>
  );
}

/** Confirmed ("Matched conversation") ticket: header row + message boxes. */
function MatchedTicket({
  ticket,
  isFirst,
  busy,
  transcript,
  t,
  onOpenTranscript,
  onApprove,
  onManualAdd,
  onExclude,
  onEditExplanation,
  onReport,
}: {
  ticket: GorgiasCommsTicketSummary;
  isFirst: boolean;
  busy: string | null;
  transcript: TranscriptMessage[] | "loading" | "error" | undefined;
  t: GorgiasT;
  onOpenTranscript: () => void;
  onApprove: (m: GorgiasCommsMessageSummary) => void;
  onManualAdd: (m: { id: string }) => void;
  onExclude: (m: GorgiasCommsMessageSummary) => void;
  onEditExplanation: (m: GorgiasCommsMessageSummary) => void;
  onReport: () => void;
}) {
  return (
    <div
      style={{
        paddingTop: isFirst ? 0 : 16,
        marginTop: isFirst ? 0 : 16,
        borderTop: isFirst ? "0" : "1px solid #E1E3E5",
      }}
    >
      {/* Ticket header row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#202223",
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            {ticket.subject ?? `#${ticket.gorgiasTicketId}`}
          </p>
          <p
            style={{
              fontSize: 11,
              color: "#6D7175",
              margin: "6px 0 0",
              letterSpacing: "0.01em",
            }}
          >
            {ticketMetaLine(ticket, t)}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
          <ConfidenceChip confidence={ticket.confidence} t={t} />
          <Button variant="plain" tone="critical" onClick={onReport}>
            {t("ticket.reportBadMatch")}
          </Button>
        </div>
      </div>

      {/* Reviewable message boxes — each carries its own inline
          "View full conversation" link at the bottom of the card,
          matching the design mockup. */}
      {ticket.reviewableMessages.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 12,
          }}
        >
          {ticket.reviewableMessages.map((m) => (
            <MessageBox
              key={m.id}
              message={m}
              busy={busy}
              transcript={transcript}
              t={t}
              onOpenTranscript={onOpenTranscript}
              onApprove={onApprove}
              onManualAdd={onManualAdd}
              onExclude={onExclude}
              onEditExplanation={onEditExplanation}
            />
          ))}
        </div>
      ) : (
        // No reviewable messages left on this ticket — keep the transcript
        // reachable at the ticket level so it isn't orphaned.
        <ConversationDetails
          transcript={transcript}
          onOpen={onOpenTranscript}
          onManualAdd={onManualAdd}
          t={t}
        />
      )}
    </div>
  );
}

/** Medium ("Possible matches") ticket: confirm-first row + transcript. */
function PossibleTicket({
  ticket,
  busy,
  transcript,
  t,
  onOpenTranscript,
  onManualAdd,
  onConfirm,
  onReject,
}: {
  ticket: GorgiasCommsTicketSummary;
  busy: string | null;
  transcript: TranscriptMessage[] | "loading" | "error" | undefined;
  t: GorgiasT;
  onOpenTranscript: () => void;
  onManualAdd: (m: { id: string }) => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              fontSize: 14,
              fontWeight: 600,
              color: "#202223",
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            {ticket.subject ?? `#${ticket.gorgiasTicketId}`}
            <ConfidenceChip confidence={ticket.confidence} t={t} />
          </p>
          <p
            style={{
              fontSize: 11,
              color: "#6D7175",
              margin: "6px 0 0",
              letterSpacing: "0.01em",
            }}
          >
            {ticketMetaLine(ticket, t)}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "none" }}>
          <Button
            onClick={onConfirm}
            loading={busy === `ticket:${ticket.id}:confirm`}
          >
            {t("ticket.confirm")}
          </Button>
          <Button
            variant="plain"
            tone="critical"
            onClick={onReject}
            loading={busy === `ticket:${ticket.id}:reject`}
          >
            {t("ticket.notRelated")}
          </Button>
        </div>
      </div>
      <ConversationDetails
        transcript={transcript}
        onOpen={onOpenTranscript}
        onManualAdd={onManualAdd}
        t={t}
      />
    </div>
  );
}
