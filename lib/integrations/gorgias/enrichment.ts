/**
 * Gorgias enrichment — pure planning logic.
 *
 * Everything decision-shaped for the `enrich_gorgias_comms` job lives here
 * with no I/O so it can be exhaustively unit-tested; the handler
 * (lib/jobs/handlers/enrichGorgiasCommsJob.ts) is a thin orchestration
 * layer over Supabase + the Gorgias client.
 *
 * Idempotency contract (the part that keeps worker retries safe):
 *   - Ticket refresh only where match_status = 'proposed_match'. Confirmed
 *     and rejected tickets are merchant decisions — re-enrichment never
 *     touches them, and rows are never deleted (snapshot value: Gorgias
 *     purges trashed tickets and GDPR-deletes customers).
 *   - Message upserts always refresh SOURCE fields (text, hash, sender,
 *     sent_at, channel, truncation) but never clobber review state,
 *     approval fields or merchant-edited explanations.
 *   - Approved-source drift: when an approved/manual message comes back
 *     with content_hash != approved_content_hash, it transitions back to
 *     'proposed' (needs re-approval). Approval metadata is retained for
 *     audit; the collector's hash guard already excludes it from new packs.
 */

import { createHash } from "node:crypto";
import type { GorgiasMessage, GorgiasTicket } from "./client";
import { extractLinkedShopifyOrderName } from "./client";
import {
  scoreTicketMatch,
  MATCHING_ALGORITHM_VERSION,
  type MatchResult,
  type OrderMatchSignals,
  type TicketForScoring,
} from "./matchScoring";

/** Display-snapshot bound. content_hash is ALWAYS over the full text. */
export const MAX_MESSAGE_CHARS = 10_000;

/** Run states in which a run counts as "active" (mirrors the partial
 *  unique index in 20260714120000_gorgias_evidence_core.sql). */
export const ACTIVE_RUN_STATUSES = [
  "queued",
  "resolving_customer",
  "searching_tickets",
  "fetching_messages",
  "analyzing",
] as const;

// ── Message snapshots ────────────────────────────────────────────────────────

export interface MessageSnapshot {
  gorgiasMessageId: number;
  senderType: "customer" | "merchant";
  senderName: string | null;
  channel: string | null;
  sentAt: string | null;
  text: string;
  contentTruncated: boolean;
  originalCharacterCount: number;
  contentHash: string;
}

/** Public-facing message vs internal agent note (self-incrimination
 *  guard — same rule as the collector; applied BEFORE any DB write). */
export function isPublicMessage(m: GorgiasMessage): boolean {
  return m.public === true && m.channel !== "internal-note";
}

export function hashContent(fullText: string): string {
  return createHash("sha256").update(fullText, "utf8").digest("hex");
}

/** Null when the message has no usable public text. */
export function snapshotMessage(m: GorgiasMessage): MessageSnapshot | null {
  if (!isPublicMessage(m)) return null;
  const full = (m.stripped_text ?? m.body_text ?? "").trim();
  if (full.length === 0) return null;
  const truncated = full.length > MAX_MESSAGE_CHARS;
  return {
    gorgiasMessageId: m.id,
    senderType: m.from_agent === true ? "merchant" : "customer",
    senderName: m.source?.from?.name?.trim() || null,
    channel: m.channel ?? null,
    sentAt: m.sent_datetime ?? m.created_datetime ?? null,
    text: truncated ? full.slice(0, MAX_MESSAGE_CHARS) : full,
    contentTruncated: truncated,
    originalCharacterCount: full.length,
    contentHash: hashContent(full),
  };
}

// ── Scoring input ────────────────────────────────────────────────────────────

export function buildTicketForScoring(
  ticket: GorgiasTicket,
  publicMessages: MessageSnapshot[],
): TicketForScoring {
  return {
    ticketId: ticket.id,
    createdAt: ticket.created_datetime ?? null,
    customerEmail: ticket.customer?.email ?? null,
    // Gorgias does not expose the Shopify customer id in a documented
    // shape; the +70 signal stays dormant until a reliable source exists.
    customerShopifyId: null,
    subject: ticket.subject ?? null,
    publicMessageText: publicMessages.map((m) => m.text).join("\n"),
    linkedShopifyOrderName: extractLinkedShopifyOrderName(ticket),
  };
}

export interface ScoredTicket {
  ticket: GorgiasTicket;
  messages: MessageSnapshot[];
  result: MatchResult;
}

export function scoreTicket(
  ticket: GorgiasTicket,
  messages: MessageSnapshot[],
  order: OrderMatchSignals,
): ScoredTicket {
  return {
    ticket,
    messages,
    result: scoreTicketMatch(buildTicketForScoring(ticket, messages), order),
  };
}

/** Frozen ticket metadata persisted on the matched-ticket row. */
export function ticketSnapshotJson(t: GorgiasTicket): Record<string, unknown> {
  return {
    subject: t.subject ?? null,
    status: t.status ?? null,
    channel: t.channel ?? null,
    createdAt: t.created_datetime ?? null,
    csatScore:
      typeof t.satisfaction_survey?.score === "number"
        ? t.satisfaction_survey.score
        : null,
  };
}

