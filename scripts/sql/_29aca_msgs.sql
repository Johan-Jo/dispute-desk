select m.id, m.sender_type, m.sender_name, m.channel, m.sent_at,
       m.evidence_category, m.confidence_score, m.review_status,
       m.approved_at, m.approved_excerpt is not null as has_approved_excerpt,
       m.content_truncated, m.relevance_explanation,
       left(m.message_text, 900) as message_text
from gorgias_evidence_messages m
where m.dispute_id = '29aca84c-3547-4ddc-8100-41f6530b1a52'
order by m.sent_at;
