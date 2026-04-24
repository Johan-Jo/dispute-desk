-- Bucket used by both rendered pack PDFs (renderPdfJob) and merchant manual uploads
-- (POST /api/packs/:packId/upload). When the bucket was created in the dashboard it
-- was likely restricted to application/pdf only, which returned 400 for JPEG/PNG/etc.
-- Keep MIME open (API validates allowed types) and ensure the size cap matches the
-- 10 MB route limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence-packs',
  'evidence-packs',
  false,
  10485760,
  null
)
on conflict (id) do update set
  allowed_mime_types = null,
  file_size_limit = case
    when storage.buckets.file_size_limit is not null
      and storage.buckets.file_size_limit < 10485760
    then 10485760
    else storage.buckets.file_size_limit
  end;
