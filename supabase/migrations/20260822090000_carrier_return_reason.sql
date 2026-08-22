-- Why a returned parcel went back: refused | not_collected | undeliverable.
--
-- Klarna's merchant rules turn on this distinction — a parcel the customer
-- REFUSED or never COLLECTED "is not a valid use of the right of withdrawal
-- (in the EU) nor is it considered a valid return", which is arguable, while
-- an undeliverable address argues nothing. Only the carrier's own event
-- timeline can suggest it, and that timeline is discarded after the lookup.
--
-- PERSISTED, not derived on read. `lib/carriers/lookupCache.ts` reuses a
-- terminal result without re-calling the carrier, so anything that lives only
-- in the live adapter response is lost on the first rebuild — exactly how
-- `carrierTerminalEvent` silently went null on cay-collective #13195 between
-- its first build and its second (fixed 2026-08-21, PR #593). This column is
-- that lesson applied ahead of time.
--
-- NULL is the expected value and carries no meaning beyond "the carrier did
-- not say". It is never bank-facing on its own: it renders as a hint beside
-- the merchant's own answer, and only the merchant's answer is citable.

alter table public.shopify_fulfillment_trackings
  add column if not exists return_reason text;

alter table public.shopify_fulfillment_trackings
  drop constraint if exists shopify_fulfillment_trackings_return_reason_chk;

alter table public.shopify_fulfillment_trackings
  add constraint shopify_fulfillment_trackings_return_reason_chk
  check (return_reason is null
         or return_reason in ('refused', 'not_collected', 'undeliverable'));

comment on column public.shopify_fulfillment_trackings.return_reason is
  'Carrier-suggested reason a shipment was returned to sender (refused | not_collected | undeliverable). NULL = the carrier did not say, which is the common case. A hint for the merchant UI only — never a bank-facing claim on its own.';
