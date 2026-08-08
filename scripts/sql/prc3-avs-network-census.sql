-- PR-C3 (C-13) pre-implementation census. READ-ONLY — no writes, no DDL.
--
--   npm run db:query:prod -- --file scripts/sql/prc3-avs-network-census.sql --output table
--
-- WHAT IT ANSWERS. C-13 normalizes AVS results per NETWORK and narrows the
-- CE chart Item 3 citation path to the primary-sourced codes (decision 3:
-- `Y` / `M`). Three numbers have to exist before the code does:
--
--   1. which (network, code) pairs we actually hold — the map's real domain,
--      not the union of every code the networks document;
--   2. how often an UNKNOWN or UNMAPPED code appears — the conservative
--      branch's real frequency;
--   3. the citation-narrowing delta — packs citable today (AVS in the
--      carried-over scoring set Y/A/W/X/D/M) that are NOT citable under
--      {Y, M}, plus the packages that would have relied on them. That is the
--      one bank-visible change C-13 makes, and it must be enumerated.
--
-- Sections:
--   a_network_distribution      card networks present on AVS-bearing packs
--   b_network_x_avs             the (network, code) domain of the map
--   c_avs_authority_classes     citable {Y,M} / internal-only match / definite
--                               no-match / not-checked / UNMAPPED
--   d_narrowing_delta_packs     packs losing citation under decision 3
--   e_narrowing_delta_disputes  the same, as open disputes
--   f_unmapped_escalation       packages on disputes whose only AVS evidence
--                               is an unmapped code — the escalation
--                               population (a package that tries to RELY on
--                               one is refused; nothing is parked for merely
--                               holding one)
--
-- Nothing here remediates anything.

with pack_verification as (
  select
    ep.id            as pack_id,
    ep.dispute_id,
    upper(coalesce(nullif(sec->'data'->>'cardCompany', ''), '(unknown)')) as network,
    upper(coalesce(
      sec->'data'->>'avsResultCode',
      sec->'data'->>'avs_result_code',
      ''
    )) as avs_code
  from evidence_packs ep
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(ep.pack_json->'sections') = 'array'
         then ep.pack_json->'sections' else '[]'::jsonb end
  ) as sec
  where sec->'fieldsProvided' ? 'avs_cvv_match'
),
classified as (
  select
    pv.*,
    (pv.avs_code in ('Y','A','W','X','D','M'))                  as scoring_match,
    (pv.avs_code in ('Y','M'))                                  as ce_item3_citable,
    (pv.avs_code in ('Z','N','C'))                              as definite_no_match,
    (pv.avs_code in ('U','S','R','G','E','B','P','I','T','0','1','2','3','4','5')) as known_not_checked,
    (pv.avs_code = '')                                          as absent
  from pack_verification pv
)

select * from (

  select 'a_network_distribution' as "check", net || ' x ' || n::text as detail
  from (select network as net, count(*) as n from classified group by 1) t

  union all
  select 'b_network_x_avs', pair || ' x ' || n::text
  from (
    select network || ' / ' || case when avs_code = '' then '(absent)' else avs_code end as pair,
           count(*) as n
    from classified group by 1
  ) t

  union all
  select 'c_avs_authority_classes', klass || ' x ' || n::text
  from (
    select case
             when ce_item3_citable then 'citable {Y,M} (primary-sourced)'
             when scoring_match then 'match, internal-only under decision 3'
             when definite_no_match then 'definite no-match'
             when known_not_checked then 'not checked / unavailable'
             when absent then 'absent (never a signal)'
             else 'UNMAPPED (conservative branch)'
           end as klass, count(*) as n
    from classified group by 1
  ) t

  union all
  select 'd_narrowing_delta_packs',
         'packs citable today but NOT under {Y,M} x ' || count(*)::text
  from classified where scoring_match and not ce_item3_citable

  union all
  select 'e_narrowing_delta_disputes',
         'open disputes affected by the narrowing x ' || count(distinct c.dispute_id)::text
  from classified c
  join disputes d on d.id = c.dispute_id
  where c.scoring_match and not c.ce_item3_citable and d.final_outcome is null

  union all
  select 'f_unmapped_escalation', st || ' x ' || n::text
  from (
    select dp.status as st, count(*) as n
    from classified c
    join defence_packages dp on dp.dispute_id = c.dispute_id
    where not c.scoring_match and not c.definite_no_match
      and not c.known_not_checked and not c.absent
    group by 1
  ) t

) x
order by "check", detail;
