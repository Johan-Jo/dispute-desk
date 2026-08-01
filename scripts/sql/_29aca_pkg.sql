select id, version, status, package_mode, generated_at, validation_status,
       prompt_family, prompt_version, reason_code_module, failure_code, failure_reason,
       jsonb_pretty(narrative_json) as narrative
from defence_packages
where dispute_id = '29aca84c-3547-4ddc-8100-41f6530b1a52'
order by version desc
limit 2;
