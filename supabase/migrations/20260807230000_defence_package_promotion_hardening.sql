-- PR-C1 — hardening follow-up to 20260807200000.
--
-- The first migration is already applied to dev, so it is left untouched: an
-- applied migration edited in place is a file that no longer describes any
-- database. Everything here is additive or a full `create or replace`.
--
-- Four defects in the first cut, all found in review:
--
-- 1. The parent-dispute `FOR UPDATE` blocks INSERTs (via the FK's FOR KEY
--    SHARE) but does NOT serialize UPDATEs to existing package rows. So:
--    A opens a transaction and rewrites the candidate's facts_json; B enters
--    the RPC, locks the dispute, reads the OLD committed revision, validates
--    it, reaches the promotion UPDATE and blocks on A; A commits; B resumes,
--    `status='draft'` still matches, and B promotes content it never
--    inspected. Fixed by locking the dispute's package rows before reading
--    the candidate.
--
-- 2. `content_revision` was only DB-*generated*, not DB-*owned*: a caller
--    could assign it directly when no inspected field changed, so "changes if
--    and only if the inspected fields change" was false. The trigger now
--    forces the old value back.
--
-- 3. The `already_done` branch ran before the version, currency and
--    fileability checks, so a STALE final package with a matching revision
--    could still be handed a save job.
--
-- 4. Nothing stopped a future PostgREST writer from doing `draft → final`
--    directly, outside either RPC.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. content_revision is OWNED by the database, not merely defaulted
-- ─────────────────────────────────────────────────────────────────────────

create or replace function defence_packages_bump_content_revision()
returns trigger
language plpgsql
as $$
begin
  if new.facts_json is distinct from old.facts_json
     or new.narrative_json is distinct from old.narrative_json
     or new.pdf_path is distinct from old.pdf_path
     or new.validation_status is distinct from old.validation_status
  then
    -- The database picks the new value. A caller cannot supply one, and
    -- cannot hold the old one to make a content change look like a no-op.
    new.content_revision := gen_random_uuid();
  else
    -- No inspected field moved, so the revision may not move either — an
    -- explicit assignment is silently reverted rather than honoured.
    new.content_revision := old.content_revision;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Only the RPC may promote draft/stale → final
-- ─────────────────────────────────────────────────────────────────────────
--
-- Transaction-local authorization: `finalize_defence_package` sets a GUC to
-- the id it is about to promote, and clears it immediately afterwards, so the
-- grant covers exactly one row and exactly one statement. `set_config(...,
-- true)` is rolled back with the transaction, so it cannot leak between
-- requests either.
--
-- Inventory of promotion writers at the time this trigger was enabled — all
-- three now go through the RPC:
--   · lib/automation/finalizeAndEnqueueSave.ts   (build job + reconcile)
--   · app/api/defence-packages/[id]/finalize/route.ts
--   · app/api/cron/defence-package-deadline-submit/route.ts
-- INSERTs are unaffected (this is a BEFORE UPDATE trigger), so seeds and
-- fixtures that create a `final` row directly keep working, as do the
-- legitimate final → submitted and final → superseded transitions.

create or replace function defence_packages_authorize_promotion()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('draft', 'stale') and new.status = 'final' then
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

drop trigger if exists defence_packages_authorize_promotion on defence_packages;
create trigger defence_packages_authorize_promotion
  before update on defence_packages
  for each row
  execute function defence_packages_authorize_promotion();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. finalize_defence_package — row locks, ordered checks, proven job
-- ─────────────────────────────────────────────────────────────────────────
--
-- The signature gains `p_allowed_statuses` so the deadline cron — which
-- auto-finalizes a `stale` candidate as well as a `draft` — can route through
-- the same function instead of writing `final` itself. Behaviour for every
-- existing caller is unchanged: the default is `{draft}`.

