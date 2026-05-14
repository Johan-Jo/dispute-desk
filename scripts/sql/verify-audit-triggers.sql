SELECT tgname, tgenabled
  FROM pg_trigger
 WHERE tgrelid = 'audit_events'::regclass
   AND tgname IN ('trg_audit_no_delete','trg_audit_no_update');
