select d.id, d.shop_id, d.reason, d.status, d.normalized_status, d.amount, d.currency_code,
       d.order_gid, d.order_name, d.due_at, d.submission_state, d.review_state,
       d.customer_display_name, d.customer_email, d.network_reason_code, d.initiated_at
from disputes d
where d.id = '29aca84c-3547-4ddc-8100-41f6530b1a52';