// ── Ticket persistence plan ──────────────────────────────────────────────────

export interface ExistingTicketRow {
  id: string;
  gorgias_ticket_id: number;
  match_status: "proposed_match" | "confirmed_match" | "rejected_match";
}

export type TicketPlan =
  | { action: "insert"; row: Record<string, unknown> }
  | { action: "update"; id: string; patch: Record<string, unknown> }
  | { action: "skip"; id: string };

/**
 * High tier arrives auto-confirmed (PRD §11); medium and low arrive as
 * proposed_match (medium visible + requires confirmation, low hidden).
 */
export function initialMatchStatus(
  confidence: MatchResult["confidence"],
): "proposed_match" | "confirmed_match" {
  return confidence === "high" ? "confirmed_match" : "proposed_match";
}

export function planTicketPersistence(
  existing: ExistingTicketRow | null,
  scored: ScoredTicket,
  ids: { shopId: string; disputeId: string; integrationId: string },
): TicketPlan {
  const common = {
    match_score: scored.result.score,
    confidence: scored.result.confidence,
    match_reasons: scored.result.reasons,
    matching_algorithm_version: MATCHING_ALGORITHM_VERSION,
    ticket_snapshot: ticketSnapshotJson(scored.ticket),
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    return {
      action: "insert",
      row: {
        shop_id: ids.shopId,
        dispute_id: ids.disputeId,
        integration_id: ids.integrationId,
        gorgias_ticket_id: scored.ticket.id,
        gorgias_customer_id: scored.ticket.customer?.id ?? null,
        match_status: initialMatchStatus(scored.result.confidence),
        ...common,
      },
    };
  }

  // Merchant decisions are immutable to re-enrichment.
  if (existing.match_status !== "proposed_match") {
    return { action: "skip", id: existing.id };
  }

  // A re-scored pending ticket that now reaches high tier is auto-confirmed
  // (same rule as first sight); it can only strengthen, never weaken, a
  // previous merchant confirmation because those are skipped above.
  return {
    action: "update",
    id: existing.id,
    patch: {
      ...common,
      match_status: initialMatchStatus(scored.result.confidence),
    },
  };
}

// ── Message persistence plan ─────────────────────────────────────────────────

export interface ExistingMessageRow {
  id: string;
  gorgias_message_id: number;
  review_status: "candidate" | "proposed" | "approved" | "excluded" | "manual";
  content_hash: string;
  approved_content_hash: string | null;
}

export type MessagePlan =
  | { action: "insert"; row: Record<string, unknown> }
  | { action: "update"; id: string; patch: Record<string, unknown> }
  | {
      /** Approved/manual message whose source changed since approval —
       *  needs re-review; collector hash guard already excludes it. */
      action: "drift_reproposal";
      id: string;
      patch: Record<string, unknown>;
    }
  | { action: "skip"; id: string };

export function planMessagePersistence(
  existing: ExistingMessageRow | null,
  incoming: MessageSnapshot,
  ids: { shopId: string; disputeId: string; matchedTicketId: string },
): MessagePlan {
  const sourcePatch = {
    sender_type: incoming.senderType,
    sender_name: incoming.senderName,
    channel: incoming.channel,
    sent_at: incoming.sentAt,
    message_text: incoming.text,
    content_truncated: incoming.contentTruncated,
    original_character_count: incoming.originalCharacterCount,
    content_hash: incoming.contentHash,
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    return {
      action: "insert",
      row: {
        shop_id: ids.shopId,
        dispute_id: ids.disputeId,
        matched_ticket_id: ids.matchedTicketId,
        gorgias_message_id: incoming.gorgiasMessageId,
        review_status: "candidate",
        ...sourcePatch,
      },
    };
  }

  const unchanged = existing.content_hash === incoming.contentHash;

  const isApproved =
    existing.review_status === "approved" || existing.review_status === "manual";
  if (isApproved && existing.approved_content_hash) {
    if (incoming.contentHash !== existing.approved_content_hash) {
      // Source drifted since approval: refresh the snapshot, retain the
      // approval metadata for audit, and demote to 'proposed' so the
      // merchant must re-review. NEVER silently keep the approval valid.
      return {
        action: "drift_reproposal",
        id: existing.id,
        patch: { ...sourcePatch, review_status: "proposed" },
      };
    }
    return { action: "skip", id: existing.id };
  }

  if (unchanged) return { action: "skip", id: existing.id };

  // Non-approved rows: refresh source fields only — review_status,
  // explanations and approval columns are never in this patch.
  return { action: "update", id: existing.id, patch: sourcePatch };
}

// ── Order signals helpers ────────────────────────────────────────────────────

/** "gid://shopify/Customer/555001" → "555001"; passthrough for digits. */
export function customerIdDigits(gidOrId: string | null): string | null {
  if (!gidOrId) return null;
  const m = gidOrId.match(/(\d+)\s*$/);
  return m ? m[1] : null;
}
