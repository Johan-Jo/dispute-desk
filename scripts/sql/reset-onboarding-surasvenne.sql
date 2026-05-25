-- Re-activate the onboarding wizard for surasvenne.myshopify.com.
--
-- Logic: GET /api/setup/state computes allDone from shop_setup.steps.
-- An empty steps object → every step defaults to { status: "todo" } →
-- doneCount = 0 → allDone = false → embedded dashboard redirects to
-- /app/setup. No other shop data (shops row, integrations, rules,
-- policies, packs, disputes) is touched — only the wizard progress.
--
-- Shop UUID resolved 2026-05-26:
--   surasvenne.myshopify.com → e5da0042-a3d4-48f4-88f3-33632a0e12d3
update shop_setup
   set steps        = '{}'::jsonb,
       current_step = null,
       updated_at   = now()
 where shop_id = 'e5da0042-a3d4-48f4-88f3-33632a0e12d3'
returning shop_id, current_step, steps, updated_at;
