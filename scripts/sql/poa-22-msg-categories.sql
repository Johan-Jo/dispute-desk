select g.dispute_id, g.id, g.evidence_category, g.review_status, g.confidence_score,
       left(coalesce(g.approved_excerpt, g.message_text), 90) as excerpt
from gorgias_evidence_messages g
where g.dispute_id = '583859fa-a6ef-4c09-bac9-c838e0d1ec9d'
order by g.review_status, g.approved_at;
