-- PR-C1 — narrow the promotion authority. Follow-up to 20260807230000, which
-- is already applied to dev and is therefore left untouched.
--
-- Two gaps found in review:
--
-- 1. `finalize_defence_package` accepted an ARBITRARY `p_allowed_statuses`.
--    The parameter exists so the deadline cron can auto-finalize a `stale`
--    candidate as well as a `draft`; nothing stopped a service-role caller
--    from passing `{superseded}` or `{failed}` and promoting from a state the
--    lifecycle has no business promoting from. The function now validates the
--    argument and refuses anything outside a non-empty subset of
--    {draft, stale}, without mutating.
--
-- 2. The authorization trigger only covered `draft|stale → final`, which
--    left `failed`, `skipped`, `superseded` and `submitted → final` governed
--    solely by the immutability trigger's own rules. Now EVERY
--    non-final → final update requires the transaction-local grant, so the
--    RPC is the single door regardless of the source state. `final →
--    submitted` and `final → superseded` are untouched, and INSERTs are
--    unaffected (BEFORE UPDATE only), so fixtures that create a `final` row
--    directly keep working.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Every non-final → final needs the grant
-- ─────────────────────────────────────────────────────────────────────────

create or replace function defence_packages_authorize_promotion()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from 'final' and new.status = 'final' then
    if coalesce(current_setting('disputedesk.promote_package', true), '') <> new.id::text then
      raise exception
        'defence_packages: % → final must go through finalize_defence_package() (row %)',
        old.status, new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Only {draft, stale} may ever be a promotion SOURCE
-- ─────────────────────────────────────────────────────────────────────────

create or replace function finalize_defence_package(
  p_package_id uuid,
  p_expected_revision uuid,
  p_expected_version integer,
  p_enqueue_save boolean default false,
  p_allowed_statuses text[] default array['draft']
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  select id into v_latest_id
    from defence_packages
   where dispute_id = v_dispute_id
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

revoke execute on function finalize_defence_package(uuid, uuid, integer, boolean, text[]) from public, anon, authenticated;
grant execute on function finalize_defence_package(uuid, uuid, integer, boolean, text[]) to service_role;
