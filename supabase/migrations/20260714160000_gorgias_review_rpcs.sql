-- Gorgias merchant-review RPCs — the atomic seam for evidence-core review
-- actions (plan blocking requirement 4: approval status + approver +
-- timestamp + approved excerpt/hash + audit + funnel event + pack-snapshot
-- invalidation must land in ONE transaction).
--
--   gorgias_review_message  approve / manual_add / exclude / reset /
--                           edit_explanation on a single message
--   gorgias_review_ticket   confirm / reject / report_bad_match on a
--                           matched ticket (reject bulk-excludes ALL its
--                           messages, including previously approved and
--                           manual ones, and invalidates their approval
--                           hashes — approval metadata retained for audit)
--   gorgias_recompute_attention
--                           clears disputes.needs_attention
--                           ('gorgias_evidence_ready') only when NO
--                           actionable review item remains: no proposed
--                           messages AND no medium-confidence tickets
--                           still awaiting match confirmation
--
-- Ownership chain (shop → dispute → ticket → message) is validated inside
-- the functions; a mismatch raises 'not_found' style errors the routes map
-- to 404 so cross-shop probing is indistinguishable from absence.
--
-- Pack-snapshot invalidation: sets pack_json.gorgiasEvidenceStale = true
-- on the LATEST evidence pack of the dispute. buildPack rewrites pack_json
-- wholesale on regenerate, so the marker clears itself on rebuild. An
-- already-generated pack's content is never mutated beyond this marker.

create or replace function gorgias_recompute_attention(
  p_shop_id uuid,
  p_dispute_id uuid
) returns void
language plpgsql
as $$
declare
  v_actionable int;
begin
  select
    (select count(*) from gorgias_evidence_messages
      where dispute_id = p_dispute_id and review_status = 'proposed')
    +
    (select count(*) from gorgias_matched_tickets
      where dispute_id = p_dispute_id
        and confidence = 'medium'
        and match_status = 'proposed_match')
  into v_actionable;

  if v_actionable = 0 then
    update disputes
      set needs_attention = false,
          attention_reason = null,
          attention_payload = '{}'::jsonb,
          updated_at = now()
      where id = p_dispute_id
        and shop_id = p_shop_id
        and attention_reason = 'gorgias_evidence_ready';
  end if;
end;
$$;

create or replace function gorgias_review_message(
  p_shop_id uuid,
  p_dispute_id uuid,
  p_message_id uuid,
  p_action text,
  p_explanation text default null,
  p_excerpt text default null,
  p_actor text default 'merchant'
) returns jsonb
language plpgsql
as $$
declare
  v_msg gorgias_evidence_messages%rowtype;
  v_ticket gorgias_matched_tickets%rowtype;
  v_now timestamptz := now();
  v_prior text;
  v_event text;
begin
  select m.* into v_msg
  from gorgias_evidence_messages m
  join disputes d on d.id = m.dispute_id and d.shop_id = p_shop_id
  where m.id = p_message_id
    and m.dispute_id = p_dispute_id
    and m.shop_id = p_shop_id
  for update;
  if not found then
    raise exception 'message_not_found';
  end if;

  select t.* into v_ticket
  from gorgias_matched_tickets t
  where t.id = v_msg.matched_ticket_id
  for update;
  if not found then
    raise exception 'ticket_not_found';
  end if;

  v_prior := v_msg.review_status;

  if p_action in ('approve','manual_add') then
    -- Messages are only approvable on a confirmed match (distinct
    -- ticket-level decision; high tier arrives confirmed).
    if v_ticket.match_status <> 'confirmed_match' then
      raise exception 'ticket_not_confirmed';
    end if;
    -- The approved excerpt must be a verbatim substring of the stored
    -- message text — merchants select a passage, never rewrite it.
    if p_excerpt is not null and length(trim(p_excerpt)) > 0
       and position(p_excerpt in v_msg.message_text) = 0 then
      raise exception 'excerpt_not_verbatim';
    end if;
  end if;

  if p_action = 'approve' then
    if v_prior not in ('proposed','excluded','approved') then
      raise exception 'invalid_transition';
    end if;
    update gorgias_evidence_messages set
      review_status = 'approved',
      approved_at = v_now,
      approved_by = p_actor,
      approved_excerpt = coalesce(nullif(trim(p_excerpt), ''), message_text),
      approved_content_hash = content_hash,
      updated_at = v_now
    where id = p_message_id
    returning * into v_msg;
    v_event := 'gorgias_message_approved';

  elsif p_action = 'manual_add' then
    if v_prior not in ('candidate','excluded') then
      raise exception 'invalid_transition';
    end if;
    update gorgias_evidence_messages set
      review_status = 'manual',
      approved_at = v_now,
      approved_by = p_actor,
      approved_excerpt = coalesce(nullif(trim(p_excerpt), ''), message_text),
      approved_content_hash = content_hash,
      updated_at = v_now
    where id = p_message_id
    returning * into v_msg;
    v_event := 'gorgias_message_manually_selected';

  elsif p_action = 'exclude' then
    -- Approval metadata (approved_at/by) is retained for audit history;
    -- excluded rows never enter a pack regardless.
    update gorgias_evidence_messages set
      review_status = 'excluded',
      updated_at = v_now
    where id = p_message_id
    returning * into v_msg;
    v_event := 'gorgias_message_excluded';

  elsif p_action = 'reset' then
    update gorgias_evidence_messages set
      review_status = case
        when evidence_category is not null then 'proposed'
        else 'candidate'
      end,
      updated_at = v_now
    where id = p_message_id
    returning * into v_msg;
    v_event := 'gorgias_message_review_reset';

  elsif p_action = 'edit_explanation' then
    if p_explanation is null or length(trim(p_explanation)) = 0 then
      raise exception 'explanation_required';
    end if;
    update gorgias_evidence_messages set
      relevance_explanation = left(trim(p_explanation), 500),
      explanation_edited = true,
      updated_at = v_now
    where id = p_message_id
    returning * into v_msg;
    v_event := 'gorgias_explanation_edited';

  else
    raise exception 'unknown_action';
  end if;

  -- Content-affecting actions invalidate the current pack snapshot.
  if p_action in ('approve','manual_add','exclude','reset') then
    update evidence_packs
      set pack_json = jsonb_set(coalesce(pack_json, '{}'::jsonb),
                                '{gorgiasEvidenceStale}', 'true'::jsonb),
          updated_at = v_now
      where id = (
        select id from evidence_packs
        where dispute_id = p_dispute_id and shop_id = p_shop_id
        order by created_at desc
        limit 1
      );
  end if;

  insert into audit_events (shop_id, dispute_id, actor_type, actor_id, event_type, event_payload)
  values (p_shop_id, p_dispute_id, 'merchant', p_actor, v_event,
          jsonb_build_object(
            'messageId', p_message_id,
            'matchedTicketId', v_msg.matched_ticket_id,
            'priorStatus', v_prior,
            'newStatus', v_msg.review_status,
            'explanationEdited', p_action = 'edit_explanation'
          ));

  insert into app_events (shop_id, name, payload)
  values (p_shop_id, v_event,
          jsonb_build_object('disputeId', p_dispute_id, 'messageId', p_message_id));

  perform gorgias_recompute_attention(p_shop_id, p_dispute_id);

  return to_jsonb(v_msg);
