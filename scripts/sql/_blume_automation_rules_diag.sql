-- Diagnose why blume-box's Automation "Automatic" toggles did not persist.
-- 1) shop + plan (plan gates POST /api/setup/automation via checkFeatureAccess)
select id, shop_domain, plan from shops where shop_domain ilike '%blume%';

-- 2) library packs the automation page toggles
select p.id, p.name, p.dispute_type, p.template_id, p.status, p.created_at
from packs p
join shops s on s.id = p.shop_id
where s.shop_domain ilike '%blume%'
  and p.template_id is not null
  and p.status <> 'ARCHIVED'
order by p.created_at;

-- 3) current rules (what actually got written / what modes they carry)
select r.name, r.enabled, r.priority, r.match, r.action, r.updated_at, r.created_at
from rules r
join shops s on s.id = r.shop_id
where s.shop_domain ilike '%blume%'
order by r.priority;
