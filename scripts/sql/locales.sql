select shop_domain, locale, created_at::text, currency_code
from shops where uninstalled_at is null order by created_at desc limit 15;
