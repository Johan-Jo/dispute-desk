-- 012: add retention_days and uninstalled_at to shops
alter table shops add column if not exists retention_days int not null default 365;
alter table shops add column if not exists uninstalled_at timestamptz;
