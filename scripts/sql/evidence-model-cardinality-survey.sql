-- READ-ONLY. How much multi-instance evidence exists today?
--
-- The canonical evidence model declares `cardinality: "multiple"` for
-- delivery_proof, shipping_tracking, customer_communication,
-- supporting_documents, refund_record and product_description. Today every
-- one of those collapses to a single row/fact, so this measures what that
-- collapse is discarding. Run against prod with:
--   npm run db:query:prod -- --file scripts/sql/evidence-model-cardinality-survey.sql
select
  'fulfillments per pack' as metric,
  jsonb_array_length(s->'data'->'fulfillments')::text as bucket,
  count(*) as packs
from evidence_packs ep,
     jsonb_array_elements(ep.pack_json->'sections') s
where s->'fieldsProvided' ? 'delivery_proof'
  and jsonb_typeof(s->'data'->'fulfillments') = 'array'
group by 1, 2

union all

select
  'tracking entries on the representative fulfillment',
  jsonb_array_length(s->'data'->'fulfillments'->0->'tracking')::text,
  count(*)
from evidence_packs ep,
     jsonb_array_elements(ep.pack_json->'sections') s
where s->'fieldsProvided' ? 'delivery_proof'
  and jsonb_typeof(s->'data'->'fulfillments'->0->'tracking') = 'array'
group by 1, 2

union all

select
  'evidence_items sharing one checklist field',
  cnt::text,
  count(*)
from (
  select pack_id, payload->>'checklistField' as field, count(*) as cnt
  from evidence_items
  where payload->>'checklistField' is not null
  group by 1, 2
) per_field
group by 1, 2

order by 1, 2;
