-- Two more ways to tie a package to the evidence Shopify actually holds.
--
-- The original constraint allowed only EVIDENCE_GID_MATCH, which turns out to
-- be much weaker than its name suggests: Shopify keeps ONE mutable evidence
-- record per dispute, so every package saved against a dispute carries the
-- SAME evidence GID. Verified on prod — versions 2, 3 and 5 of dispute
-- d466544f all matched it. The GID names the dispute, never the version, so a
-- dispute with several saves was filed under AMBIGUOUS_MULTIPLE_PACKAGES and
-- written off as unanalysable.
--
-- EVIDENCE_FILE_MATCH is the signal that does discriminate. Each save uploads
-- its own PDF and replaces the evidence record's `uncategorizedFile`, so that
-- file's GID names the package the issuer holds. It is now captured on the
-- dispute snapshot (lib/shopify/queries/disputes.ts) and available from
-- 2026-09-01 on.
--
-- LATEST_VERIFIED_SAVE covers every snapshot taken before that. With no
-- captured file GID, replace-on-save still means the last VERIFIED save is what
-- the record ended up holding. That is an inference rather than a recorded
-- fact, so it is named separately and analysisLevel.ts keeps it short of full
-- analysis.
--
-- Widening a CHECK is safe on existing rows: every stored value stays legal.
-- This migration exists because the constraint refused the new values on the
-- exact two disputes the change was written to rescue, which is the invariant
-- working rather than failing.

alter table post_outcome_analyses
  drop constraint if exists post_outcome_evidence_tie_valid;

alter table post_outcome_analyses
  add constraint post_outcome_evidence_tie_valid
  check (package_evidence_tie in (
    'EVIDENCE_FILE_MATCH',
    'EVIDENCE_GID_MATCH',
    'LATEST_VERIFIED_SAVE',
    'AMBIGUOUS_MULTIPLE_PACKAGES',
    'NONE'));

comment on column post_outcome_analyses.package_evidence_tie is
  'How the analysed package was tied to the platform evidence. EVIDENCE_FILE_MATCH (the evidence record holds this package''s file) is the only value that discriminates between versions; EVIDENCE_GID_MATCH confirms the package was saved to this dispute and nothing more, because the evidence GID is shared by every version.';
