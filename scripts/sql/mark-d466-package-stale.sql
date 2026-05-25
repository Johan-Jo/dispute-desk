-- Dev-only: mark the submitted defence package for dispute
-- d466544f-d8ed-4e29-b04d-34834ab3c6b5 as `stale` so the embedded
-- Regenerate button appears (gated by submittedRowIsStale in
-- CompleteDefencePackageCard.tsx). This lets the merchant pull in the
-- evidence-basis caption removal + capitalization fix that landed
-- after this package's PDF was rendered.
update defence_packages
set status = 'stale',
    updated_at = now()
where id = '5e39499c-e86c-4c36-a474-2ad82ea815b3'
  and dispute_id = 'd466544f-d8ed-4e29-b04d-34834ab3c6b5'
returning id, status, version, updated_at;
