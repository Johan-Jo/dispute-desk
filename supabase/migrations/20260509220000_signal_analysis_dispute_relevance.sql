-- Signal Radar M1.5 — dispute_relevance flag
-- The classifier's existing `merchant_relevance` boolean is too generous —
-- it flags any Shopify-merchant content as relevant, including SEO/theme/
-- marketing/general-support pain. Streams filling with that noise hides
-- the actual dispute signals.
--
-- This new flag is FALSE by default. The classifier sets it TRUE only when
-- the post specifically discusses chargebacks, disputes, payout holds,
-- reserves, fraud orders, Shopify Protect, evidence/representment, or
-- chargeback/dispute apps. Dashboard streams filter on it.
--
-- Existing rows default to false (the classifier prompt at the time they
-- were written didn't distinguish dispute-pain from generic merchant pain).
-- A separate one-shot script flips their analysis_status back to pending
-- so the next classifier-drain tick re-classifies them with the new prompt.

alter table signal_analysis
  add column dispute_relevance boolean not null default false;

-- Stream queries do `WHERE dispute_relevance = true AND <category-or-other>`
-- so a partial index on the true side keeps the table scan cheap.
create index idx_signal_analysis_dispute_relevant
  on signal_analysis (created_at desc)
  where dispute_relevance = true;
