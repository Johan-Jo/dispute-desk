-- P0 security lockdown before Shopify submission.
--
-- Three changes, all defense-in-depth (app behaviour is unchanged because
-- service_role bypasses RLS and the dd_admin_* RPCs are only called via
-- service_role from server-side code):
--
--   1) Scope every `for all using (true) with check (true)` service-role
--      policy to `to service_role`. They were created with role `public`,
--      so an anon-key call would also satisfy the policy if it ever reached
--      these tables.
--   2) Pin `search_path` on the 8 functions flagged by Supabase advisors
--      (`function_search_path_mutable`).
--   3) Revoke EXECUTE on the two SECURITY DEFINER dd_admin_* RPCs from
--      `anon` and `authenticated`. The advisor flags them because anyone
--      could call them through `/rest/v1/rpc/*` — the first could enumerate
--      user_ids by email, the second could spoof last-login timestamps.
--
-- See docs/technical.md § "Security posture" for the rationale.

begin;

-- ============================================================================
-- 1) RLS: scope service-role policies to `to service_role`
-- ============================================================================

drop policy if exists service_role_argument_maps on public.argument_maps;
create policy service_role_argument_maps on public.argument_maps
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_audit on public.audit_events;
create policy service_role_full_access_audit on public.audit_events
  for all to service_role using (true) with check (true);

drop policy if exists service_role_authors on public.authors;
create policy service_role_authors on public.authors
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_checkout_sessions on public.checkout_sessions;
create policy service_role_full_access_checkout_sessions on public.checkout_sessions
  for all to service_role using (true) with check (true);

drop policy if exists service_role_cms_settings on public.cms_settings;
create policy service_role_cms_settings on public.cms_settings
  for all to service_role using (true) with check (true);

drop policy if exists service_role_content_archive on public.content_archive_items;
create policy service_role_content_archive on public.content_archive_items
  for all to service_role using (true) with check (true);

drop policy if exists service_role_content_ctas on public.content_ctas;
create policy service_role_content_ctas on public.content_ctas
  for all to service_role using (true) with check (true);

drop policy if exists service_role_content_item_tags on public.content_item_tags;
create policy service_role_content_item_tags on public.content_item_tags
  for all to service_role using (true) with check (true);

drop policy if exists service_role_content_items on public.content_items;
create policy service_role_content_items on public.content_items
  for all to service_role using (true) with check (true);

drop policy if exists service_role_content_localizations on public.content_localizations;
create policy service_role_content_localizations on public.content_localizations
  for all to service_role using (true) with check (true);

drop policy if exists service_role_content_publish_queue on public.content_publish_queue;
create policy service_role_content_publish_queue on public.content_publish_queue
  for all to service_role using (true) with check (true);

drop policy if exists service_role_content_revisions on public.content_revisions;
create policy service_role_content_revisions on public.content_revisions
  for all to service_role using (true) with check (true);

drop policy if exists service_role_content_tags on public.content_tags;
create policy service_role_content_tags on public.content_tags
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_dispute_events on public.dispute_events;
create policy service_role_full_access_dispute_events on public.dispute_events
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_dispute_notes on public.dispute_notes;
create policy service_role_full_access_dispute_notes on public.dispute_notes
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_qualifications on public.dispute_qualifications;
create policy service_role_full_access_qualifications on public.dispute_qualifications
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_disputes on public.disputes;
create policy service_role_full_access_disputes on public.disputes
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_items on public.evidence_items;
create policy service_role_full_access_items on public.evidence_items
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_packs on public.evidence_packs;
create policy service_role_full_access_packs on public.evidence_packs
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_jobs on public.jobs;
create policy service_role_full_access_jobs on public.jobs
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_lse_partner_creds on public.lse_partner_credentials;
create policy service_role_full_access_lse_partner_creds on public.lse_partner_credentials
  for all to service_role using (true) with check (true);

drop policy if exists service_role_pack_credits on public.pack_credits_ledger;
create policy service_role_pack_credits on public.pack_credits_ledger
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_narrative_settings on public.pack_narrative_settings;
create policy service_role_full_access_pack_narrative_settings on public.pack_narrative_settings
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_narratives on public.pack_narratives;
create policy service_role_full_access_pack_narratives on public.pack_narratives
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_section_items on public.pack_section_items;
create policy service_role_full_access_pack_section_items on public.pack_section_items
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_sections on public.pack_sections;
create policy service_role_full_access_pack_sections on public.pack_sections
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_template_i18n on public.pack_template_i18n;
create policy service_role_full_access_pack_template_i18n on public.pack_template_i18n
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_template_item_i18n on public.pack_template_item_i18n;
create policy service_role_full_access_pack_template_item_i18n on public.pack_template_item_i18n
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_template_items on public.pack_template_items;
create policy service_role_full_access_pack_template_items on public.pack_template_items
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_template_section_i18n on public.pack_template_section_i18n;
create policy service_role_full_access_pack_template_section_i18n on public.pack_template_section_i18n
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_template_sections on public.pack_template_sections;
create policy service_role_full_access_pack_template_sections on public.pack_template_sections
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_pack_templates on public.pack_templates;
create policy service_role_full_access_pack_templates on public.pack_templates
  for all to service_role using (true) with check (true);

