-- Structured attention columns on disputes.
--
-- The UI must not parse free-text `next_action_text` to decide which
-- banner / CTA / next action to show. The 2026-05-15 incident proved
-- the existing `needs_attention` boolean + free-text `next_action_text`
-- are not enough — a merchant with `auto_build` quota_exceeded needs a
-- different banner copy + CTA than one with `submission_failed`.
--
-- attention_reason  — canonical, code-checked constant from
--                     `lib/disputes/attentionReasons.ts`. Free-text is
--                     allowed at the DB layer (no CHECK constraint) to
--                     keep migrations trivial; enforcement lives in
--                     TypeScript.
-- attention_payload — structured context attached to the reason
--                     (quota numbers, plan id, failure code, etc.).
--                     Always a JSON object; never used for free-text
--                     duplication of `next_action_text`.

alter table disputes
  add column if not exists attention_reason text,
  add column if not exists attention_payload jsonb not null default '{}'::jsonb;

comment on column disputes.attention_reason is
  'Canonical reason this dispute needs merchant attention. Values are
   maintained in lib/disputes/attentionReasons.ts. Always paired with
   needs_attention=true; cleared (set to NULL) when the underlying
   condition is resolved.';

comment on column disputes.attention_payload is
  'Structured context for the attention_reason. Shape varies by reason
   — e.g. quota_exceeded => {plan, remaining, limit}, payment_failed
   => {shopify_charge_gid, retry_count}. UI reads this to render the
   right banner + CTA without parsing free text.';
