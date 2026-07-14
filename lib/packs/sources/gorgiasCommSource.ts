/**
 * Gorgias helpdesk-communication evidence source collector.
 *
 * MODE-AWARE since the evidence core (2026-07). The behavior is keyed on
 * `integrations.meta.evidence_mode` (read via loadGorgiasConnection):
 *
 *   'merchant_review_required' (every shop enrolled in the review flow;
 *   the only mode after the cutover):
 *     DB-ONLY, SNAPSHOT-RENDERED. The section is built exclusively from
 *     merchant-approved rows in gorgias_evidence_messages — no Gorgias
 *     API call at build time. A message is included only when ALL hold:
 *       - review_status in ('approved','manual')
 *       - parent ticket match_status = 'confirmed_match'
 *       - content_hash = approved_content_hash  (source-drift guard)
 *     Anything else — enrichment pending, failed, nothing approved —
 *     returns [] and the pack simply omits Gorgias communications.
 *     THERE IS NO FALLBACK TO AUTO-INCLUSION IN THIS MODE, EVER.
 *
 *   'legacy_auto_include' (pre-cutover shops that never enrolled):
 *     the original Phase-1 inline snapshot (email match → all public
 *     messages). Deleted at cutover (PR7).
 *
 * The persisted path writes an APPROVED-EVIDENCE SNAPSHOT into the
 * section data (and therefore into the immutable pack_json): message +
 * ticket ids, sender, timestamps, the merchant-approved excerpt (never
 * the full body), the merchant-editable explanation, category, approval
 * metadata, content hash, analyzer + matching versions. The PDF and the
 * defence pipeline render only from this snapshot — later Gorgias edits
 * or reclassification cannot change an already-generated package.
 *
 * customerConfirmsOrder (the only supporting→strong lever, resolved in
 * lib/argument/canonicalEvidence.ts) is set iff at least one included
 * message satisfies the tightened rule: authored by the CUSTOMER
 * (merchant "the customer confirmed" never counts), category
 * 'transaction_recognition', ticket confidence high or merchant-confirmed
 * medium (never low), approved/manual with approval metadata, and the
 * approval hash still matches the source. The AI can propose but never
 * flip this — approval is a merchant action.
 *
 * Self-incrimination guard: internal notes were filtered before
 * persistence (enrichment) and are filtered again in the legacy path.
 */

import {
  createGorgiasClient,
  type GorgiasClient,
  type GorgiasCredentials,
  type GorgiasMessage,
} from "@/lib/integrations/gorgias/client";
import {
  loadGorgiasCredentials,
  loadGorgiasConnection,
  type GorgiasConnection,
} from "@/lib/integrations/gorgias/credentials";
import { getServiceClient } from "@/lib/supabase/server";
import { logSetupEvent } from "@/lib/setup/events";
import type { EvidenceSection, BuildContext } from "../types";

/** Test seam: lets tests inject connection/persistence/client loaders
 *  without standing up Supabase or mocking fetch. */
export interface GorgiasCommDeps {
  loadConnection?: (shopId: string) => Promise<GorgiasConnection | null>;
  loadPersistedEvidence?: (
    disputeId: string,
  ) => Promise<PersistedGorgiasEvidence | null>;
  /** Legacy-path seams (Phase-1 behavior; removed at cutover). */
  loadCredentials?: (shopId: string) => Promise<GorgiasCredentials | null>;
  createClient?: (creds: GorgiasCredentials) => GorgiasClient;
  logEvent?: typeof logSetupEvent;
}

// ── Persisted (review-mode) shapes ───────────────────────────────────────────

export interface PersistedGorgiasMessage {
  id: string;
  gorgiasMessageId: number;
  senderType: "customer" | "merchant";
  senderName: string | null;
  channel: string | null;
  sentAt: string | null;
  reviewStatus: "approved" | "manual";
  evidenceCategory: string | null;
  relevanceExplanation: string | null;
  approvedExcerpt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedContentHash: string | null;
  contentHash: string;
  contentTruncated: boolean;
  analyzerModel: string | null;
  analyzerPromptVersion: number | null;
}