drop policy if exists service_role_pack_usage on public.pack_usage_events;
create policy service_role_pack_usage on public.pack_usage_events
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_packs on public.packs;
create policy service_role_full_access_packs on public.packs
  for all to service_role using (true) with check (true);

drop policy if exists service_role_plan_entitlements on public.plan_entitlements;
create policy service_role_plan_entitlements on public.plan_entitlements
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_policies on public.policy_snapshots;
create policy service_role_full_access_policies on public.policy_snapshots
  for all to service_role using (true) with check (true);

-- portal_user_shops: also clears the multiple_permissive_policies finding,
-- since the user-level "Users read own shop links" policy now stands alone
-- for anon/authenticated SELECT.
drop policy if exists "Service role manages shop links" on public.portal_user_shops;
create policy "Service role manages shop links" on public.portal_user_shops
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_ratio_alerts on public.ratio_alerts;
create policy service_role_full_access_ratio_alerts on public.ratio_alerts
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_ratio_snapshots on public.ratio_snapshots;
create policy service_role_full_access_ratio_snapshots on public.ratio_snapshots
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_reason_template_mappings on public.reason_template_mappings;
create policy service_role_full_access_reason_template_mappings on public.reason_template_mappings
  for all to service_role using (true) with check (true);

drop policy if exists service_role_rebuttal_drafts on public.rebuttal_drafts;
create policy service_role_rebuttal_drafts on public.rebuttal_drafts
  for all to service_role using (true) with check (true);

drop policy if exists service_role_reviewers on public.reviewers;
create policy service_role_reviewers on public.reviewers
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_rules on public.rules;
create policy service_role_full_access_rules on public.rules
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_sessions on public.shop_sessions;
create policy service_role_full_access_sessions on public.shop_sessions
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_shop_settings on public.shop_settings;
create policy service_role_full_access_shop_settings on public.shop_settings
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_shops on public.shops;
create policy service_role_full_access_shops on public.shops
  for all to service_role using (true) with check (true);

drop policy if exists service_role_all_signal_alerts on public.signal_alerts;
create policy service_role_all_signal_alerts on public.signal_alerts
  for all to service_role using (true) with check (true);

drop policy if exists service_role_all_signal_analysis on public.signal_analysis;
create policy service_role_all_signal_analysis on public.signal_analysis
  for all to service_role using (true) with check (true);

drop policy if exists service_role_all_signal_radar_settings on public.signal_radar_settings;
create policy service_role_all_signal_radar_settings on public.signal_radar_settings
  for all to service_role using (true) with check (true);

drop policy if exists service_role_all_signal_sources on public.signal_sources;
create policy service_role_all_signal_sources on public.signal_sources
  for all to service_role using (true) with check (true);

drop policy if exists service_role_submission_attempts on public.submission_attempts;
create policy service_role_submission_attempts on public.submission_attempts
  for all to service_role using (true) with check (true);

drop policy if exists service_role_full_access_submission_logs on public.submission_logs;
create policy service_role_full_access_submission_logs on public.submission_logs
  for all to service_role using (true) with check (true);

-- ============================================================================
-- 2) Pin function search_path
-- ============================================================================
-- Trigger functions that only touch pg_catalog (now(), current_setting,
-- raise) can run with an empty search_path. ensure_shop_settings + claim_jobs
-- reference public tables so they pin to (public, pg_temp) — still satisfies
-- the lint, still resolves unqualified references.

alter function public.set_updated_at()                        set search_path = '';
alter function public.submission_logs_set_updated_at()        set search_path = '';
alter function public.dispute_qualifications_set_updated_at() set search_path = '';
alter function public.reject_dispute_event_mutation()         set search_path = '';
alter function public.reject_audit_mutation()                 set search_path = '';
alter function public.shopify_orders_lock_initial_risk()      set search_path = '';
alter function public.ensure_shop_settings(uuid)              set search_path = public, pg_temp;
alter function public.claim_jobs(text, integer, integer)      set search_path = public, pg_temp;

-- ============================================================================
-- 3) Lock down dd_admin_* SECURITY DEFINER RPCs
-- ============================================================================
-- Callers (verified): middleware.ts:221,395 and app/api/admin/team/route.ts:74
-- — both run server-side via getServiceClient(), so revoking from anon and
-- authenticated keeps the app working while closing the PostgREST exposure.

revoke execute on function public.dd_admin_resolve_user_id_by_email(text) from public, anon, authenticated;
revoke execute on function public.dd_admin_touch_last_login(uuid)         from public, anon, authenticated;

commit;
