-- Historical Intelligence Engine — recommendation money columns: bigint → numeric.
--
-- The recommendation builder serializes money via toDecimalString() (an exact
-- major-unit decimal string, e.g. "3151771.23") — matching the baseline JSONB
-- path and how the UI renders amounts. The columns were declared bigint, so the
-- insert failed ("invalid input syntax for type bigint"). numeric accepts the
-- exact decimal strings (no float) and renders identically to the baseline
-- figures. Columns hold displayable amounts; the `_minor` suffix is legacy
-- naming (kept to avoid churn). Idempotent-safe casts; the table is empty when
-- first applied because every prior insert failed.

alter table intelligence_recommendations
  alter column affected_revenue_minor  type numeric using affected_revenue_minor::numeric,
  alter column affected_disputed_minor type numeric using affected_disputed_minor::numeric,
  alter column estimate_lower_minor    type numeric using estimate_lower_minor::numeric,
  alter column estimate_point_minor    type numeric using estimate_point_minor::numeric,
  alter column estimate_upper_minor    type numeric using estimate_upper_minor::numeric;
