-- What the bank's claim actually disputes (lib/disputes/bankClaimAnalysis.ts):
-- { reason, authorizationDisputed, returnOrRefundRequested, model, analyzedAt }.
-- Read once when the claim is saved (or lazily by the letter builder) and used
-- to pick the letter template / evidence checklist and to remove facts the
-- claim makes irrelevant or contradicts.
alter table dispute_bank_claims add column if not exists analysis jsonb;
