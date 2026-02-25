-- 011: add name column to rules
alter table rules add column if not exists name text;
