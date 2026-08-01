select t.id as ticket_row_id, t.gorgias_ticket_id, t.match_confidence, t.match_reason,
       t.category, t.selected, t.excluded_reason, t.created_at
from gorgias_matched_tickets t
where t.dispute_id = '29aca84c-3547-4ddc-8100-41f6530b1a52';
