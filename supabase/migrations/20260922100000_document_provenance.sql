-- Document provenance: which records the produced defence document actually
-- rendered, and on which surface.
--
-- WHY A COLUMN, NOT A KEY INSIDE narrative_json / facts_json.
-- Absence has to be unambiguous. A missing nested key is indistinguishable
-- from a key that was never written, and the reader must be able to tell
-- "no map" (=> "cannot be determined") from "map says this record is
-- absent" (=> "not included in this document"). A NULL column says the
-- first plainly, and is queryable for the backfill question.
--
-- Deliberately NOT versioned alongside plan_policy_version /
-- ASSESSMENT_POLICY_VERSION: this map describes a rendered artifact, not a
-- policy, so writing it must never mark an assessment snapshot stale or
-- force a rebuild. Its own version lives inside the JSON
-- (provenanceVersion), next to the `complete` assertion.
--
-- Existing rows stay NULL. Those packages rendered before anything recorded
-- provenance, so the honest answer for them is "cannot be determined" --
-- NOT a reconstruction from today's facts_json or today's evidence, which
-- are different sources answering different questions.
alter table public.defence_packages
  add column if not exists document_provenance_json jsonb;

comment on column public.defence_packages.document_provenance_json is
  'Record -> rendered document surfaces for THIS package version. Written '
  'by the producer at composition time, only for a successfully produced '
  'document. NULL = no map (cannot be determined), never "not included".';
