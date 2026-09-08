-- Targeted in-app messages from admin to a single merchant.
--
-- Ops needs a way to reach one specific shop inside the app: a
-- dismissible banner on their dashboard carrying a short message,
-- optionally asking for a contact channel (email / phone) which is
-- mailed back to the ops address.
--
-- One row = one message to one shop. Multiple active rows are allowed
-- (the dashboard renders the newest); "active" means published, not
-- dismissed, and not past expires_at.

create table if not exists public.merchant_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,

  -- Banner copy. Free text authored by an admin, rendered verbatim to
  -- the merchant. Not an I18nToken: these are one-off human messages
  -- written for a specific merchant in whatever language suits them,
  -- which is exactly the case the i18n rule carves out (no library
  -- code emits these, and nothing derives them from pack data).
  title text not null,
  body text not null,

  -- When true the banner shows email/phone inputs and a submit button.
  -- When false it is a read-only notice.
  ask_for_contact boolean not null default true,

  tone text not null default 'info'
    check (tone in ('info', 'success', 'warning', 'critical')),

  -- Lifecycle. Draft rows never render; expires_at lets a message age
  -- out on its own so a stale ask doesn't linger for months.
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  expires_at timestamptz,

  -- Merchant response.
  dismissed_at timestamptz,
  responded_at timestamptz,
  response_email text,
  response_phone text,
  response_note text,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The dashboard's hot path: newest active message for one shop.
create index if not exists merchant_messages_shop_active_idx
  on public.merchant_messages (shop_id, status, created_at desc);

-- Server-only, same posture as the rest of the ops tables: RLS on with
-- no policies, so anon/authenticated get nothing and the service role
-- (which bypasses RLS) is the only reader/writer.
alter table public.merchant_messages enable row level security;

comment on table public.merchant_messages is
  'Admin-authored in-app banners targeted at a single shop, with optional contact-details capture. Service-role access only.';
