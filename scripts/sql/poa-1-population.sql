select coalesce(final_outcome,'(null)') as final_outcome,
       coalesce(phase,'(null)')        as phase,
       count(*)                        as n,
       count(distinct shop_id)         as shops,
       min(closed_at)::date            as first_closed,
       max(closed_at)::date            as last_closed
from disputes
group by 1,2
order by n desc;
