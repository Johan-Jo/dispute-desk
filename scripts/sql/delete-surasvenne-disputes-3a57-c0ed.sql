-- One-shot: delete two SEED disputes (#3a57, #c0ed) from surasvenne.
-- Guards: refuse unless dispute_gid is a SEED fixture AND shop_domain matches.
-- Mirrors scripts/sql/delete-dispute-384652be.sql shape.
do $$
declare
  v_ids uuid[] := array[
    '0a5a4d74-a11f-423d-9bde-d9a7b9ccb6b1'::uuid,  -- #3a57, SEK 738
    '542cf59d-4e0d-4425-a626-7334ac2a837c'::uuid   -- #c0ed, €2916
  ];
  v_id uuid;
  v_gid text;
  v_shop_domain text;
  v_pack_ids uuid[];
  v_audits int;
  v_jobs int;
  v_packs int;
  v_disp int;
  v_step int;
begin
  foreach v_id in array v_ids loop
    v_audits := 0;
    v_jobs := 0;
    v_packs := 0;
    v_disp := 0;

    select d.dispute_gid, s.shop_domain
      into v_gid, v_shop_domain
      from disputes d
      join shops s on s.id = d.shop_id
     where d.id = v_id;

    if v_gid is null then
      raise notice 'dispute % not found — skipping', v_id;
      continue;
    end if;

    if v_gid not like 'gid://shopify/%Dispute/SEED-%'
       and v_gid not like 'gid://shopify/ShopifyPaymentsDispute/SEED-%' then
      raise exception 'refusing: dispute_gid % is not a SEED fixture', v_gid;
    end if;
    if v_shop_domain <> 'surasvenne.myshopify.com' then
      raise exception 'refusing: shop_domain % is not surasvenne.myshopify.com', v_shop_domain;
    end if;

    select array_agg(id) into v_pack_ids
      from evidence_packs where dispute_id = v_id;

    perform set_config('app.allow_audit_mutation', 'on', true);

    alter table dispute_events disable trigger trg_dispute_events_no_delete;
    delete from dispute_events where dispute_id = v_id;
    get diagnostics v_step = row_count;
    raise notice 'dispute=% deleted dispute_events: %', v_id, v_step;
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
  end loop;
end $$;
