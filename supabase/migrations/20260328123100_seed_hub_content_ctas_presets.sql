-- Seed content_ctas rows matching Admin → Settings → Default CTA option values (event_name).
-- Generation resolves primary CTA via settings_json.defaultCta → content_ctas.event_name.
-- Idempotent: skips when a row with the same event_name already exists.

INSERT INTO content_ctas (type, destination, event_name, localized_copy_json)
SELECT 'external', 'https://disputedesk.app/auth/sign-up', 'free_trial', '{"en-US":{"label":"Start free trial"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM content_ctas WHERE event_name = 'free_trial');

INSERT INTO content_ctas (type, destination, event_name, localized_copy_json)
SELECT 'external', 'https://disputedesk.app/', 'demo_request', '{"en-US":{"label":"Request a demo"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM content_ctas WHERE event_name = 'demo_request');

INSERT INTO content_ctas (type, destination, event_name, localized_copy_json)
SELECT 'external', 'https://disputedesk.app/auth/sign-up', 'newsletter', '{"en-US":{"label":"Newsletter signup"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM content_ctas WHERE event_name = 'newsletter');

INSERT INTO content_ctas (type, destination, event_name, localized_copy_json)
SELECT 'external', 'https://disputedesk.app/resources', 'download', '{"en-US":{"label":"Browse resources"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM content_ctas WHERE event_name = 'download');
