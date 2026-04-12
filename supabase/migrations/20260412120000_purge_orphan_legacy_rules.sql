-- Purge orphaned rules from the legacy preset system (system C) and the
-- dead reason-rows system (system B). Only pack-based rules
-- (__dd_setup__:pack:*, __dd_setup__:fallback:*), standalone safeguard
-- rules (__dd_safeguard__:*), and custom rules survive.

-- 1. Delete legacy preset rules by hardcoded names
DELETE FROM rules
WHERE name IN (
  'Auto-Pack Fraudulent Disputes',
  'Auto-Pack Product Not Received',
  'Review High-Value Disputes',
  'Catch-All: Send to Review'
);

-- 2. Delete orphaned reason-row and safeguard setup rules
DELETE FROM rules
WHERE name LIKE '__dd_setup__:reason:%'
   OR name LIKE '__dd_setup__:safeguard:%';
