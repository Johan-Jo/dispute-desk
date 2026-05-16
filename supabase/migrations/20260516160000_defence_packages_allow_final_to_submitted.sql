-- Fix immutability trigger to allow `final → submitted` transitions.
--
-- Background: saveToShopifyJob marks the active defence_packages row
-- `status=submitted` after Shopify confirms receipt via the
-- verifyEvidenceReadback. The existing trigger
-- `defence_packages_enforce_immutability` rejects this with
-- "status final may only transition to superseded", and also blocks
-- updates to shopify_response / submitted_at / submitted_by from a
-- final row (the column-lock branch lists only status / superseded_by_id /
-- updated_at as allowed). The audit event `defence_package_submitted`
-- fires regardless because saveToShopifyJob doesn't check the update's
-- error envelope — the trigger silently swallows the state transition.
-- Verified 2026-05-16 against dispute bd425f70 v9: audit event logged,
-- row stayed at status=final, shopify_response=null.
--
-- Fix: extend the trigger to allow `final → submitted` AND permit
-- shopify_response, submitted_at, submitted_by writes on final rows
-- (these columns are already allowed on a `submitted` row; the
-- mismatch was that the WRITE that flips final → submitted needs to
-- touch them in the SAME statement).

create or replace function defence_packages_enforce_immutability()
returns trigger as $$
declare
  v_supersedor_status text;
begin
  -- Reject status regressions.
  if old.status = 'final' and new.status not in ('final','submitted','superseded') then
    raise exception 'defence_packages: status final may only transition to submitted or superseded (attempted: %)', new.status;
  end if;

  if old.status = 'submitted' and new.status not in ('submitted','superseded') then
    raise exception 'defence_packages: submitted is terminal — status may only transition to superseded (attempted: %)', new.status;
  end if;

  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'defence_packages: superseded is terminal — status may not change (attempted: %)', new.status;
  end if;

  if old.status = 'skipped' and new.status not in ('skipped','superseded') then
    raise exception 'defence_packages: skipped may only transition to superseded (attempted: %)', new.status;
  end if;

  if old.status = 'failed' and new.status not in ('failed','superseded') then
    raise exception 'defence_packages: failed may only transition to superseded (attempted: %)', new.status;
  end if;

  -- Once final: lock everything EXCEPT status, superseded_by_id,
  -- shopify_response, submitted_at, submitted_by, updated_at — those
  -- are the columns saveToShopifyJob needs to write when flipping
  -- final → submitted.
  if old.status = 'final' then
    if new.narrative_json is distinct from old.narrative_json
       or new.facts_json is distinct from old.facts_json
       or new.pdf_path is distinct from old.pdf_path
       or new.evidence_hash is distinct from old.evidence_hash
       or new.package_mode is distinct from old.package_mode
       or new.validation_status is distinct from old.validation_status
       or new.validation_errors is distinct from old.validation_errors
       or new.llm_model is distinct from old.llm_model
       or new.prompt_family is distinct from old.prompt_family
       or new.prompt_version is distinct from old.prompt_version
       or new.reason_code_module is distinct from old.reason_code_module
       or new.version is distinct from old.version
       or new.dispute_id is distinct from old.dispute_id
       or new.source_pack_id is distinct from old.source_pack_id
       or new.generated_by is distinct from old.generated_by
       or new.generated_at is distinct from old.generated_at
    then
      raise exception 'defence_packages: row is final and immutable except for status, superseded_by_id, shopify_response, submitted_at, submitted_by, updated_at';
    end if;
  end if;

  -- Once submitted: lock all columns except shopify_response, submitted_at,
  -- submitted_by, superseded_by_id, updated_at.
  if old.status = 'submitted' then
    if new.narrative_json is distinct from old.narrative_json
       or new.facts_json is distinct from old.facts_json
       or new.pdf_path is distinct from old.pdf_path
       or new.evidence_hash is distinct from old.evidence_hash
       or new.package_mode is distinct from old.package_mode
       or new.validation_status is distinct from old.validation_status
       or new.validation_errors is distinct from old.validation_errors
       or new.llm_model is distinct from old.llm_model
       or new.prompt_family is distinct from old.prompt_family
       or new.prompt_version is distinct from old.prompt_version
       or new.reason_code_module is distinct from old.reason_code_module
       or new.version is distinct from old.version
       or new.dispute_id is distinct from old.dispute_id
       or new.source_pack_id is distinct from old.source_pack_id
       or new.generated_by is distinct from old.generated_by
       or new.generated_at is distinct from old.generated_at
    then
      raise exception 'defence_packages: row is submitted and immutable except for shopify_response/submitted_at/submitted_by/superseded_by_id';
    end if;
  end if;

  -- When setting superseded_by_id, validate the supersedor exists and is itself
  -- 'final'. This prevents accidental forward references to a draft.
  if new.superseded_by_id is not null
     and (old.superseded_by_id is null or new.superseded_by_id <> old.superseded_by_id)
  then
    select status into v_supersedor_status
      from defence_packages
      where id = new.superseded_by_id;
    if v_supersedor_status is null then
      raise exception 'defence_packages: superseded_by_id refers to non-existent row';
    end if;
    if v_supersedor_status <> 'final' then
      raise exception 'defence_packages: superseded_by_id must point to a row in status=final (got %)', v_supersedor_status;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;
