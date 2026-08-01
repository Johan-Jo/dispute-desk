select id, version, status, submitted_at,
       jsonb_pretty(shopify_response) as shopify_response
from defence_packages
where id = '7ed2bcda-50b7-4da0-8636-d26ebd05fc4b';
