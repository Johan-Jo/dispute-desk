-- Manual dispute evidence files (legacy bucket name; app may use evidence-packs instead).
-- When this bucket was created only in the dashboard, allowed_mime_types could block
-- JPEG/PNG/PDF combinations and Storage returned 400. The upload route validates types;
-- keep the bucket open and align max size with the API (10 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence-uploads',
  'evidence-uploads',
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
