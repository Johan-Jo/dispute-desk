-- 026: Shop preference for policy template language (English vs translated)

alter table shops
  add column if not exists policy_template_lang text not null default 'en'
  check (policy_template_lang in ('en','locale'));

comment on column shops.policy_template_lang is 'en = always English templates; locale = use translated templates when available (by shop locale)';
