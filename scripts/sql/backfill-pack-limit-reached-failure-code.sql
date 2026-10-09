-- Stamp failure_code on packs that failed at consume with no credit left.
-- buildPackJob flipped them to 'failed' without a code, so the UI showed the
-- generic "system issue" banner. Evidence: the pack_limit_reached_at_consume
-- audit row. Only touches packs still failed with no code.
update evidence_packs p
   set failure_code = 'pack_limit_reached',
       failure_reason = 'No pack credit left at consume (backfilled from audit)'
 where p.status = 'failed'
   and p.failure_code is null
   and exists (select 1 from audit_events a
                where a.pack_id = p.id and a.event_type = 'pack_limit_reached_at_consume')
returning p.id, p.shop_id;
