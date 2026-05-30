-- Plan recommendation persistence (PR 2 of post-install plan recommendation).
--
-- One row per shop holds the latest computed tier recommendation plus the
-- merchant's dismissal state. Two writers keep it fresh:
--   1. GET /api/dashboard/insights/initial-analysis upserts on page view
--      (immediate population once the historical import completes).
--   2. The monthly cron /api/cron/plan-recommendations recomputes for every
--      Free shop so the dashboard banner stays current even for merchants
--      who never reopen the Risk Intelligence page.
--
-- Dismissal is keyed to the recommended plan (`dismissed_plan`), NOT a
-- timestamp: dismissing a "Starter" nudge hides the banner only while the
-- recommendation stays "starter". If the shop's volume grows and the
-- recommendation escalates to "growth", that is a fresh, stronger signal and
-- the banner re-appears. The upsert path therefore never overwrites the
-- dismissal columns — only the dismissal API does.
--
-- Server-only: RLS is enabled with no policies, so the anon/auth roles have
-- no access. All reads/writes go through the service-role client, which
-- bypasses RLS.

create table if not exists public.plan_recommendations (
  shop_id              uuid primary key
                         references public.shops(id) on delete cascade,
  recommended_plan     text not null,
  monthly_chargebacks  numeric not null default 0,
  headroom_multiplier  numeric,            -- null when Free is recommended
  reason               text not null,
  partial_history      boolean not null default false,
  computed_at          timestamptz not null default now(),
  -- Dismissal state (see header). dismissed_plan is the plan the merchant
  -- dismissed; the banner shows when recommended_plan <> 'free' AND
  -- dismissed_plan IS DISTINCT FROM recommended_plan.
  dismissed_plan       text,
  dismissed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.plan_recommendations is
  'Latest per-shop plan tier recommendation + dismissal state. Server-only (RLS, no policies). Written by the insights endpoint and the monthly recompute cron.';
comment on column public.plan_recommendations.dismissed_plan is
  'The recommended_plan value the merchant dismissed. Banner re-surfaces when the recommendation changes to a different plan.';

alter table public.plan_recommendations enable row level security;
