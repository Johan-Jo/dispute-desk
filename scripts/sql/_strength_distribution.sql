select pack_json->'case_strength'->>'overall' as strength,
  count(*) as packs,
  count(distinct dispute_id) as disputes
from evidence_packs
where pack_json ? 'case_strength'
group by 1 order by 2 desc;
