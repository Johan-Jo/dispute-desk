-- Historical Intelligence Engine — Phase D: model-feasibility verdict storage.
--
-- Phase D is CONDITIONAL (design §12). The engine evaluates whether each model
-- type passes its predefined gates and stores the verdict; a model is built ONLY
-- when feasible. For Blume Box the expected outcome is "no model built" (risk
-- retrospective, small N) — descriptive outputs are retained. No model artifacts
-- table is created until a model is actually feasible.

alter table intelligence_analysis_runs
  add column if not exists feasibility jsonb;

-- Response-win model report (chronological backtest + calibration), present ONLY
-- when the response model passed its feasibility gates. Null otherwise.
alter table intelligence_analysis_runs
  add column if not exists model_report jsonb;

comment on column intelligence_analysis_runs.feasibility is
  'Model-feasibility report (per-model gate verdicts). anyModelBuilt=false means modeling is unsupported for this shop. Phase D.';
comment on column intelligence_analysis_runs.model_report is
  'Response-win model report (backtest + calibration + selection-bias caveat). Present only when feasible. Phase D.';
