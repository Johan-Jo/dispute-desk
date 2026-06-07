-- Finalize the cut-off English article (item e89d7922): the model ended the body
-- mid-sentence with a dangling, never-closed final <p>. Trim that trailing
-- unclosed paragraph so the article ends cleanly on the prior complete sentence.
-- Removes a trailing "<p>...(no </p>)" at the very end of mainHtml.
update content_localizations
set body_json = jsonb_set(
      body_json,
      '{mainHtml}',
      to_jsonb( regexp_replace(body_json->>'mainHtml', '<p>(?:(?!</p>).)*$', '') )
    ),
    updated_at = now(),
    last_updated_at = now()
where content_item_id = 'e89d7922-9d43-441a-838e-483d88c2e218'
  and locale = 'en-US';
