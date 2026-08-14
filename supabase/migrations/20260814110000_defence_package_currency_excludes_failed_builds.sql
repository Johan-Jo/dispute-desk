-- A failed build is not a candidate -- the transactional guards agree with the
-- executor (2026-08-14).
--
-- `finalize_defence_package` and `enqueue_defence_package_save` each answer
-- "is this package still the current one?" as `order by version desc limit 1`,
-- the same conflation `lib/defence/candidateVersions.ts` fixes on the
-- application side. A `failed` row carries no PDF and no validated narrative,
-- but it takes the next version number.
--
-- Measured on production 2026-08-14: blume-box dispute 11051073729 (USD 120,
-- due 23:00Z) held v4 -- validation ok, PDF rendered, explicitly held by the
-- pipeline to file at that deadline. A rebuild at 06:03 produced v5, which
-- failed narrative validation twice. The deadline cron read "the latest row",
-- found v5, and filed nothing. Twelve disputes fleet-wide were in that shape,
-- one already lost.
--
-- With the application fix alone the cron would select v4 and this transaction
-- would answer `not_current` -- so the guard has to move with it, or the fix
-- turns a silent forfeit into a refused promotion. Nothing else about either
-- function changes: both are recreated verbatim from the deployed definitions
-- with the one filter added, so the diff is exactly the defect.

CREATE OR REPLACE FUNCTION public.finalize_defence_package(p_package_id uuid, p_expected_revision uuid, p_expected_version integer, p_enqueue_save boolean DEFAULT false, p_allowed_statuses text[] DEFAULT ARRAY['draft'::text])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_dispute_id uuid;
  v_pkg defence_packages%rowtype;
  v_latest_id uuid;
  v_prior_id uuid;
  v_prior_version integer;
  v_job_id uuid;
  v_dedupe text;
  v_promoted boolean := false;
begin
  -- ── Validate the promotion-source allow-list BEFORE anything else ────
  -- Refused without touching a row: an empty array, a null element, or any
  -- status outside {draft, stale}. The application default stays draft-only;
  -- the deadline cron's {draft, stale} is the one explicitly sanctioned
  -- widening.
  if p_allowed_statuses is null
     or array_length(p_allowed_statuses, 1) is null
     or exists (select 1 from unnest(p_allowed_statuses) s where s is null)
     or exists (select 1 from unnest(p_allowed_statuses) s where s not in ('draft', 'stale'))
  then
    return jsonb_build_object(
      'outcome', 'conflict',
      'reason', 'invalid_allowed_statuses'
    );
  end if;

  select dispute_id into v_dispute_id from defence_packages where id = p_package_id;
  if v_dispute_id is null then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_candidate');
  end if;

  -- Freeze the namespace: (a) the parent dispute, which blocks INSERTs via the
  -- FK's FOR KEY SHARE; (b) every existing package row for the dispute, in id
  -- order, which blocks UPDATEs to content, validation, PDF, version and
  -- lifecycle — including a sibling's version, which decides which row is
  -- latest. The candidate is read only after both.
  perform 1 from disputes where id = v_dispute_id for update;
  perform 1 from defence_packages where dispute_id = v_dispute_id order by id for update;

  select * into v_pkg from defence_packages where id = p_package_id;
  if v_pkg.id is null then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_candidate');
  end if;

  v_dedupe := 'dpkg-finalize:' || p_package_id::text;

  if v_pkg.content_revision is distinct from p_expected_revision then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'content_changed');
  end if;
  if v_pkg.version is distinct from p_expected_version then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'version_mismatch');
  end if;

  -- The latest CANDIDATE, not the highest version number. A `failed` row
  -- produces no PDF and no validated narrative -- it is the record of a build
  -- that never produced a package -- but it takes the next version number, so
  -- without this filter it SHADOWS the last package that did, and this guard
  -- answers `not_current` for a package that is current. Mirrors
  -- `lib/defence/candidateVersions.ts`; the two must agree, or the executor
  -- selects a row the transaction then refuses. `skipped` is deliberately
  -- still a candidate: it means "we decided not to build".
  select id into v_latest_id
    from defence_packages
   where dispute_id = v_dispute_id
     and status <> 'failed'
   order by version desc
   limit 1;
  if v_latest_id is distinct from p_package_id then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'not_current');
  end if;

  if coalesce(v_pkg.validation_status, '') <> 'ok' then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'validation_not_ok');
  end if;
  if v_pkg.pdf_path is null or btrim(v_pkg.pdf_path) = '' then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_pdf');
  end if;

  -- Idempotent replay: current, unchanged, fileable AND already promoted.
  if v_pkg.status in ('final', 'submitted') then
    if p_enqueue_save and v_pkg.status = 'final' then
      insert into jobs (shop_id, job_type, entity_id, dedupe_key)
      values (v_pkg.shop_id, 'save_to_shopify', v_pkg.source_pack_id::text, v_dedupe)
      on conflict (dedupe_key) where dedupe_key is not null do nothing
      returning id into v_job_id;
      if v_job_id is null then
        select id into v_job_id from jobs where dedupe_key = v_dedupe;
      end if;
    end if;
    return jsonb_build_object(
      'outcome', 'already_done',
      'reason', 'already_promoted',
      'package_id', p_package_id,
      'version', v_pkg.version,
      'status', v_pkg.status,
      'job_id', v_job_id,
      'enqueued', false
    );
  end if;

  if not (v_pkg.status = any (p_allowed_statuses)) then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'not_draft', 'status', v_pkg.status);
  end if;

  perform set_config('disputedesk.promote_package', p_package_id::text, true);
  update defence_packages
     set status = 'final', updated_at = now()
   where id = p_package_id
     and status = any (p_allowed_statuses);
  get diagnostics v_promoted = row_count;
  perform set_config('disputedesk.promote_package', '', true);

  if not v_promoted then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'transition_lost');
  end if;

  select id, version into v_prior_id, v_prior_version
    from defence_packages
   where dispute_id = v_dispute_id
     and id <> p_package_id
     and status = 'final'
   order by version desc
   limit 1;

  if v_prior_id is not null then
    update defence_packages
       set status = 'superseded',
           superseded_by_id = p_package_id,
           updated_at = now()
     where id = v_prior_id
       and status = 'final';
    if not found then
      v_prior_id := null;
      v_prior_version := null;
    end if;
  end if;

  if p_enqueue_save then
    insert into jobs (shop_id, job_type, entity_id, dedupe_key)
    values (v_pkg.shop_id, 'save_to_shopify', v_pkg.source_pack_id::text, v_dedupe)
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_job_id;
    if v_job_id is null then
      select id into v_job_id from jobs where dedupe_key = v_dedupe;
    end if;
  end if;

  return jsonb_build_object(
    'outcome', 'promoted',
    'package_id', p_package_id,
    'version', v_pkg.version,
    'superseded_id', v_prior_id,
    'superseded_version', v_prior_version,
    'job_id', v_job_id,
    'enqueued', p_enqueue_save and v_job_id is not null
  );
