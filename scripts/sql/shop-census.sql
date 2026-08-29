select s.shop_domain, s.created_at::date as installed,
       count(d.id) as disputes,
       count(*) filter (where d.normalized_status in ('won','lost')) as decided,
       min(d.initiated_at)::date as first_dispute,
       max(d.initiated_at)::date as last_dispute
from shops s left join disputes d on d.shop_id=s.id
group by 1,2 order by disputes desc;