export interface PersistedGorgiasTicket {
  id: string;
  gorgiasTicketId: number;
  confidence: "high" | "medium" | "low";
  matchStatus: "proposed_match" | "confirmed_match" | "rejected_match";
  matchingAlgorithmVersion: number | null;
  subject: string | null;
  channel: string | null;
  createdAt: string | null;
  csatScore: number | null;
  messages: PersistedGorgiasMessage[];
}

export interface PersistedGorgiasEvidence {
  tickets: PersistedGorgiasTicket[];
  matchSummary: {
    high: number;
    medium: number;
    low: number;
    confirmed: number;
    rejected: number;
  };
}

async function defaultLoadPersistedEvidence(
  disputeId: string,
): Promise<PersistedGorgiasEvidence | null> {
  const sb = getServiceClient();
  const { data: tickets } = await sb
    .from("gorgias_matched_tickets")
    .select(
      "id, gorgias_ticket_id, confidence, match_status, matching_algorithm_version, ticket_snapshot",
    )
    .eq("dispute_id", disputeId);
  if (!tickets || tickets.length === 0) return null;

  const { data: messages } = await sb
    .from("gorgias_evidence_messages")
    .select(
      "id, matched_ticket_id, gorgias_message_id, sender_type, sender_name, channel, sent_at, review_status, evidence_category, relevance_explanation, approved_excerpt, approved_at, approved_by, approved_content_hash, content_hash, content_truncated, analyzer_model, analyzer_prompt_version",
    )
    .eq("dispute_id", disputeId)
    .in("review_status", ["approved", "manual"]);

  const byTicket = new Map<string, PersistedGorgiasMessage[]>();
  for (const m of messages ?? []) {
    const list = byTicket.get(m.matched_ticket_id as string) ?? [];
    list.push({
      id: m.id as string,
      gorgiasMessageId: Number(m.gorgias_message_id),
      senderType: m.sender_type as "customer" | "merchant",
      senderName: (m.sender_name as string | null) ?? null,
      channel: (m.channel as string | null) ?? null,
      sentAt: (m.sent_at as string | null) ?? null,
      reviewStatus: m.review_status as "approved" | "manual",
      evidenceCategory: (m.evidence_category as string | null) ?? null,
      relevanceExplanation: (m.relevance_explanation as string | null) ?? null,
      approvedExcerpt: (m.approved_excerpt as string | null) ?? null,
      approvedAt: (m.approved_at as string | null) ?? null,
      approvedBy: (m.approved_by as string | null) ?? null,
      approvedContentHash: (m.approved_content_hash as string | null) ?? null,
      contentHash: m.content_hash as string,
      contentTruncated: Boolean(m.content_truncated),
      analyzerModel: (m.analyzer_model as string | null) ?? null,
      analyzerPromptVersion: (m.analyzer_prompt_version as number | null) ?? null,
    });
    byTicket.set(m.matched_ticket_id as string, list);
  }

  const summary = { high: 0, medium: 0, low: 0, confirmed: 0, rejected: 0 };
  const mapped: PersistedGorgiasTicket[] = tickets.map((t) => {
    const confidence = t.confidence as PersistedGorgiasTicket["confidence"];
    summary[confidence]++;
    if (t.match_status === "confirmed_match") summary.confirmed++;
    if (t.match_status === "rejected_match") summary.rejected++;
    const snapshot = (t.ticket_snapshot as Record<string, unknown> | null) ?? {};
    return {
      id: t.id as string,
      gorgiasTicketId: Number(t.gorgias_ticket_id),
      confidence,
      matchStatus: t.match_status as PersistedGorgiasTicket["matchStatus"],
      matchingAlgorithmVersion:
        (t.matching_algorithm_version as number | null) ?? null,
      subject: (snapshot.subject as string | null) ?? null,
      channel: (snapshot.channel as string | null) ?? null,
      createdAt: (snapshot.createdAt as string | null) ?? null,
      csatScore: (snapshot.csatScore as number | null) ?? null,
      messages: byTicket.get(t.id as string) ?? [],
    };
  });

  return { tickets: mapped, matchSummary: summary };
}

