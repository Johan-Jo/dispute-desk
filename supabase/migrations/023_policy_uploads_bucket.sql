-- Policy document uploads for the Policies page (portal).
-- Service role is used for uploads; no RLS policies needed for app backend.
insert into storage.buckets (id, name, public)
values ('policy-uploads', 'policy-uploads', false)
on conflict (id) do nothing;