drop function if exists finalize_defence_package(uuid, uuid, integer, boolean);

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
  select dispute_id into v_dispute_id from defence_packages where id = p_package_id;
  if v_dispute_id is null then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_candidate');
  end if;

  -- ── Freeze the namespace, in a fixed order ───────────────────────────
  --
  -- (a) the parent dispute, which blocks INSERTs of a newer version through
  --     the FK's FOR KEY SHARE lock;
  -- (b) every existing package row for the dispute, ordered by id so two
  --     concurrent finalizers cannot deadlock, which blocks UPDATEs to the
  --     candidate's content, validation, PDF, version or lifecycle AND to any
  --     other row's version (which would change which row is latest).
  --
  -- Only after BOTH locks are held is the candidate read, so every value
  -- validated below is a committed value that cannot move before COMMIT.
  perform 1 from disputes where id = v_dispute_id for update;
  perform 1 from defence_packages where dispute_id = v_dispute_id order by id for update;

  select * into v_pkg from defence_packages where id = p_package_id;
  if v_pkg.id is null then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_candidate');
  end if;

  v_dedupe := 'dpkg-finalize:' || p_package_id::text;

  -- ── The inspected candidate, unchanged ───────────────────────────────
  if v_pkg.content_revision is distinct from p_expected_revision then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'content_changed');
  end if;
  if v_pkg.version is distinct from p_expected_version then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'version_mismatch');
  end if;

  -- ── Currency ─────────────────────────────────────────────────────────
  -- Checked BEFORE the idempotent-replay branch: a stale `final` package
  -- whose revision happens to match must not be handed a save job.
  select id into v_latest_id
    from defence_packages
   where dispute_id = v_dispute_id
   order by version desc
   limit 1;
  if v_latest_id is distinct from p_package_id then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'not_current');
  end if;

  -- ── Fileability ──────────────────────────────────────────────────────
  -- Also before the replay branch, for the same reason.
  if coalesce(v_pkg.validation_status, '') <> 'ok' then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'validation_not_ok');
  end if;
  if v_pkg.pdf_path is null or btrim(v_pkg.pdf_path) = '' then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'missing_pdf');
  end if;

  -- ── Idempotent replay ────────────────────────────────────────────────
  -- The candidate is current, unchanged and fileable, and it is ALREADY
  -- promoted. Either we committed and lost the reply, or another caller did
  -- the identical work. Converge, and make sure the job exists.
  if v_pkg.status in ('final', 'submitted') then
    if p_enqueue_save and v_pkg.status = 'final' then
      insert into jobs (shop_id, job_type, entity_id, dedupe_key)
      values (v_pkg.shop_id, 'save_to_shopify', v_pkg.source_pack_id::text, v_dedupe)
      on conflict (dedupe_key) where dedupe_key is not null do nothing
      returning id into v_job_id;
      if v_job_id is null then
        -- ON CONFLICT DO NOTHING returns no row; report the job that exists so
        -- the caller can PROVE the save was enqueued rather than assume it.
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

  -- ── Lifecycle ────────────────────────────────────────────────────────
  if not (v_pkg.status = any (p_allowed_statuses)) then
    return jsonb_build_object('outcome', 'conflict', 'reason', 'not_draft', 'status', v_pkg.status);
  end if;

  -- ── Promote ──────────────────────────────────────────────────────────
  -- The authorization grant is set immediately before the write and cleared
  -- immediately after, so it covers exactly this row and this statement.
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

  -- ── Supersede the prior final, guarded on ITS expected state ─────────
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

  -- ── Enqueue, in the SAME transaction ─────────────────────────────────
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

comment on function finalize_defence_package(uuid, uuid, integer, boolean, text[]) is
  'PR-C1: promote an inspected candidate to final, supersede the prior final '
  'and (optionally) enqueue the save — one transaction, under a FOR UPDATE '
  'lock on the parent dispute AND on every package row for that dispute. '
  'Returns {outcome: promoted|already_done|conflict}.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. enqueue_defence_package_save — same locking discipline
-- ─────────────────────────────────────────────────────────────────────────

create or replace function enqueue_defence_package_save(
  p_package_id uuid,
  p_expected_revision uuid
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

  select id into v_latest_id
    from defence_packages
   where dispute_id = v_dispute_id
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
revoke execute on function enqueue_defence_package_save(uuid, uuid) from public, anon, authenticated;
grant execute on function finalize_defence_package(uuid, uuid, integer, boolean, text[]) to service_role;
grant execute on function enqueue_defence_package_save(uuid, uuid) to service_role;
