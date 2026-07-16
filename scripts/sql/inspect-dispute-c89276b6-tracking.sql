-- Diagnostic: dispute c89276b6 shows "PostNord SE · —" (no tracking number)
-- in the Shipping & tracking evidence row. Inspect the pack payload's
-- fulfillment tracking entries.
select
  p.id as pack_id,
  p.created_at,
  jsonb_pretty(
    (
      select jsonb_agg(
        jsonb_build_object(
          'proofType', s->'data'->>'proofType',
          'fulfillments', (
            select jsonb_agg(
              jsonb_build_object(
                'tracking', f->'tracking',
                'deliveredAt', f->'deliveredAt',
                'displayStatus', f->'displayStatus'
              )
            )
            from jsonb_array_elements(s->'data'->'fulfillments') f
          )
        )
      )
      from jsonb_array_elements(p.pack_json->'sections') s
      where s->>'type' = 'shipping'
    )
  ) as shipping_sections
from evidence_packs p
where p.dispute_id = 'c89276b6-1935-46d0-b06a-190f4b292cb0'
order by p.created_at desc
limit 3;