// ── Review-mode section builder (pure, exported for tests) ───────────────────

/** Inclusion guard — plan §5. */
export function isIncludableMessage(
  ticket: PersistedGorgiasTicket,
  m: PersistedGorgiasMessage,
): boolean {
  return (
    (m.reviewStatus === "approved" || m.reviewStatus === "manual") &&
    ticket.matchStatus === "confirmed_match" &&
    m.approvedContentHash !== null &&
    m.approvedContentHash === m.contentHash
  );
}

/** Tightened customerConfirmsOrder rule — plan §5 / review item 7. */
export function derivesCustomerConfirmsOrder(
  ticket: PersistedGorgiasTicket,
  m: PersistedGorgiasMessage,
): boolean {
  return (
    isIncludableMessage(ticket, m) &&
    m.senderType === "customer" &&
    m.evidenceCategory === "transaction_recognition" &&
    ticket.confidence !== "low" &&
    m.approvedAt !== null &&
    m.approvedBy !== null
  );
}

export function buildSnapshotSection(
  persisted: PersistedGorgiasEvidence,
  ctx: Pick<BuildContext, "packId">,
): EvidenceSection | null {
  const conversations = persisted.tickets
    .map((t) => ({
      ticket: t,
      included: t.messages.filter((m) => isIncludableMessage(t, m)),
    }))
    .filter((c) => c.included.length > 0);

  if (conversations.length === 0) return null;

  const snapshotAt = new Date().toISOString();
  let messageCount = 0;
  let customerMessageCount = 0;
  let confirmsOrder = false;

  const conversationData = conversations.map(({ ticket, included }) => {
    messageCount += included.length;
    customerMessageCount += included.filter(
      (m) => m.senderType === "customer",
    ).length;
    if (!confirmsOrder) {
      confirmsOrder = included.some((m) =>
        derivesCustomerConfirmsOrder(ticket, m),
      );
    }
    return {
      ticketId: ticket.gorgiasTicketId,
      subject: ticket.subject,
      channel: ticket.channel,
      csatScore: ticket.csatScore,
      matchConfidence: ticket.confidence,
      matchingAlgorithmVersion: ticket.matchingAlgorithmVersion,
      messages: included.map((m) => ({
        gorgiasMessageId: m.gorgiasMessageId,
        gorgiasTicketId: ticket.gorgiasTicketId,
        senderType: m.senderType,
        senderName: m.senderName,
        sentAt: m.sentAt,
        channel: m.channel,
        // The merchant-approved passage — never the full body.
        excerpt: m.approvedExcerpt ?? "",
        relevanceExplanation: m.relevanceExplanation,
        evidenceCategory: m.evidenceCategory,
        approvedAt: m.approvedAt,
        approvedBy: m.approvedBy,
        approvedContentHash: m.approvedContentHash,
        contentTruncated: m.contentTruncated,
        analyzerModel: m.analyzerModel,
        analyzerPromptVersion: m.analyzerPromptVersion,
      })),
    };
  });

  return {
    type: "comms",
    labelToken: { key: "packs.section.customerCommunicationHistory" },
    source: "gorgias",
    fieldsProvided: ["customer_communication"],
    data: {
      provider: "gorgias",
      enriched: true,
      snapshotAt,
      packId: ctx.packId,
      matchSummary: persisted.matchSummary,
      conversationCount: conversationData.length,
      conversations: conversationData,
      summary: {
        conversationCount: conversationData.length,
        messageCount,
        customerMessageCount,
      },
      ...(confirmsOrder ? { customerConfirmsOrder: true } : {}),
    },
  };
}

// ── Legacy Phase-1 path (deleted at cutover) ─────────────────────────────────

interface SnapshotMessage {
  fromAgent: boolean;
  channel: string | null;
  text: string;
  sentAt: string | null;
}

interface SnapshotConversation {
  ticketId: number;
  status: string | null;
  channel: string | null;
  csatScore: number | null;
  messages: SnapshotMessage[];
}

