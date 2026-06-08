-- Swedish keeps "Friendly Fraud" as the English industry term (like 'chargeback'),
-- not DeepL's literal "vänligt bedrägeri". Replace all case variants across the
-- Swedish article's text fields. "Friendly Fraud" (Title Case) reads correctly both
-- at sentence start and mid-sentence as a proper-noun-style industry term.
update content_localizations
set
  title = replace(replace(replace(title,'Vänligt bedrägeri','Friendly Fraud'),'vänligt bedrägeri','Friendly Fraud'),'Vänligt Bedrägeri','Friendly Fraud'),
  excerpt = replace(replace(replace(excerpt,'Vänligt bedrägeri','Friendly Fraud'),'vänligt bedrägeri','Friendly Fraud'),'Vänligt Bedrägeri','Friendly Fraud'),
  meta_title = replace(replace(replace(meta_title,'Vänligt bedrägeri','Friendly Fraud'),'vänligt bedrägeri','Friendly Fraud'),'Vänligt Bedrägeri','Friendly Fraud'),
  meta_description = replace(replace(replace(meta_description,'Vänligt bedrägeri','Friendly Fraud'),'vänligt bedrägeri','Friendly Fraud'),'Vänligt Bedrägeri','Friendly Fraud'),
  body_json = jsonb_set(
    body_json,
    '{mainHtml}',
    to_jsonb(
      replace(replace(replace(body_json->>'mainHtml','Vänligt bedrägeri','Friendly Fraud'),'vänligt bedrägeri','Friendly Fraud'),'Vänligt Bedrägeri','Friendly Fraud')
    )
  ),
  updated_at = now(), last_updated_at = now()
where content_item_id='bfd20772-26da-4ddb-b757-862a39d367bd' and locale='sv-SE';
