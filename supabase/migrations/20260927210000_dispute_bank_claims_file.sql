-- The bank's claim can now be uploaded as a file (PDF, TXT, DOC, DOCX, EML
-- or image) as well as pasted — Claude Design "Bank Claim Card.dc.html",
-- 2026-09-27 revision. The file is stored in the `evidence-packs` bucket;
-- `claim_text` holds the text read from it when it could be read.
--
-- text_source: how claim_text was obtained —
--   'pasted'     the merchant pasted it
--   'file_text'  read directly from a text file (TXT / EML / RTF)
--   'file_ai'    transcribed from a PDF or image by Claude
--   null         no text (no-claim-shown, or a file we could not read)

alter table dispute_bank_claims
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size int,
  add column if not exists file_mime text,
  add column if not exists text_source text
    check (text_source is null or text_source in ('pasted', 'file_text', 'file_ai'));

alter table dispute_bank_claims drop constraint if exists dispute_bank_claims_check;
alter table dispute_bank_claims
  add constraint dispute_bank_claims_answer_check
  check (claim_text is not null or no_claim_shown or file_path is not null);
