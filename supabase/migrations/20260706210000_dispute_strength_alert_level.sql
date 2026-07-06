-- Dedupe column for the "your case got stronger" merchant email.
--
-- Stores the highest case-strength level we have already emailed the
-- merchant about for this dispute. The alert fires only when a rebuild
-- raises the case strength ABOVE this stored high-water mark, so:
--   - weak → moderate  → fires, stamps 'moderate'
--   - moderate → strong → fires again, stamps 'strong'
--   - moderate → weak → moderate (a re-roll) → does NOT re-fire (still <= 'moderate')
-- NULL means no strength alert has been sent yet.

alter table disputes
  add column if not exists strength_alert_level text;

comment on column disputes.strength_alert_level is
  'Highest case-strength level the merchant has been emailed about (insufficient|weak|moderate|strong). High-water mark that dedupes the case-strengthened alert (lib/email/sendCaseStrengthenedAlert.ts). NULL = never sent.';
