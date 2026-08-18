-- Diagnose validation_failed on defence package b3b4ec47 (cay-collective #13195)
-- Dispute 4537bbca-0f27-4579-ae17-c94ebfd3eb01
select jsonb_pretty(jsonb_build_object(
  'package', (
    select jsonb_build_object(
      'id', p.id,
      'version', p.version,
      'status', p.status,
      'failure_code', p.failure_code,
      'failure_reason', p.failure_reason,
      'validation_errors', p.validation_errors,
      'prompt_version', p.prompt_version,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'conclusion', p.narrative_json->'conclusion',
      'fact_categories', (
        select jsonb_agg(distinct f->>'category')
        from jsonb_array_elements(p.facts_json) f
      ),
      'refund_facts', (
        select jsonb_agg(f)
        from jsonb_array_elements(p.facts_json) f
        where f->>'category' = 'refund_record'
      )
    )
    from defence_packages p
    where p.id = 'b3b4ec47-5f8e-4a4a-94e1-12919f06315b'
  ),
  'dispute', (
    select jsonb_build_object(
      'id', d.id,
      'reason', d.reason,
      'network_reason_code', d.network_reason_code,
      'amount', d.amount,
      'currency_code', d.currency_code,
      'status', d.status,
      'phase', d.phase,
      'due_at', d.due_at,
      'order_name', d.order_name
    )
    from disputes d
    where d.id = '4537bbca-0f27-4579-ae17-c94ebfd3eb01'
  )
)) as diagnosis;
