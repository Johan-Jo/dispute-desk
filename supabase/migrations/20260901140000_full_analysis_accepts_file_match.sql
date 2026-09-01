-- FULL_POST_OUTCOME must accept the STRONGER package tie, not only the weaker.
--
-- 20260901100000 added EVIDENCE_FILE_MATCH to the allowed tie values but left
-- this constraint naming EVIDENCE_GID_MATCH alone. The moment the deploy landed
-- and the dispute sync began capturing `disputeEvidence.uncategorizedFile`, 474
-- disputes gained a file GID, single-package cases started resolving to the
-- file match, and 48 of 50 analyses were refused at insert — for being tied to
-- the submission MORE precisely than before.
--
-- The ordering is the point. EVIDENCE_FILE_MATCH identifies the package whose
-- file the evidence record actually holds; EVIDENCE_GID_MATCH only confirms the
-- package was saved to this dispute, because every version of a dispute shares
-- one evidence GID. Admitting the weaker tie to full analysis while refusing
-- the stronger one is backwards.
--
-- LATEST_VERIFIED_SAVE is deliberately NOT added. It infers the package from
-- save order rather than reading a recorded fact, and analysisLevel.ts already
-- holds it at PACKAGE_INTEGRITY_ONLY with a data-integrity limitation. This
-- constraint is the second line of that same decision.

alter table post_outcome_analyses
  drop constraint if exists post_outcome_full_requires_package_tie;

alter table post_outcome_analyses
  add constraint post_outcome_full_requires_package_tie
  check (
    analysis_level <> 'FULL_POST_OUTCOME'
    or package_evidence_tie in ('EVIDENCE_FILE_MATCH', 'EVIDENCE_GID_MATCH')
  );
