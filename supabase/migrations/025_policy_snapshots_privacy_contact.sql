-- 025: Allow policy_type 'privacy' and 'contact' in policy_snapshots

alter table policy_snapshots
  drop constraint if exists policy_snapshots_policy_type_check;

alter table policy_snapshots
  add constraint policy_snapshots_policy_type_check
  check (policy_type in ('refunds','shipping','terms','privacy','contact'));
