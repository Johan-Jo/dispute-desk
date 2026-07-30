-- Diagnostic (read-only): the pack / defence-package layer for blume-box
-- dispute 240d293a, plus the rule that currently resolves for its reason.
select 'evidence_pack' as layer,
       p.id::text,
       p.status,
       coalesce(p.pack_json->'case_strength'->>'overall', '(none)') as strength,
       coalesce(p.pack_json->'coverage'->>'state', '(none)')        as coverage,
       coalesce(p.pack_json->'fatal_loss'->>'triggered', '(none)')  as fatal_loss,
       p.created_at::text
  from public.evidence_packs p
 where p.dispute_id = '240d293a-c3bc-4849-80a7-9aa0c23dd278'
 order by p.created_at desc
 limit 3;

select 'defence_package' as layer,
       dp.id::text,
       dp.status,
       coalesce(dp.validation_status, '(null)') as validation_status,
       (dp.pdf_path is not null)::text          as has_pdf,
       coalesce(dp.submission_state, '(null)')  as submission_state,
       dp.created_at::text
  from public.defence_packages dp
 where dp.dispute_id = '240d293a-c3bc-4849-80a7-9aa0c23dd278'
 order by dp.created_at desc
 limit 3;
