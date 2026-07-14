-- Gorgias evidence-mode cutover (evidence core PR7 — final slice).
--
-- Enrolls EVERY existing Gorgias integration in merchant-review mode:
-- from now on, no Gorgias message can reach an evidence pack without
-- explicit merchant approval. The legacy Phase-1 auto-include collector
-- path is deleted from code in the same PR, and the code-side default
-- for a MISSING evidence_mode flips to 'merchant_review_required'
-- (fail-safe direction). This transition is one-way by design — there
-- is no supported path back to legacy_auto_include.

update integrations
  set meta = jsonb_set(
        coalesce(meta, '{}'::jsonb),
        '{evidence_mode}',
        '"merchant_review_required"'::jsonb
      ),
      updated_at = now()
  where type = 'gorgias'
    and coalesce(meta->>'evidence_mode', '') <> 'merchant_review_required';
