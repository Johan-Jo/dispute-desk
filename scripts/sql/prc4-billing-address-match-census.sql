-- PR-C4 (C-14) pre-implementation census. READ-ONLY — no writes, no DDL.
--
--   npm run db:query:prod -- --file scripts/sql/prc4-billing-address-match-census.sql --output table
--
-- WHAT IT ANSWERS. C-14 retires `billing_address_match`: a field graded
-- **strong** ("Strong when AVS-confirmed billing matches the cardholder") but
-- emitted whenever Shopify's own billing and shipping addresses share a city
-- and a country — two merchant-held addresses, no AVS result, no cardholder.
-- Deletion criterion 2 requires that every strength, completeness and citation
-- delta be enumerated before the key is retired, and criterion 3 that no
-- narrative claim depends on it. Five populations have to exist as numbers:
--
--   1. the collection census — how many packs carry the field, and on how many
--      the grader's `strong` branch (`data.match === true`) actually fires.
--      The claim under test is "collected 95, valid 0";
--   2. the CHECKLIST population — persisted `checklist_v2` rows, which survive
--      the template edit and are what completeness actually scores on every
--      existing pack. Split by status and priority, because a `critical`
--      row that is `available` and one that is `missing` move the completeness
--      score in opposite directions when the row is dropped;
--   3. the FACT population — `defence_evidence_facts` / `facts_json` rows in
--      the `billing_match` category. These are the citation and LLM-value
--      delta: a fact that exists today is one the issuer could have been told
--      about;
--   4. the AVS coverage of the same packs — deletion criterion 2's second
--      half. A case may only lose the billing row safely if genuine address
--      verification is represented by the canonical C-12/C-13 AVS fact, so we
--      count how many billing-bearing packs also carry an AVS result, and how
--      that AVS result reads;
--   5. the `visa_10_4_fraud.criticalCategories` interaction — `billing_match`
--      is a critical category for that reason module, so its (un)reachability
--      decides `packageMode`. Measured, not assumed.
--
-- Sections:
--   a_collection            packs carrying the field, and the valid subset
--   b_by_reason             the same, per dispute reason
--   c_match_key_present     packs whose order section actually holds `match`
--   d_checklist_rows        persisted checklist_v2 rows by status x priority
--   e_checklist_by_reason   the same, per reason (FRAUDULENT is the template)
--   f_facts                 defence_evidence_facts rows in category billing_match
--   g_facts_json            packages whose facts_json embeds a billing_match fact
--   h_avs_coverage          billing-bearing packs that also carry an AVS code
--   i_avs_code_mix          which AVS results those packs hold
--   j_package_status        packages on billing-bearing disputes, by status
--
-- Nothing here remediates anything.

with billing_sections as (
  select
    ep.id            as pack_id,
    ep.dispute_id,
    ep.status        as pack_status,
    sec->'data'      as data,
    (sec->'data'->>'match') = 'true'                 as match_true,
    (sec->'data' ? 'match')                          as match_key_present
  from evidence_packs ep
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(ep.pack_json->'sections') = 'array'
         then ep.pack_json->'sections' else '[]'::jsonb end
  ) as sec
  where sec->'fieldsProvided' ? 'billing_address_match'
),
billing_packs as (
  select
    pack_id,
    dispute_id,
    max(pack_status)                     as pack_status,
    bool_or(match_true)                  as any_match_true,
    bool_or(match_key_present)           as any_match_key
  from billing_sections
  group by pack_id, dispute_id
),
avs_sections as (
  select
    ep.id as pack_id,
    upper(coalesce(nullif(sec->'data'->>'cardCompany', ''), '(unknown)')) as network,
    upper(coalesce(sec->'data'->>'avsResultCode', sec->'data'->>'avs_result_code', '')) as avs_code
  from evidence_packs ep
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(ep.pack_json->'sections') = 'array'
         then ep.pack_json->'sections' else '[]'::jsonb end
  ) as sec
  where sec->'fieldsProvided' ? 'avs_cvv_match'
),
checklist_rows as (
  select
    ep.id as pack_id,
    ep.dispute_id,
    d.reason,
    item->>'status'   as status,
    item->>'priority' as priority
  from evidence_packs ep
  join disputes d on d.id = ep.dispute_id
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(ep.checklist_v2) = 'array' then ep.checklist_v2
      when jsonb_typeof(ep.checklist_v2->'items') = 'array' then ep.checklist_v2->'items'
      else '[]'::jsonb
    end
  ) as item
  where item->>'field' = 'billing_address_match'
)

select * from (

  select 'a_collection' as "check",
         'packs carrying billing_address_match x ' || count(*)::text as detail
  from billing_packs

  union all
  select 'a_collection',
         'of those, VALID (data.match === true → grader strong) x '
           || count(*) filter (where any_match_true)::text
  from billing_packs

  union all
  select 'a_collection',
         'distinct disputes x ' || count(distinct dispute_id)::text
  from billing_packs

  union all
  select 'a_collection', 'pack status ' || pack_status || ' x ' || n::text
  from (select pack_status, count(*) as n from billing_packs group by 1) t

  union all
  select 'b_by_reason', coalesce(d.reason, '(null)') || ' x ' || count(*)::text
  from billing_packs bp join disputes d on d.id = bp.dispute_id
  group by d.reason

  union all
  select 'c_match_key_present',
         'packs whose order section carries a `match` key at all x '
           || count(*) filter (where any_match_key)::text
  from billing_packs

  union all
  select 'd_checklist_rows',
         coalesce(status, '(null)') || ' / ' || coalesce(priority, '(null)') || ' x ' || count(*)::text
  from checklist_rows
  group by status, priority

  union all
  select 'd_checklist_rows',
         'packs holding a persisted billing_address_match checklist row x '
           || count(distinct pack_id)::text
  from checklist_rows

  union all
  select 'e_checklist_by_reason',
         coalesce(reason, '(null)') || ' / ' || coalesce(status, '(null)') || ' x ' || count(*)::text
  from checklist_rows
  group by reason, status

  union all
  select 'f_facts', 'defence_evidence_facts rows in category billing_match x ' || count(*)::text
  from defence_evidence_facts where category = 'billing_match'

  union all
  select 'f_facts',
         'of those, bank_eligible x '
           || count(*) filter (where bank_eligible)::text
  from defence_evidence_facts where category = 'billing_match'

  union all
  select 'g_facts_json',
         'defence_packages whose facts_json embeds a billing_match fact x '
           || count(*)::text
  from defence_packages dp
  where dp.facts_json::text like '%"billing_match"%'

  union all
  select 'h_avs_coverage', klass || ' x ' || n::text
  from (
    select case
             when a.pack_id is null then 'billing-bearing pack with NO AVS section'
             when a.avs_code = ''    then 'billing-bearing pack, AVS code absent'
             else 'billing-bearing pack, AVS code present'
           end as klass,
           count(distinct bp.pack_id) as n
    from billing_packs bp
    left join avs_sections a on a.pack_id = bp.pack_id
    group by 1
  ) t

  union all
  select 'i_avs_code_mix', pair || ' x ' || n::text
  from (
    select a.network || ' / ' || case when a.avs_code = '' then '(absent)' else a.avs_code end as pair,
           count(distinct bp.pack_id) as n
    from billing_packs bp
    join avs_sections a on a.pack_id = bp.pack_id
    group by 1
  ) t

  union all
  select 'j_package_status', coalesce(dp.status, '(null)') || ' x ' || count(*)::text
  from billing_packs bp
  join defence_packages dp on dp.dispute_id = bp.dispute_id
  group by dp.status

) x
order by "check", detail;
