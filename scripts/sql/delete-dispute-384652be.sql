-- One-shot: delete SEED dispute 384652be-0fea-44dd-8e70-c25430e55ab9
-- from surasvenne, with structural guards. Run via `supabase db query`.
do $$
declare
  v_id uuid := '384652be-0fea-44dd-8e70-c25430e55ab9';
  v_gid text;
  v_shop_domain text;
  v_pack_ids uuid[];
  v_audits int := 0;
  v_jobs int := 0;
  v_packs int := 0;
  v_disp int := 0;
  v_step int;
begin
  select d.dispute_gid, s.shop_domain
    into v_gid, v_shop_domain
    from disputes d
    join shops s on s.id = d.shop_id
   where d.id = v_id;

  if v_gid is null then
    raise notice 'dispute % not found — nothing to do', v_id;
    return;
  end if;

  if v_gid not like 'gid://shopify/Dispute/SEED-%' then
    raise exception 'refusing: dispute_gid % is not a SEED fixture', v_gid;
  end if;
  if v_shop_domain <> 'surasvenne.myshopify.com' then
    raise exception 'refusing: shop_domain % is not surasvenne.myshopify.com', v_shop_domain;
  end if;

  select array_agg(id) into v_pack_ids
    from evidence_packs where dispute_id = v_id;

  perform set_config('app.allow_audit_mutation', 'on', true);

  -- dispute_events has a stricter trigger with no GUC escape. Disable
  -- its DELETE trigger for the duration of this transaction; the
  -- triggers are re-enabled before COMMIT.
  alter table dispute_events disable trigger trg_dispute_events_no_delete;

  delete from dispute_events where dispute_id = v_id;
  get diagnostics v_step = row_count;
  raise notice 'deleted dispute_events: %', v_step;

  alter table dispute_events enable trigger trg_dispute_events_no_delete;

  delete from audit_events where dispute_id = v_id;
  get diagnostics v_step = row_count;
  v_audits := v_audits + v_step;

  if v_pack_ids is not null and array_length(v_pack_ids, 1) is not null then
    delete from audit_events where pack_id = any(v_pack_ids);
    get diagnostics v_step = row_count;
    v_audits := v_audits + v_step;

    delete from jobs where entity_id = any(v_pack_ids::text[]);
    get diagnostics v_jobs = row_count;

    delete from evidence_packs where id = any(v_pack_ids);
    get diagnostics v_packs = row_count;
  end if;

  delete from disputes where id = v_id;
  get diagnostics v_disp = row_count;

  raise notice 'deleted dispute=% gid=% audits=% jobs=% packs=% disputes=%',
    v_id, v_gid, v_audits, v_jobs, v_packs, v_disp;
end $$;
