select id, shop_domain, shop_name, created_at
from shops
where shop_name ilike '%blue%' or shop_domain ilike '%blue%'
   or shop_name ilike '%army%' or shop_domain ilike '%army%'
   or shop_name ilike '%blume%' or shop_domain ilike '%blume%';
