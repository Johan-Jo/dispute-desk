-- Add 'not_card_network' to the disputes.network_reason_code_confidence
-- CHECK constraint.
--
-- Background: the BNPL / payment-method work introduced the explicit
-- confidence value `not_card_network` (lib/disputes/networkReasonCode.ts:
-- resolver short-circuits to it for Klarna/Affirm/local methods where a
-- card reason code cannot exist). But the original migration
-- (20260514120000_disputes_network_reason_code.sql) only allowed
-- direct|derived|inferred|unknown, and no follow-up migration ever widened
-- the constraint. Result: EVERY attempt to persist a non-card dispute's
-- reason code silently failed the CHECK (23514), leaving
-- network_reason_code / _confidence NULL on all Klarna disputes — a schema
-- gap masquerading as "never enriched" (verified on prod 2026-07-04).
--
-- This migration widens the constraint. Idempotent: drops + re-adds.

alter table public.disputes
  drop constraint if exists disputes_network_reason_code_confidence_check;

alter table public.disputes
  add constraint disputes_network_reason_code_confidence_check
  check (
    network_reason_code_confidence is null
    or network_reason_code_confidence in (
      'direct', 'derived', 'inferred', 'unknown', 'not_card_network'
    )
  );

comment on column public.disputes.network_reason_code_confidence is
  'How the network reason code was resolved: direct (Shopify exposed field — currently unreachable), derived (parsed from OrderTransaction.receiptJson), inferred (Shopify enum + card network heuristic), unknown (card dispute we could not resolve), not_card_network (BNPL/local method — Klarna/Affirm — where a card reason code cannot exist; distinct from unknown).';
