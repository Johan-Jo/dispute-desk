-- Find the actual column names on evidence_items so the cardholder
-- diagnostic query can address the right fields.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'evidence_items'
 order by ordinal_position;
