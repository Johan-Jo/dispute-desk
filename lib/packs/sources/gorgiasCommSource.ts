/**
 * Gorgias helpdesk-communication evidence source collector.
 *
 * MERCHANT-REVIEW ONLY since the 2026-07-14 cutover (migration
 * 20260714200000): the section is built exclusively from merchant-
 * approved rows persisted by the enrichment pipeline — no Gorgias API
 * call at build time, no credential decrypt, and NO auto-inclusion of
 * unreviewed content under any circumstance. The Phase-1 legacy
 * auto-include path was deleted at the cutover.
 *
 * A message is included only when ALL hold:
 *   - review_status in ('approved','manual')
 *   - parent ticket match_status = 'confirmed_match'
 *   - content_hash = approved_content_hash  (source-drift guard)
 * Anything else — enrichment pending, failed, nothing approved, drifted
 * source — returns [] and the pack simply omits Gorgias communications.
 *
 * Approved snapshots deliberately survive a Gorgias disconnect: the
 * merchant approved them, and Gorgias purges trashed tickets / GDPR-
 * deletes customers, so our persisted copy is the durable record.
 *
 * The section data written into the immutable pack_json is the
 * APPROVED-EVIDENCE SNAPSHOT: message + ticket ids, sender, timestamps,
 * the merchant-approved excerpt (never the full body), the merchant-
 * editable explanation, category, approval metadata, content hash,
 * analyzer + matching versions. The PDF and defence pipeline render only
 * from this snapshot — later Gorgias edits or reclassification cannot
 * change an already-generated package.
 *
 * customerConfirmsOrder (the only supporting→strong lever, resolved in
 * lib/argument/canonicalEvidence.ts) is set iff at least one included
 * message satisfies the tightened rule: authored by the CUSTOMER
 * (merchant "the customer confirmed" never counts), category
 * 'transaction_recognition', ticket confidence high or merchant-confirmed
 * medium (never low), approved/manual with approval metadata, and the
 * approval hash still matching the source. The AI can propose but never
 * flip this — approval is a merchant action.
 *
 * Self-incrimination guard: internal notes were filtered before
 * persistence (enrichment) and therefore can never appear here.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { logSetupEvent } from "@/lib/setup/events";
import type { EvidenceSection, BuildContext } from "../types";

/** Test seam: inject the persistence loader + event logger. */
export interface GorgiasCommDeps {
  loadPersistedEvidence?: (
    disputeId: string,
  ) => Promise<PersistedGorgiasEvidence | null>;
  logEvent?: typeof logSetupEvent;
}

// ── Persisted shapes ─────────────────────────────────────────────────────────

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

// ── Section builder (pure, exported for tests) ───────────────────────────────

/**
 * Second, code-enforced non-disclosure layer (bank-optimized rebuttal rule).
 *
 * The analyzer tags every message with an `evidenceCategory`. Two of those
 * categories are self-incriminating in a bank submission — they concede the
 * very thing the merchant is contesting:
 *   - `refund_history`      — a refund/credit was requested, offered, or owed
 *     ("please drop the chargeback so we can refund you" is a confession).
 *   - `cancellation_history`— the customer asked to cancel and it was
 *     acknowledged (concedes the sale fell through).
 *
 * These MUST never reach bank-facing evidence, regardless of merchant
 * approval. Merchant review is layer one (they shouldn't approve these); this
 * set is layer two so a mistaken approval still cannot leak a confession into
 * a pack → PDF → Shopify → bank. Matches EvidenceCategory strings emitted by
 * lib/integrations/gorgias/relevanceAnalyzer.ts.
 *
 * `resolution_attempt` is deliberately NOT excluded here: it is genuinely
 * double-edged (a merchant "here's your tracking" is helpful; a merchant "so
 * sorry, it hasn't shipped" is not) and cannot be adjudicated by category
 * alone — that stays a merchant-review judgment. Only unambiguous admissions
 * are hard-blocked.
 */
export const BANK_EXCLUDED_EVIDENCE_CATEGORIES: ReadonlySet<string> = new Set([
  "refund_history",
  "cancellation_history",
]);

/** Inclusion guard — plan §5 + non-disclosure category block. */
export function isIncludableMessage(
  ticket: PersistedGorgiasTicket,
  m: PersistedGorgiasMessage,
): boolean {
  // Hard non-disclosure block: a self-incriminating category can never enter
  // a bank-facing pack, even if a merchant approved it (layer-two guard).
  if (
    m.evidenceCategory !== null &&
    BANK_EXCLUDED_EVIDENCE_CATEGORIES.has(m.evidenceCategory)
  ) {
    return false;
  }
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

// ── Entry point ──────────────────────────────────────────────────────────────

export async function collectGorgiasCommEvidence(
  ctx: BuildContext,
  deps: GorgiasCommDeps = {},
): Promise<EvidenceSection[]> {
  try {
    const loadPersisted =
      deps.loadPersistedEvidence ?? defaultLoadPersistedEvidence;
    const persisted = await loadPersisted(ctx.disputeId);
    const section = persisted ? buildSnapshotSection(persisted, ctx) : null;
    if (!section) return [];

    const logEvent = deps.logEvent ?? logSetupEvent;
    const data = section.data as { summary?: { messageCount?: number } };
    void logEvent(ctx.shopId, "gorgias_evidence_rendered_in_pack", {
      disputeId: ctx.disputeId,
      packId: ctx.packId,
      enriched: true,
      messageCount: data.summary?.messageCount ?? 0,
    }).catch(() => {});

    return [section];
  } catch (e) {
    console.warn(
      `[gorgiasCommSource] skipped for shop ${ctx.shopId}:`,
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}
