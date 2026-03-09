-- 027: Policy template language = explicit language choice (en, de, fr, es, pt, sv)
-- So users can choose e.g. English for policy text even when their UI locale is German.

alter table shops drop constraint if exists shops_policy_template_lang_check;

update shops set policy_template_lang = 'en' where policy_template_lang = 'locale';

alter table shops add constraint shops_policy_template_lang_check
  check (policy_template_lang in ('en','de','fr','es','pt','sv'));

comment on column shops.policy_template_lang is 'Language of policy template content: en, de, fr, es, pt, sv. User chooses explicitly (e.g. English even when UI is German).';
