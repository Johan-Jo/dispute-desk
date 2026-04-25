-- DB-backed short codes for bank-facing evidence URLs.
--
-- Replaces the long HMAC-signed tokens previously embedded in the path
-- (`/e/<base64.payload.base64.signature>`, ~220 chars) with a short
-- random Crockford Base32 code (`/e/Q7K2HXRJ9P`, ~36 chars total).
-- The route handler at app/e/[token]/route.ts retains the HMAC verifier
-- as a fallback so legacy long tokens already submitted to Shopify keep
-- working until their natural 180-day TTL elapses.

create table if not exists evidence_short_links (
  id uuid primary key default gen_random_uuid(),
  short_code text not null unique,
  kind text not null check (kind in ('item', 'pdf')),
  entity_id uuid not null,
  pack_id uuid not null references evidence_packs(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  dispute_id uuid references disputes(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz
);

create index if not exists evidence_short_links_pack_id_idx
  on evidence_short_links(pack_id);

create index if not exists evidence_short_links_lookup_idx
  on evidence_short_links(kind, entity_id, pack_id);

alter table evidence_short_links enable row level security;

-- No policies created intentionally. All reads/writes go through the
-- service role (bank-facing route uses getServiceClient(); save job
-- uses the same). With RLS enabled and no policies, anon/authenticated
-- roles see nothing — service role bypasses RLS as expected.

comment on table evidence_short_links is
  'Short URL codes for bank-facing evidence attachments. Replaces HMAC-signed tokens. Resolved server-side by /e/<code>.';
comment on column evidence_short_links.short_code is
  'Crockford Base32 (10 chars by default). The bank-facing URL path segment.';
comment on column evidence_short_links.kind is
  '"item" → evidence_items.id; "pdf" → evidence_packs.id pack PDF.';
