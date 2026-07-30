-- Diagnostic: blume-box dispute 240d293a — list/dashboard say handled, the
-- detail page says "needs your approval". Find which store the two surfaces
-- disagree on. Read-only.
select 'dispute'                       as layer,
       d.reason,
       d.status,
       d.normalized_status,
       d.phase,
       d.amount::text,
       d.due_at::date::text            as due,
       coalesce(d.review_state, '(null)') as review_state,
       d.needs_review::text,
       d.needs_attention::text,
       coalesce(d.attention_reason, '(null)') as attention_reason,
       (d.evidence_saved_to_shopify_at is not null)::text as saved
  from public.disputes d
 where d.id = '240d293a-c3bc-4849-80a7-9aa0c23dd278';
