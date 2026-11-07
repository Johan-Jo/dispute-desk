-- F-1b / B1 measurement export (READ-ONLY): every enabled automation rule, so a
-- replay can call the pure `pickAutomationAction` (never `evaluateRules`, which
-- writes a rule_applied audit event).
select * from rules where enabled = true order by shop_id, priority;
