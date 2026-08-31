-- Allow the VAMP / ECM / EFM ratios to be NULL.
--
-- These are Visa and Mastercard programme ratios: chargebacks on a card
-- network over settlement records on a card network. They were being
-- computed across every rail, so a merchant whose disputes are PayPal or
-- Klarna got a confident percentage with a Visa label and no Visa content —
-- measured on prod before the fix, Mein Maison showed 2.79% "VAMP" off a
-- book that is ~99% PayPal, and cay-collective 0.55% off one that is 100%
-- Klarna.
--
-- With the calculation now scoped to the card rail, a merchant with no card
-- volume has NO VAMP ratio. That is not zero. `safeRatio` previously
-- returned 0 for an empty denominator, which rendered a green "0.00%"
-- compliance pill for a merchant the programme does not measure at all —
-- the same "absence read as a good number" failure as the 3-D Secure
-- false-zero incident.
--
-- NULL now means "not applicable / no card volume" and the UI renders it as
-- such instead of inventing a pass.
alter table ratio_snapshots
  alter column vamp_ratio_calculated drop not null,
  alter column vamp_ratio_without_dd drop not null,
  alter column mc_ecm_ratio drop not null,
  alter column mc_efm_ratio drop not null;

comment on column ratio_snapshots.vamp_ratio_calculated is
  'Visa VAMP ratio over CARD-rail disputes and card settlement records. NULL = no card volume in the period, i.e. the programme does not measure this merchant. Never conflate NULL with 0.';
comment on column ratio_snapshots.mc_ecm_ratio is
  'Mastercard ECM ratio, card rail only. NULL = no card volume — not zero.';
comment on column ratio_snapshots.mc_efm_ratio is
  'Mastercard EFM ratio, card rail only. NULL = no card volume — not zero.';

-- Existing rows were computed across all rails, so their values are not
-- card ratios and must not be shown as such. Null them; the monthly job
-- recomputes each period on the corrected basis.
update ratio_snapshots
   set vamp_ratio_calculated = null,
       vamp_ratio_without_dd = null,
       mc_ecm_ratio = null,
       mc_efm_ratio = null;
