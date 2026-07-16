-- Carrier plan PR 1B: atomic touch-and-decide for alert dedup (§6.4, §7.3).
--
-- One call = record the occurrence AND decide whether to notify, race-free:
-- the conditional UPDATE takes a row lock, and a concurrent caller
-- re-evaluates the WHERE against the committed row (READ COMMITTED), so
-- exactly one worker wins the notification slot. Serverless workers share
-- no memory — this function IS the dedup mechanism.
--
-- Returns true when the caller should send the notification email.
-- Notify when: first occurrence, suppression window expired, or the
-- occurrence count crosses a meaningful threshold (10 / 100 / 1000 —
-- plan §7.3 re-alert rule).

create or replace function carrier_alert_touch(
  p_incident_key     text,
  p_environment      text,
  p_carrier          text,
  p_shop_id          uuid,
  p_category         text,
  p_correlation_id   text,
  p_suppress_seconds integer
) returns boolean
language plpgsql
as $$
declare
  v_notify boolean;
begin
  insert into carrier_alert_incidents as i
    (incident_key, environment, carrier, shop_id, category,
     occurrence_count, first_seen_at, last_seen_at, sample_correlation_id)
  values
    (p_incident_key, p_environment, p_carrier, p_shop_id, p_category,
     1, now(), now(), p_correlation_id)
  on conflict (incident_key) do update
    set occurrence_count = i.occurrence_count + 1,
        last_seen_at     = now();

  update carrier_alert_incidents
     set last_notified_at = now(),
         suppressed_until = now() + make_interval(secs => p_suppress_seconds)
   where incident_key = p_incident_key
     and (
       suppressed_until is null
       or suppressed_until < now()
       or occurrence_count in (10, 100, 1000)
     )
  returning true into v_notify;

  return coalesce(v_notify, false);
end;
$$;

comment on function carrier_alert_touch is
  'Atomic occurrence-record + notify-decision for carrier_alert_incidents. Returns true when the calling worker should send the support notification (first occurrence, window expiry, or 10/100/1000 threshold crossing). See docs/plans/carrier-delivery-verification.plan.md §6.4.';