/** Drop internal agent notes and any non-public message. */
function isPublicMessage(m: GorgiasMessage): boolean {
  return m.public === true && m.channel !== "internal-note";
}

function snapshot(m: GorgiasMessage): SnapshotMessage {
  const text = (m.stripped_text ?? m.body_text ?? "").trim();
  return {
    fromAgent: m.from_agent === true,
    channel: m.channel ?? null,
    text,
    sentAt: m.sent_datetime ?? m.created_datetime ?? null,
  };
}

async function collectLegacy(
  ctx: BuildContext,
  deps: GorgiasCommDeps,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  const email = order?.email?.trim() || null;
  if (!order || !email) return [];

  const loadCreds = deps.loadCredentials ?? loadGorgiasCredentials;
  const creds = await loadCreds(ctx.shopId);
  if (!creds) return [];

  const client = (deps.createClient ?? ((c) => createGorgiasClient(c)))(creds);

  const customer = await client.resolveCustomerByEmail(email);
  if (!customer) return [];

  const tickets = await client.listCustomerTickets(customer.id);
  const usable = tickets.filter((t) => !t.trashed_datetime && t.spam !== true);

  const conversations: SnapshotConversation[] = [];
  let totalMessages = 0;
  let customerMessageCount = 0;
  let highestCsat: number | null = null;

  for (const t of usable) {
    const raw = Array.isArray(t.messages)
      ? t.messages
      : await client.listTicketMessages(t.id);

    const visible = raw
      .filter(isPublicMessage)
      .map(snapshot)
      .filter((s) => s.text.length > 0);

    if (visible.length === 0) continue;

    totalMessages += visible.length;
    customerMessageCount += visible.filter((s) => !s.fromAgent).length;

    const score = t.satisfaction_survey?.score;
    if (typeof score === "number") {
      highestCsat = highestCsat === null ? score : Math.max(highestCsat, score);
    }

    conversations.push({
      ticketId: t.id,
      status: t.status ?? null,
      channel: t.channel ?? null,
      csatScore: typeof score === "number" ? score : null,
      messages: visible,
    });
  }

  if (conversations.length === 0) return [];

  return [
    {
      type: "comms",
      labelToken: { key: "packs.section.gorgiasCommunication" },
      source: "gorgias",
      fieldsProvided: ["customer_communication"],
      data: {
        provider: "gorgias",
        enriched: false,
        customerEmail: email,
        conversationCount: conversations.length,
        conversations,
        summary: {
          conversationCount: conversations.length,
          messageCount: totalMessages,
          customerMessageCount,
          highestCsatScore: highestCsat,
        },
        // customerConfirmsOrder intentionally NOT set on the legacy
        // path — unreviewed content can never upgrade strength.
      },
    },
  ];
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function collectGorgiasCommEvidence(
  ctx: BuildContext,
  deps: GorgiasCommDeps = {},
): Promise<EvidenceSection[]> {
  try {
    const loadConn = deps.loadConnection ?? loadGorgiasConnection;
    const conn = await loadConn(ctx.shopId);
    if (!conn) return [];

    let sections: EvidenceSection[];
    if (conn.evidenceMode === "merchant_review_required") {
      const loadPersisted =
        deps.loadPersistedEvidence ?? defaultLoadPersistedEvidence;
      const persisted = await loadPersisted(ctx.disputeId);
      const section = persisted ? buildSnapshotSection(persisted, ctx) : null;
      sections = section ? [section] : [];
    } else {
      sections = await collectLegacy(ctx, deps);
    }

    if (sections.length > 0) {
      const logEvent = deps.logEvent ?? logSetupEvent;
      const data = sections[0].data as {
        enriched?: boolean;
        summary?: { messageCount?: number };
      };
      void logEvent(ctx.shopId, "gorgias_evidence_rendered_in_pack", {
        disputeId: ctx.disputeId,
        packId: ctx.packId,
        enriched: data.enriched === true,
        messageCount: data.summary?.messageCount ?? 0,
      }).catch(() => {});
    }

    return sections;
  } catch (e) {
    console.warn(
      `[gorgiasCommSource] skipped for shop ${ctx.shopId}:`,
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}
