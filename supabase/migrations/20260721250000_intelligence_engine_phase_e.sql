-- Historical Intelligence Engine — Phase E: LLM explanation storage.
--
-- The structured recommendation stays authoritative (design §22). The LLM only
-- turns an already-validated object into merchant-friendly prose; both are
-- stored. No schema for the LLM to write numbers — it never recalculates.

alter table intelligence_recommendations
  add column if not exists explanation text,
  add column if not exists explanation_model text,
  add column if not exists explanation_generated_at timestamptz;

comment on column intelligence_recommendations.explanation is
  'LLM-generated prose derived ONLY from the structured recommendation. The structured object remains authoritative. Phase E.';
