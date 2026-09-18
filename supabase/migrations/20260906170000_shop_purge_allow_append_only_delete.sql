-- Allow ONE explicitly-flagged path to delete append-only rows, so an
-- internal admin can fully purge a shop.
--
-- The admin Shops list carries dev stores, our own test installs and
-- app-review throwaways next to real merchants. Removing one has to be a
-- real delete — the merchant should have to install again — not a hide.
--
-- The obstacle: every per-shop table cascades from `shops`, and
-- `audit_events` / `dispute_events` each carry a BEFORE DELETE trigger
-- raising `append-only: DELETE not allowed`. So `delete from shops` aborts
-- the whole transaction. (Verified on dev 2026-09-06 inside a rolled-back
-- transaction; the same constraint silently breaks the GDPR `shop/redact`
-- handler, which lists both tables in its cascade and swallows the error.)
--
-- Rather than drop the immutability guarantee, the triggers now yield to a
-- single session-local flag. Ordinary application traffic never sets it, so
-- an accidental or malicious DELETE is refused exactly as before; only code
-- that has deliberately opted in — `set_config('app.allow_append_only_delete',
-- 'on', true)`, true = transaction-scoped, so it cannot leak past COMMIT —
-- gets through. UPDATE stays unconditionally forbidden on both tables:
-- rewriting history is never legitimate, while erasing a shop wholesale is.
create or replace function reject_audit_mutation()
returns trigger as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.allow_append_only_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'audit_events is append-only: % not allowed', tg_op;
end;
$$ language plpgsql;

create or replace function reject_dispute_event_mutation()
returns trigger as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.allow_append_only_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'dispute_events is append-only: % not allowed', tg_op;
end;
$$ language plpgsql;

-- The purge itself, as a SECURITY DEFINER function: the flag is set and the
-- deletes run together inside one transaction that either fully completes or
-- fully rolls back. Doing this from application code would mean a
-- non-transactional sequence of PostgREST calls that can strand a
-- half-deleted shop -- which is exactly how `shop/redact` fails today.
--
-- The table list is DISCOVERED from the FK graph rather than hardcoded. A
-- hand-maintained list rots the moment a migration adds a per-shop table, and
-- silently: the new table's rows simply survive the purge. It also cannot be
-- written correctly by hand -- `evidence_items`, `pack_templates` and
-- `integration_secrets` hang off a parent, not off `shops`, so a plausible
-- hand-written list produces `column "shop_id" does not exist` (hit while
-- building this, 2026-09-06).
--
-- So: delete directly from every table with a real FK to `shops`, then let
-- Postgres' own ON DELETE CASCADE clear their children when the `shops` row
-- goes. Ordering within the loop does not matter, because the whole thing is
-- one transaction and FKs are checked at statement end.
create or replace function admin_purge_shop(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text;
  v_counts jsonb := '{}'::jsonb;
  v_table  text;
  v_col    text;
  v_n      bigint;
begin
  select shop_domain into v_domain from shops where id = p_shop_id;
  if v_domain is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_shop');
  end if;

  -- Transaction-scoped: reverts on COMMIT or ROLLBACK either way.
  perform set_config('app.allow_append_only_delete', 'on', true);

  for v_table, v_col in
    select (c.conrelid::regclass)::text, a.attname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum   = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.shops'::regclass
       and array_length(c.conkey, 1) = 1
       and c.conrelid <> 'public.shops'::regclass
  loop
    execute format('delete from %s where %I = $1', v_table, v_col) using p_shop_id;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object(v_table, v_n);
    end if;
  end loop;

  -- Children of the above (evidence_items, pack_templates,
  -- integration_secrets, ...) go via their own ON DELETE CASCADE.
  delete from shops where id = p_shop_id;
  get diagnostics v_n = row_count;

  return jsonb_build_object(
    'ok', v_n = 1,
    'shop_domain', v_domain,
    'deleted', v_counts
  );
end;
$$;

comment on function admin_purge_shop(uuid) is
  'Hard-deletes a shop and every per-shop row, in one transaction. Internal-admin only -- the merchant must reinstall afterwards. Discovers target tables from the FK graph so a new per-shop table is covered automatically. Sets app.allow_append_only_delete so the audit_events/dispute_events append-only triggers permit this one path; those triggers still refuse every other DELETE and all UPDATEs.';

-- Service-role only. Never grant to anon/authenticated: this is the most
-- destructive operation in the schema.
revoke all on function admin_purge_shop(uuid) from public;