end;
$$;

create or replace function gorgias_review_ticket(
  p_shop_id uuid,
  p_dispute_id uuid,
  p_matched_ticket_id uuid,
  p_action text,
  p_reason text default null,
  p_actor text default 'merchant'
) returns jsonb
language plpgsql
as $$
declare
  v_ticket gorgias_matched_tickets%rowtype;
  v_now timestamptz := now();
  v_prior text;
  v_event text;
  v_excluded int := 0;
begin
  select t.* into v_ticket
  from gorgias_matched_tickets t
  join disputes d on d.id = t.dispute_id and d.shop_id = p_shop_id
  where t.id = p_matched_ticket_id
    and t.dispute_id = p_dispute_id
    and t.shop_id = p_shop_id
  for update;
  if not found then
    raise exception 'ticket_not_found';
  end if;

  v_prior := v_ticket.match_status;

  if p_action = 'confirm' then
    if v_prior = 'rejected_match' then
      raise exception 'invalid_transition';
    end if;
    update gorgias_matched_tickets set
      match_status = 'confirmed_match',
      updated_at = v_now
    where id = p_matched_ticket_id
    returning * into v_ticket;
    v_event := 'gorgias_ticket_match_confirmed';

  elsif p_action = 'reject' then
    update gorgias_matched_tickets set
      match_status = 'rejected_match',
      updated_at = v_now
    where id = p_matched_ticket_id
    returning * into v_ticket;

    -- ALL messages of a rejected ticket are excluded — including
    -- previously approved and manual ones (manual selections do not
    -- survive rejection of their source ticket). Approval hashes are
    -- cleared so nothing can slip back in; approved_at/by retained
    -- for audit history.
    update gorgias_evidence_messages set
      review_status = 'excluded',
      approved_content_hash = null,
      updated_at = v_now
    where matched_ticket_id = p_matched_ticket_id
      and review_status <> 'excluded';
    get diagnostics v_excluded = row_count;

    update evidence_packs
      set pack_json = jsonb_set(coalesce(pack_json, '{}'::jsonb),
                                '{gorgiasEvidenceStale}', 'true'::jsonb),
          updated_at = v_now
      where id = (
        select id from evidence_packs
        where dispute_id = p_dispute_id and shop_id = p_shop_id
        order by created_at desc
        limit 1
      );
    v_event := 'gorgias_ticket_match_rejected';

  elsif p_action = 'report_bad_match' then
    insert into gorgias_match_reports (
      shop_id, dispute_id, matched_ticket_id, scope, merchant_reason,
      match_score_at_report, match_reasons_at_report, matching_algorithm_version
    ) values (
      p_shop_id, p_dispute_id, p_matched_ticket_id, 'ticket', p_reason,
      v_ticket.match_score, v_ticket.match_reasons, v_ticket.matching_algorithm_version
    );
    v_event := 'gorgias_bad_match_reported';

  else
    raise exception 'unknown_action';
  end if;

  insert into audit_events (shop_id, dispute_id, actor_type, actor_id, event_type, event_payload)
  values (p_shop_id, p_dispute_id, 'merchant', p_actor, v_event,
          jsonb_build_object(
            'matchedTicketId', p_matched_ticket_id,
            'gorgiasTicketId', v_ticket.gorgias_ticket_id,
            'priorStatus', v_prior,
            'newStatus', v_ticket.match_status,
            'messagesExcluded', v_excluded,
            'reason', p_reason
          ));

  insert into app_events (shop_id, name, payload)
  values (p_shop_id, v_event,
          jsonb_build_object(
            'disputeId', p_dispute_id,
            'matchedTicketId', p_matched_ticket_id,
            'confidence', v_ticket.confidence,
            'score', v_ticket.match_score
          ));

  perform gorgias_recompute_attention(p_shop_id, p_dispute_id);

  return jsonb_build_object(
    'ticket', to_jsonb(v_ticket),
    'messagesExcluded', v_excluded
  );
end;
$$;
