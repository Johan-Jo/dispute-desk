-- PR-C2 (C-12) pre-merge census. READ-ONLY — no writes, no DDL, no remediation.
--
--   npm run db:query:prod -- --file scripts/sql/prc2-cvv-only-census.sql --output table
--
-- WHAT IT ANSWERS. Decision 1 makes a CVV-only match non-citable. That is the
-- one intended bank-visible delta of PR-C2, and the PR may not claim "no
-- effect" — it has to be counted. A CVV-only case is: the CVV result is a
-- match (`M`) AND the AVS result is NOT in the scoring match set
-- (Y/A/W/X/D/M), including absent.
--
-- Sections:
--   a_avs_code_distribution   every AVS code we hold, with its count — the
--                             input PR-C3's network map will need too.
--   b_cvv_code_distribution   same for CVV.
--   c_verification_classes    the four cases, by pack: both / avs-only /
--                             cvv-only / neither. `cvv_only` is the affected
--                             population.
--   d_cvv_only_open_disputes  the affected population restricted to disputes
--                             still open (final_outcome IS NULL) — the packs
--                             where a future build changes what is cited.
--   e_cvv_only_packages       defence packages whose pack carries a CVV-only
--                             verification, by status. A `final` /
--                             `submitted` row is a letter ALREADY filed
--                             citing it; PR-C2 does not rewrite those.
--   f_avs_code_f              AVS `F` — reads as a match, scores as nothing.
--                             The disagreement PR-C2 pins and PR-C3 resolves.
--
-- Read `c` and `d` together: `c` sizes the class, `d` sizes what actually
-- changes from here. Nothing in this file remediates anything.

with pack_verification as (
  select
    ep.id            as pack_id,
    ep.dispute_id,
    upper(coalesce(
      sec->'data'->>'avsResultCode',
      sec->'data'->>'avs_result_code',
      ''
    )) as avs_code,
    upper(coalesce(
      sec->'data'->>'cvvResultCode',
      sec->'data'->>'cvv_result_code',
      ''
    )) as cvv_code
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
    (pv.avs_code in ('Y','A','W','X','D','M')) as avs_matched,
    (pv.cvv_code = 'M')                        as cvv_matched
  from pack_verification pv
)

select * from (

  select 'a_avs_code_distribution' as "check", code || ' x ' || n::text as detail
  from (
    select case when avs_code = '' then '(absent)' else avs_code end as code, count(*) as n
    from classified group by 1
  ) t

  union all
  select 'b_cvv_code_distribution', code || ' x ' || n::text
  from (
    select case when cvv_code = '' then '(absent)' else cvv_code end as code, count(*) as n
    from classified group by 1
  ) t

  union all
  select 'c_verification_classes', klass || ' x ' || n::text
  from (
    select case
             when avs_matched and cvv_matched then 'both_matched (citable, unchanged)'
             when avs_matched then 'avs_only (citable, unchanged)'
             when cvv_matched then 'cvv_only (CITATION WITHDRAWN)'
             else 'neither (already invalid)'
           end as klass, count(*) as n
    from classified group by 1
  ) t

  union all
  select 'd_cvv_only_open_disputes',
         'open disputes with a cvv-only verification x ' || count(distinct c.dispute_id)::text
  from classified c
  join disputes d on d.id = c.dispute_id
  where c.cvv_matched and not c.avs_matched and d.final_outcome is null

  union all
  select 'e_cvv_only_packages', st || ' x ' || n::text
  from (
    select dp.status as st, count(*) as n
    from classified c
    join defence_packages dp on dp.dispute_id = c.dispute_id
    where c.cvv_matched and not c.avs_matched
    group by 1
  ) t

  union all
  select 'f_avs_code_f',
         'packs with AVS=F (descriptive match, scores nothing) x ' || count(*)::text
  from classified where avs_code = 'F'

) x
order by "check", detail;