end;
$$;
CREATE OR REPLACE FUNCTION public.enqueue_defence_package_save(p_package_id uuid, p_expected_revision uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_dispute_id uuid;
  v_pkg defence_packages%rowtype;
  v_latest_id uuid;
  v_job_id uuid;
begin
  select dispute_id into v_dispute_id from defence_packages where id = p_package_id;
  if v_dispute_id is null then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_candidate');
  end if;

  perform 1 from disputes where id = v_dispute_id for update;
  perform 1 from defence_packages where dispute_id = v_dispute_id order by id for update;

  select * into v_pkg from defence_packages where id = p_package_id;
  if v_pkg.id is null then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_candidate');
  end if;

  if v_pkg.content_revision is distinct from p_expected_revision then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'content_changed');
  end if;

  -- The latest CANDIDATE, not the highest version number. A `failed` row
  -- produces no PDF and no validated narrative -- it is the record of a build
  -- that never produced a package -- but it takes the next version number, so
  -- without this filter it SHADOWS the last package that did, and this guard
  -- answers `not_current` for a package that is current. Mirrors
  -- `lib/defence/candidateVersions.ts`; the two must agree, or the executor
  -- selects a row the transaction then refuses. `skipped` is deliberately
  -- still a candidate: it means "we decided not to build".
  select id into v_latest_id
    from defence_packages
   where dispute_id = v_dispute_id
     and status <> 'failed'
   order by version desc
   limit 1;
  if v_latest_id is distinct from p_package_id then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'not_current');
  end if;

  if v_pkg.status <> 'final' then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'not_final', 'status', v_pkg.status);
  end if;
  if coalesce(v_pkg.validation_status, '') <> 'ok' then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'validation_not_ok');
  end if;
  if v_pkg.pdf_path is null or btrim(v_pkg.pdf_path) = '' then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_pdf');
  end if;

  select id into v_job_id
    from jobs
   where job_type = 'save_to_shopify'
     and entity_id = v_pkg.source_pack_id::text
     and status in ('queued', 'running', 'pending')
   limit 1;
  if v_job_id is not null then
    return jsonb_build_object('outcome', 'already_done', 'reason', 'save_already_queued', 'job_id', v_job_id);
  end if;

  insert into jobs (shop_id, job_type, entity_id)
  values (v_pkg.shop_id, 'save_to_shopify', v_pkg.source_pack_id::text)
  returning id into v_job_id;

  return jsonb_build_object('outcome', 'enqueued', 'job_id', v_job_id, 'package_id', p_package_id);
end;
$$;
revoke execute on function finalize_defence_package(uuid, uuid, integer, boolean, text[]) from public, anon, authenticated;
grant execute on function finalize_defence_package(uuid, uuid, integer, boolean, text[]) to service_role;
revoke execute on function enqueue_defence_package_save(uuid, uuid) from public, anon, authenticated;
grant execute on function enqueue_defence_package_save(uuid, uuid) to service_role;
