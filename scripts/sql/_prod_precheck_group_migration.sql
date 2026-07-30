-- READ-ONLY simulation of the full pending prod sequence:
--   20260727110000 snapshot → 20260727120000 collapse → 20260729020000 restore
-- Prod's live `rules` today IS the pre-collapse state, so the snapshot content
-- is exactly what this reads. Writes nothing.
with collapse_vote as (          -- what 20260727120000 will set the switch to
  select r.shop_id,
         case when bool_and(r.action->>'mode' = 'auto') then 'auto' else 'review' end as switch
    from public.rules r
   where left(r.name, 12) = '__dd_setup__'
     and r.name <> '__dd_setup__:safeguard:high_value'
     and r.enabled
   group by r.shop_id
),
snap as (
  select r.shop_id, r.name, r.priority, r.match->'reason' as reasons,
         case when lower(r.action->>'mode') in ('auto','auto_pack','automated')
              then 'auto' else 'review' end as mode,
         case when r.name like '\_\_dd\_setup\_\_:coverage:%' then 0 else 1 end as source_rank
    from public.rules r
   where r.enabled
     and (r.name like '\_\_dd\_setup\_\_:pack:%' or r.name like '\_\_dd\_setup\_\_:coverage:%')
),
mapped as (
  select snap.*, case
    when snap.reasons @> '["FRAUDULENT"]'::jsonb
      or snap.reasons @> '["UNRECOGNIZED"]'::jsonb            then 'fraud'
    when snap.reasons @> '["PRODUCT_NOT_RECEIVED"]'::jsonb     then 'pnr'
    when snap.reasons @> '["CREDIT_NOT_PROCESSED"]'::jsonb     then 'refund'
    when snap.reasons @> '["DUPLICATE"]'::jsonb                then 'duplicate'
    when snap.reasons @> '["SUBSCRIPTION_CANCELLED"]'::jsonb
      or snap.reasons @> '["SUBSCRIPTION_CANCELED"]'::jsonb    then 'subscription'
    else null end as group_id
  from snap
),
target as (
  select distinct on (shop_id, group_id) shop_id, group_id, mode
    from mapped where group_id is not null
   order by shop_id, group_id, source_rank, priority
)
select sh.shop_domain,
       coalesce(ss.auto_save_enabled, false) as was_live,
       v.switch          as switch_after_collapse,
       t.group_id,
       t.mode            as pre_collapse_mode,
       case
         when coalesce(ss.auto_save_enabled, false) is not true then 'skip: never auto-saved'
         when t.mode = v.switch                                 then 'skip: switch already gives it'
         else 'RESTORE group:' || t.group_id || ' = ' || t.mode
       end as outcome
  from target t
  join public.shops sh on sh.id = t.shop_id
  join collapse_vote v on v.shop_id = t.shop_id
  left join public.shop_settings ss on ss.shop_id = t.shop_id
 order by sh.shop_domain, t.group_id;
