/**
 * gorgiasComms block for the dispute-workspace composite endpoint.
 *
 * Summaries ONLY — run status, ticket summaries with match confidence,
 * per-ticket proposal/approved counts, and short approved excerpts. Full
 * transcripts are NEVER in this payload (it rides a ~4s poll); the UI
 * fetches GET /api/disputes/:id/gorgias/tickets/:matchedTicketId on
 * demand.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readEvidenceMode, type GorgiasEvidenceMode } from "./credentials";

const EXCERPT_PREVIEW_CHARS = 200;

export interface GorgiasCommsMessageSummary {
  id: string;
  senderType: "customer" | "merchant";
  sentAt: string | null;
  reviewStatus: string;
  evidenceCategory: string | null;
  confidenceScore: number | null;
  relevanceExplanation: string | null;
  explanationEdited: boolean;
  /** Short preview of the approved excerpt (approved/manual rows only). */
  approvedExcerptPreview: string | null;
  needsReapproval: boolean;
}

export interface GorgiasCommsTicketSummary {
  id: string;
  gorgiasTicketId: number;
  subject: string | null;
  channel: string | null;
  ticketCreatedAt: string | null;
  matchScore: number;
  confidence: "high" | "medium" | "low";
  matchStatus: "proposed_match" | "confirmed_match" | "rejected_match";
  matchReasons: Array<{ signal: string; points: number; detail?: string }>;
  analyzedAt: string | null;
  counts: {
    total: number;
    proposed: number;
    approved: number;
    excluded: number;
  };
  /** Proposed + approved/manual message summaries (no bodies). */
  reviewableMessages: GorgiasCommsMessageSummary[];
}

export interface GorgiasCommsBlock {
  integrationStatus: string;
  evidenceMode: GorgiasEvidenceMode;
  errorCode: string | null;
  latestRun: {
    id: string;
    status: string;
    triggerSource: string;
    proposalCount: number;
    errorCode: string | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
  tickets: GorgiasCommsTicketSummary[];
}

export async function buildGorgiasCommsBlock(
  sb: SupabaseClient,
  shopId: string,
  disputeId: string,
): Promise<GorgiasCommsBlock | null> {
  const { data: integration } = await sb
    .from("integrations")
    .select("id, status, meta")
    .eq("shop_id", shopId)
    .eq("type", "gorgias")
    .maybeSingle();
  if (!integration) return null;

  const meta = (integration.meta as Record<string, unknown> | null) ?? {};

  const [{ data: run }, { data: ticketRows }, { data: msgRows }] =
    await Promise.all([
      sb
        .from("gorgias_enrichment_runs")
        .select(
          "id, status, trigger_source, proposal_count, error_code, started_at, completed_at",
        )
        .eq("dispute_id", disputeId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("gorgias_matched_tickets")
        .select(
          "id, gorgias_ticket_id, match_score, confidence, match_status, match_reasons, ticket_snapshot, analyzed_at",
        )
        .eq("dispute_id", disputeId)
        .order("match_score", { ascending: false }),
      sb
        .from("gorgias_evidence_messages")
        .select(
          "id, matched_ticket_id, sender_type, sent_at, review_status, evidence_category, confidence_score, relevance_explanation, explanation_edited, approved_excerpt, approved_content_hash, content_hash",
        )
        .eq("dispute_id", disputeId),
    ]);

  const messagesByTicket = new Map<string, NonNullable<typeof msgRows>>();
  for (const m of msgRows ?? []) {
    const list = messagesByTicket.get(m.matched_ticket_id as string) ?? [];
    list.push(m);
    messagesByTicket.set(m.matched_ticket_id as string, list);
  }

  const tickets: GorgiasCommsTicketSummary[] = (ticketRows ?? []).map((t) => {
    const msgs = messagesByTicket.get(t.id as string) ?? [];
    const status = (s: string) => msgs.filter((m) => m.review_status === s);
    const reviewable = msgs.filter((m) =>
      ["proposed", "approved", "manual"].includes(m.review_status as string),
    );
    const snapshot = (t.ticket_snapshot as Record<string, unknown> | null) ?? {};
    return {
      id: t.id as string,
      gorgiasTicketId: Number(t.gorgias_ticket_id),
      subject: (snapshot.subject as string | null) ?? null,
      channel: (snapshot.channel as string | null) ?? null,
      ticketCreatedAt: (snapshot.createdAt as string | null) ?? null,
      matchScore: t.match_score as number,
      confidence: t.confidence as GorgiasCommsTicketSummary["confidence"],
      matchStatus: t.match_status as GorgiasCommsTicketSummary["matchStatus"],
      matchReasons:
        (t.match_reasons as GorgiasCommsTicketSummary["matchReasons"]) ?? [],
      analyzedAt: (t.analyzed_at as string | null) ?? null,
      counts: {
        total: msgs.length,
        proposed: status("proposed").length,
        approved: status("approved").length + status("manual").length,
        excluded: status("excluded").length,
      },
      reviewableMessages: reviewable.map((m) => ({
        id: m.id as string,
        senderType: m.sender_type as "customer" | "merchant",
        sentAt: (m.sent_at as string | null) ?? null,
        reviewStatus: m.review_status as string,
        evidenceCategory: (m.evidence_category as string | null) ?? null,
        confidenceScore: (m.confidence_score as number | null) ?? null,
        relevanceExplanation:
          (m.relevance_explanation as string | null) ?? null,
        explanationEdited: Boolean(m.explanation_edited),
        approvedExcerptPreview:
          typeof m.approved_excerpt === "string"
            ? m.approved_excerpt.slice(0, EXCERPT_PREVIEW_CHARS)
            : null,
        needsReapproval:
          ["approved", "manual"].includes(m.review_status as string) &&
          m.approved_content_hash !== null &&
          m.approved_content_hash !== m.content_hash,
      })),
    };
  });

  return {
    integrationStatus: integration.status as string,
    evidenceMode: readEvidenceMode(integration.meta),
    errorCode: (meta.error_code as string | null) ?? null,
    latestRun: run
      ? {
          id: run.id as string,
          status: run.status as string,
          triggerSource: run.trigger_source as string,
          proposalCount: (run.proposal_count as number) ?? 0,
          errorCode: (run.error_code as string | null) ?? null,
          startedAt: run.started_at as string,
          completedAt: (run.completed_at as string | null) ?? null,
        }
      : null,
    tickets,
  };
}
